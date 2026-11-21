/**
 * Custom National FDSN-WS + ShakeMap Contour/Station/Grid Ingestion Adapter
 *
 * Enables national seismic agencies (BMKG, PHIVOLCS, JMA, EMSC, GeoNet, INGV, USGS)
 * to ingest custom FDSN-WS event feeds and station-constrained ShakeMap v4 products
 * (PGA/PGV contours, instrumented station lists with Vs30 site amplification, and
 * gridded PGA rasters), upgrading C-04 beyond Wald et al. (1999) GMICE proxies.
 *
 * Security & Governance:
 * - Zero external dependencies (pure Node.js standard library)
 * - SSRF host protection on custom FDSN-WS endpoints (respects ALLOW_PRIVATE_WEBHOOKS)
 * - Untrusted feed text sanitization (prompt-injection guard)
 * - Explicit PGA unit normalization (%g, g, m/s2, cm/s2 / gal -> g)
 * - Separates instrumented seismic stations from macroseismic (DYFI) reports
 * - NEHRP Vs30 site classification (Classes A-E)
 * - Outputs continuous PGA raster grids directly compatible with computeRasterZonalStats
 * - SHA-256 provenance hashing & C-03 governance metadata
 */

const {
	CONFIG,
	fetchJsonWithConfig,
	isBlockedWebhookHost,
	redactUrlSecrets,
} = require("./config");
const { sanitizeUntrustedFeedText } = require("./security");
const { computeSnapshotHash } = require("./contracts");
const { getRegisteredMethod } = require("./registry");

const SHAKEMAP_METHOD_ID = "telemetry.fdsn.shakemap_v1";

/**
 * Normalize ground acceleration value to canonical g.
 * ShakeMap v4 cont_pga.json and stationlist.json typically report PGA in "%g".
 */
function normalizePgaToG(rawValue, rawUnit = "%g") {
	if (rawValue === null || rawValue === undefined || rawValue === "") {
		return { valueG: null, error: null };
	}
	const num = Number(rawValue);
	if (!Number.isFinite(num) || num < 0) {
		return { valueG: null, error: `Invalid non-negative PGA value: ${rawValue}` };
	}
	const u = String(rawUnit || "%g").trim().toLowerCase();
	if (u === "g") return { valueG: Number(num.toFixed(6)), factor: 1, error: null };
	if (u === "%g" || u === "pctg" || u === "percent_g") {
		return { valueG: Number((num / 100).toFixed(6)), factor: 0.01, error: null };
	}
	if (u === "m/s2" || u === "m/s^2" || u === "m/s²") {
		return { valueG: Number((num / 9.80665).toFixed(6)), factor: 1 / 9.80665, error: null };
	}
	if (u === "cm/s2" || u === "cm/s^2" || u === "gal") {
		return { valueG: Number((num / 980.665).toFixed(6)), factor: 1 / 980.665, error: null };
	}
	return {
		valueG: null,
		error: `Unsupported PGA unit '${rawUnit}'. Supported: %g, g, m/s2, cm/s2, gal.`,
	};
}

/**
 * Classify Vs30 (m/s) into NEHRP Site Class (A-E)
 */
function classifyNehrpVs30(vs30Ms) {
	if (vs30Ms === null || vs30Ms === undefined || !Number.isFinite(Number(vs30Ms))) {
		return null;
	}
	const v = Number(vs30Ms);
	if (v <= 0) return null;
	if (v > 1500) return "A"; // Hard rock
	if (v > 760) return "B"; // Rock
	if (v > 360) return "C"; // Very dense soil and soft rock
	if (v > 180) return "D"; // Stiff soil
	return "E"; // Soft clay soil (high amplification risk)
}

/**
 * Build an SSRF-guarded custom FDSN-WS /query URL (fdsnws-event v1.2)
 */
function buildFdsnEventUrl(baseUrl, options = {}) {
	if (!baseUrl || typeof baseUrl !== "string") {
		throw new Error("FDSN-WS endpointUrl is required when no samplePayload is provided.");
	}
	let parsed;
	try {
		parsed = new URL(baseUrl);
	} catch (err) {
		throw new Error(`Invalid FDSN-WS URL: ${baseUrl}`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported protocol for FDSN-WS URL: ${parsed.protocol}`);
	}

	if (!CONFIG.ALLOW_PRIVATE_WEBHOOKS && isBlockedWebhookHost(parsed.hostname)) {
		throw new Error(
			`SSRF guard blocked FDSN-WS host "${parsed.hostname}". Set DRR_ALLOW_PRIVATE_WEBHOOKS=true only for trusted internal EOC networks.`,
		);
	}

	const cleanPath = parsed.pathname.replace(/\/+$/, "");
	if (!/\/query$/i.test(cleanPath)) {
		parsed.pathname = `${cleanPath}/query`;
	}

	if (!parsed.searchParams.has("format")) {
		parsed.searchParams.set("format", "geojson");
	}
	if (options.minMagnitude !== undefined && !parsed.searchParams.has("minmagnitude")) {
		parsed.searchParams.set("minmagnitude", String(options.minMagnitude));
	}
	if (options.startTime && !parsed.searchParams.has("starttime")) {
		parsed.searchParams.set("starttime", String(options.startTime));
	}
	if (options.endTime && !parsed.searchParams.has("endtime")) {
		parsed.searchParams.set("endtime", String(options.endTime));
	}
	if (Array.isArray(options.bbox) && options.bbox.length === 4) {
		const [minLon, minLat, maxLon, maxLat] = options.bbox;
		if (!parsed.searchParams.has("minlongitude")) parsed.searchParams.set("minlongitude", String(minLon));
		if (!parsed.searchParams.has("minlatitude")) parsed.searchParams.set("minlatitude", String(minLat));
		if (!parsed.searchParams.has("maxlongitude")) parsed.searchParams.set("maxlongitude", String(maxLon));
		if (!parsed.searchParams.has("maxlatitude")) parsed.searchParams.set("maxlatitude", String(maxLat));
	}
	const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 200) : 20;
	if (!parsed.searchParams.has("limit")) {
		parsed.searchParams.set("limit", String(limit));
	}
	if (!parsed.searchParams.has("orderby")) {
		parsed.searchParams.set("orderby", "time");
	}

	return parsed.toString();
}

/**
 * Parse ShakeMap PGA contours GeoJSON FeatureCollection
 */
function parseShakeMapContours(contoursGeoJSON, options = {}) {
	if (!contoursGeoJSON || !Array.isArray(contoursGeoJSON.features)) {
		return { contours: [], maxContourPgaG: null, injectionDetected: false };
	}

	const defaultUnit = options.contourUnit || contoursGeoJSON.metadata?.units || "%g";
	const minPgaG = typeof options.minPgaG === "number" ? options.minPgaG : 0;
	const contours = [];
	let maxContourPgaG = null;
	let injectionDetected = false;

	for (const feat of contoursGeoJSON.features) {
		if (!feat || typeof feat !== "object") continue;
		const props = feat.properties || {};
		const rawVal = props.value ?? props.pga ?? props.PGA ?? null;
		const rawUnit = props.units || props.unit || defaultUnit;
		const norm = normalizePgaToG(rawVal, rawUnit);
		if (norm.valueG === null || norm.valueG < minPgaG) continue;

		if (maxContourPgaG === null || norm.valueG > maxContourPgaG) {
			maxContourPgaG = norm.valueG;
		}

		const safeLabel = sanitizeUntrustedFeedText(props.title || props.label || `PGA ${norm.valueG} g`);
		if (safeLabel.injectionDetected) injectionDetected = true;

		contours.push({
			id: feat.id !== undefined ? String(feat.id) : `contour_${contours.length + 1}`,
			label: safeLabel.text,
			pgaG: norm.valueG,
			rawValue: Number(rawVal),
			rawUnit,
			geometry: feat.geometry || null,
		});
	}

	contours.sort((a, b) => b.pgaG - a.pgaG);
	return { contours, maxContourPgaG, injectionDetected };
}

/**
 * Parse ShakeMap stationlist.json GeoJSON FeatureCollection separating
 * instrumented seismic stations from macroseismic (DYFI) observations.
 */
function parseShakeMapStations(stationListGeoJSON, options = {}) {
	if (!stationListGeoJSON || !Array.isArray(stationListGeoJSON.features)) {
		return {
			stations: [],
			instrumentedCount: 0,
			macroseismicCount: 0,
			maxInstrumentedPgaG: null,
			siteClassCounts: {},
			injectionDetected: false,
		};
	}

	const defaultUnit = options.stationPgaUnit || "%g";
	const stations = [];
	let instrumentedCount = 0;
	let macroseismicCount = 0;
	let maxInstrumentedPgaG = null;
	const siteClassCounts = {};
	let injectionDetected = false;

	for (const feat of stationListGeoJSON.features) {
		if (!feat || typeof feat !== "object") continue;
		const props = feat.properties || {};
		const rawType = String(props.station_type || props.stationType || "seismic").toLowerCase();
		const isInstrumented = rawType === "seismic" || rawType === "instrumented";

		const rawPga = props.pga ?? props.PGA ?? null;
		const rawPgaUnit = props.pga_unit || props.pgaUnit || defaultUnit;
		const pgaNorm = normalizePgaToG(rawPga, rawPgaUnit);

		const pgvCmS =
			props.pgv !== undefined && props.pgv !== null && Number.isFinite(Number(props.pgv))
				? Number(props.pgv)
				: null;
		const vs30Ms =
			props.vs30 !== undefined && props.vs30 !== null && Number.isFinite(Number(props.vs30))
				? Number(props.vs30)
				: null;
		const nehrpSiteClass = classifyNehrpVs30(vs30Ms);
		if (nehrpSiteClass) {
			siteClassCounts[nehrpSiteClass] = (siteClassCounts[nehrpSiteClass] || 0) + 1;
		}

		if (isInstrumented) {
			instrumentedCount += 1;
			if (pgaNorm.valueG !== null && (maxInstrumentedPgaG === null || pgaNorm.valueG > maxInstrumentedPgaG)) {
				maxInstrumentedPgaG = pgaNorm.valueG;
			}
		} else {
			macroseismicCount += 1;
		}

		const safeName = sanitizeUntrustedFeedText(props.name || props.code || feat.id || "Station");
		if (safeName.injectionDetected) injectionDetected = true;

		stations.push({
			id: feat.id !== undefined ? String(feat.id) : props.code || `sta_${stations.length + 1}`,
			code: props.code || null,
			network: props.network || null,
			name: safeName.text,
			stationType: isInstrumented ? "seismic" : "macroseismic",
			pgaG: pgaNorm.valueG,
			pgvCmS,
			mmi:
				props.intensity !== undefined && props.intensity !== null && Number.isFinite(Number(props.intensity))
					? Number(props.intensity)
					: null,
			vs30Ms,
			nehrpSiteClass,
			distanceKm:
				props.distance !== undefined && props.distance !== null && Number.isFinite(Number(props.distance))
					? Number(props.distance)
					: null,
			coordinates:
				feat.geometry && feat.geometry.type === "Point" ? feat.geometry.coordinates : null,
			geometry: feat.geometry || null,
		});
	}

	stations.sort((a, b) => (b.pgaG ?? -1) - (a.pgaG ?? -1));
	return {
		stations,
		instrumentedCount,
		macroseismicCount,
		maxInstrumentedPgaG,
		siteClassCounts,
		injectionDetected,
	};
}

/**
 * Validate and normalize a ShakeMap PGA raster grid to canonical g (compatible with computeRasterZonalStats).
 */
function parseShakeMapPgaGrid(rawGrid) {
	if (!rawGrid || typeof rawGrid !== "object" || !Array.isArray(rawGrid.values)) {
		return null;
	}
	if (!Array.isArray(rawGrid.bbox) || rawGrid.bbox.length !== 4) {
		return { valid: false, errors: ["ShakeMap PGA grid requires bbox [minLon, minLat, maxLon, maxLat]."] };
	}

	const nodata = rawGrid.nodata ?? -9999;
	const rawUnit = rawGrid.unit || "%g";
	const is2D = Array.isArray(rawGrid.values[0]);

	const convertCell = (v) => {
		if (v === null || v === undefined) return nodata;
		const num = Number(v);
		if (!Number.isFinite(num) || num === nodata) return nodata;
		const norm = normalizePgaToG(num, rawUnit);
		if (norm.error || norm.valueG === null) return nodata;
		return norm.valueG;
	};

	// Verify unit first
	const unitCheck = normalizePgaToG(1, rawUnit);
	if (unitCheck.error) {
		return { valid: false, errors: [unitCheck.error] };
	}

	const values = is2D
		? rawGrid.values.map((row) => (Array.isArray(row) ? row.map(convertCell) : []))
		: rawGrid.values.map(convertCell);

	const flat = is2D ? values.flat() : values;
	let validCells = 0;
	let nodataCells = 0;
	let sum = 0;
	let min = Infinity;
	let max = -Infinity;

	for (const val of flat) {
		if (val === nodata || !Number.isFinite(val)) {
			nodataCells += 1;
			continue;
		}
		validCells += 1;
		sum += val;
		if (val < min) min = val;
		if (val > max) max = val;
	}

	return {
		valid: true,
		unit: "g",
		originalUnit: rawUnit,
		crs: String(rawGrid.crs || "EPSG:4326").toUpperCase(),
		bbox: rawGrid.bbox,
		width: rawGrid.width || (is2D ? values[0].length : undefined),
		height: rawGrid.height || (is2D ? values.length : undefined),
		values,
		nodata,
		valueSemantics: "continuous",
		quantityType: "continuous",
		statistics: {
			totalCells: flat.length,
			validCells,
			nodataCells,
			minPgaG: validCells > 0 ? Number(min.toFixed(6)) : null,
			maxPgaG: validCells > 0 ? Number(max.toFixed(6)) : null,
			meanPgaG: validCells > 0 ? Number((sum / validCells).toFixed(6)) : null,
		},
	};
}

/**
 * Parse a combined or standalone FDSN-WS / ShakeMap payload.
 * Accepts:
 * - Combined bundle: { agency?, fdsnEvents?, shakemapContours?, shakemapStations?, shakemapPgaGrid? }
 * - Standalone FDSN-WS FeatureCollection: { type: "FeatureCollection", features: [...] }
 */
function parseFdsnShakeMapPayload(payload, options = {}) {
	if (!payload || typeof payload !== "object") {
		throw new Error("Invalid FDSN-WS / ShakeMap payload: expected a JSON object");
	}

	const retrievedAt = options.retrievedAt || new Date().toISOString();
	const payloadHash = `sha256:${computeSnapshotHash(payload)}`;

	const fdsnRaw =
		payload.fdsnEvents ||
		(payload.type === "FeatureCollection" && Array.isArray(payload.features) ? payload : null);
	const contoursRaw = payload.shakemapContours || options.shakemapContours || null;
	const stationsRaw = payload.shakemapStations || options.shakemapStations || null;
	const gridRaw = payload.shakemapPgaGrid || options.shakemapPgaGrid || null;

	let anyPromptInjection = false;
	let latestSourceIssuedAt = null;
	const events = [];
	const minMag = options.minMagnitude !== undefined ? Number(options.minMagnitude) : null;

	if (fdsnRaw && Array.isArray(fdsnRaw.features)) {
		for (const feat of fdsnRaw.features) {
			if (!feat || typeof feat !== "object") continue;
			const props = feat.properties || {};
			const mag = props.mag !== undefined && props.mag !== null ? Number(props.mag) : null;
			if (minMag !== null && mag !== null && mag < minMag) continue;

			const placeSanitized = sanitizeUntrustedFeedText(props.place || props.title || "Seismic Event");
			if (placeSanitized.injectionDetected) anyPromptInjection = true;

			const rawTime = props.time || props.originTime || null;
			let eventTime = null;
			if (typeof rawTime === "number") {
				eventTime = new Date(rawTime).toISOString();
			} else if (typeof rawTime === "string" && !Number.isNaN(Date.parse(rawTime))) {
				eventTime = new Date(Date.parse(rawTime)).toISOString();
			}

			const updatedRaw = props.updated || rawTime;
			let sourceIssuedAt = eventTime;
			if (typeof updatedRaw === "number") {
				sourceIssuedAt = new Date(updatedRaw).toISOString();
			} else if (typeof updatedRaw === "string" && !Number.isNaN(Date.parse(updatedRaw))) {
				sourceIssuedAt = new Date(Date.parse(updatedRaw)).toISOString();
			}
			if (sourceIssuedAt && (!latestSourceIssuedAt || sourceIssuedAt > latestSourceIssuedAt)) {
				latestSourceIssuedAt = sourceIssuedAt;
			}

			const coords =
				feat.geometry && feat.geometry.type === "Point" && Array.isArray(feat.geometry.coordinates)
					? feat.geometry.coordinates
					: null;

			events.push({
				id: feat.id !== undefined ? String(feat.id) : `fdsn_${events.length + 1}`,
				agency: props.net || payload.agency || options.agency || "custom-fdsn",
				magnitude: mag,
				magType: props.magType || null,
				place: placeSanitized.text,
				eventTime,
				sourceIssuedAt,
				depthKm: coords && coords.length >= 3 ? Number(coords[2]) : null,
				coordinates: coords ? [Number(coords[0]), Number(coords[1])] : null,
				mmi: props.mmi !== undefined && props.mmi !== null ? Number(props.mmi) : null,
				geometry: feat.geometry || null,
			});
		}
	}

	const contourResult = parseShakeMapContours(contoursRaw, options);
	const stationResult = parseShakeMapStations(stationsRaw, options);
	const pgaGrid = parseShakeMapPgaGrid(gridRaw);

	if (contourResult.injectionDetected || stationResult.injectionDetected) {
		anyPromptInjection = true;
	}

	const hasMeasuredField =
		stationResult.instrumentedCount > 0 ||
		contourResult.contours.length > 0 ||
		Boolean(pgaGrid && pgaGrid.valid);

	const peakPgaCandidates = [
		stationResult.maxInstrumentedPgaG,
		contourResult.maxContourPgaG,
		pgaGrid && pgaGrid.valid ? pgaGrid.statistics.maxPgaG : null,
	].filter((v) => typeof v === "number" && Number.isFinite(v));

	const peakObservedPgaG = peakPgaCandidates.length > 0 ? Math.max(...peakPgaCandidates) : null;

	return {
		standard: "FDSN-WS Event v1.2 + ShakeMap v4 Contour/Station/Grid (C-04 Upgrade)",
		method: getRegisteredMethod(SHAKEMAP_METHOD_ID),
		agency: payload.agency || options.agency || "custom-fdsn",
		sourceUrl: options.sourceUrl ? redactUrlSecrets(options.sourceUrl) : "offline_fixture",
		sourceIssuedAt: latestSourceIssuedAt,
		retrievedAt,
		payloadHash,
		groundMotionBasis: hasMeasuredField
			? "shakemap_station_constrained_field"
			: "fdsn_event_catalog_only_no_shakemap",
		replacesWald99Gmice: hasMeasuredField,
		summary: {
			eventCount: events.length,
			contourCount: contourResult.contours.length,
			instrumentedStationCount: stationResult.instrumentedCount,
			macroseismicReportCount: stationResult.macroseismicCount,
			hasValidatedPgaGrid: Boolean(pgaGrid && pgaGrid.valid),
			peakObservedPgaG,
			peakPgaUnit: "g",
			nehrpSiteClassCounts: stationResult.siteClassCounts,
		},
		events,
		shakemap: {
			contours: contourResult.contours,
			stations: stationResult.stations,
			pgaGrid,
		},
		governanceMetadata: {
			evidenceBasis: hasMeasuredField ? "observed" : "unverified_seismic",
			verificationStatus: "unreviewed",
			approvalStatus: "draft",
			reportingEligibility: "pending",
		},
		untrustedFeedSecurity: {
			untrustedData: true,
			promptInjectionFlagged: anyPromptInjection,
		},
	};
}

/**
 * Export ShakeMap PGA contours (or instrumented stations) as a GeoJSON FeatureCollection
 * directly consumable by drr_spatial_exposure_join.
 */
function toShakeMapGeoJSON(parsedReport, mode = "contours") {
	const features = [];

	if (mode === "stations") {
		const stations = parsedReport?.shakemap?.stations || [];
		for (const s of stations) {
			if (!s.geometry) continue;
			features.push({
				type: "Feature",
				id: s.id,
				geometry: s.geometry,
				properties: {
					code: s.code,
					network: s.network,
					name: s.name,
					stationType: s.stationType,
					pgaG: s.pgaG,
					pgvCmS: s.pgvCmS,
					vs30Ms: s.vs30Ms,
					nehrpSiteClass: s.nehrpSiteClass,
					distanceKm: s.distanceKm,
				},
			});
		}
	} else {
		const contours = parsedReport?.shakemap?.contours || [];
		for (const c of contours) {
			if (!c.geometry) continue;
			features.push({
				type: "Feature",
				id: c.id,
				geometry: c.geometry,
				properties: {
					label: c.label,
					pgaG: c.pgaG,
					unit: "g",
					groundMotionBasis: "shakemap_station_constrained_field",
				},
			});
		}
	}

	return {
		type: "FeatureCollection",
		features,
	};
}

/**
 * Ingest custom FDSN-WS events and/or ShakeMap products from live endpoint or offline payload.
 */
async function ingestFdsnShakeMap(options = {}) {
	const retrievedAt = options.retrievedAt || new Date().toISOString();
	let payload = options.samplePayload || null;
	let resolvedUrl = null;

	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch (err) {
			throw new Error(`Failed to parse FDSN/ShakeMap samplePayload JSON: ${err.message}`);
		}
	}

	if (!payload) {
		const baseUrl = options.endpointUrl || CONFIG.FDSN_API_URL;
		resolvedUrl = buildFdsnEventUrl(baseUrl, options);

		const headers = {};
		const apiKey = options.apiKey || CONFIG.FDSN_API_KEY;
		const apiKeyHeader = options.apiKeyHeader || CONFIG.FDSN_API_KEY_HEADER || "X-API-Key";
		if (apiKey) {
			headers[apiKeyHeader] = apiKey;
		}

		payload = await fetchJsonWithConfig(resolvedUrl, headers);
	}

	return parseFdsnShakeMapPayload(payload, {
		...options,
		retrievedAt,
		sourceUrl: resolvedUrl,
	});
}

module.exports = {
	SHAKEMAP_METHOD_ID,
	normalizePgaToG,
	classifyNehrpVs30,
	buildFdsnEventUrl,
	parseShakeMapContours,
	parseShakeMapStations,
	parseShakeMapPgaGrid,
	parseFdsnShakeMapPayload,
	toShakeMapGeoJSON,
	ingestFdsnShakeMap,
};
