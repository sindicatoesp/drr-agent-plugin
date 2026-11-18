/**
 * USGS Earthquake Hazards Program API Ingestion & GMICE Ground Motion Converter
 * Connects to USGS FDSN-WS event service (https://earthquake.usgs.gov/fdsnws/event/1/)
 * Supports live network querying and offline test payloads.
 *
 * Note (C-04): Wald et al. (1999) is a Ground-Motion Intensity Conversion Equation (GMICE),
 * NOT a Ground-Motion Prediction Equation (GMPE) based on source, distance, and Vs30 site conditions.
 */

const { CONFIG, fetchJsonWithConfig } = require("./config");
const { getRegisteredMethod } = require("./registry");
const { sanitizeUntrustedFeedText } = require("./security");
const { computeSnapshotHash } = require("./contracts");

/**
 * Detailed Wald et al. (1999) GMICE MMI-to-PGA conversion with empirical bounds & provenance (C-04, R-04).
 * Calibrated primarily on California earthquakes for MMI V-VIII.
 * @param {number} mmi - Modified Mercalli Intensity
 * @param {object} options - { rejectOutOfRange: boolean }
 * @returns {object} Detailed GMICE result with pgaG, units, empirical range, and warnings
 */
function estimatePgaFromMmiDetailed(mmi, options = {}) {
	const method = getRegisteredMethod("gmice.wald1999");
	if (mmi === null || mmi === undefined || !Number.isFinite(Number(mmi))) {
		return {
			valid: false,
			pgaG: null,
			unit: "g",
			methodId: method.id,
			classification: "GMICE",
			errors: [{ code: "MISSING_REQUIRED_INPUT", field: "mmi", message: "Valid numeric MMI is required for Wald99 GMICE conversion." }],
			warnings: [],
		};
	}

	const val = Number(mmi);
	if (val < 1.0 || val > 12.0) {
		return {
			valid: false,
			pgaG: null,
			unit: "g",
			methodId: method.id,
			classification: "GMICE",
			errors: [{ code: "OUT_OF_DOMAIN_INPUT", field: "mmi", message: `MMI ${val} is outside physical scale [1.0, 12.0].` }],
			warnings: [],
		};
	}

	const inPrimaryCaliforniaRange = val >= 5.0 && val <= 8.0;
	const warnings = [];
	if (!inPrimaryCaliforniaRange) {
		const msg = `MMI ${val} is outside Wald et al. (1999) primary California empirical calibration range [V, VIII]; conversion is extrapolated.`;
		if (options.rejectOutOfRange) {
			return {
				valid: false,
				pgaG: null,
				unit: "g",
				methodId: method.id,
				classification: "GMICE",
				inEmpiricalRange: false,
				errors: [{ code: "OUT_OF_DOMAIN_INPUT", field: "mmi", message: msg }],
				warnings: [],
			};
		}
		warnings.push({ code: "GMICE_EXTRAPOLATED", field: "mmi", message: msg });
	}

	const logPgaCmS2 = val >= 5.0
		? (val + 1.66) / 3.66
		: (val + 0.22) / 2.2;
	const pgaCmS2 = Math.pow(10, logPgaCmS2);
	const pgaG = parseFloat((pgaCmS2 / 980.665).toFixed(4));

	return {
		valid: true,
		pgaG,
		pgaCmS2: parseFloat(pgaCmS2.toFixed(2)),
		unit: "g",
		inputMmi: val,
		methodId: method.id,
		methodVersion: method.version,
		classification: "GMICE",
		empiricalRange: "MMI V-VIII (California earthquakes; Wald et al., 1999)",
		inEmpiricalRange: inPrimaryCaliforniaRange,
		extrapolated: !inPrimaryCaliforniaRange,
		reference: method.reference,
		warnings,
		errors: [],
	};
}

/**
 * Empirical relationship to estimate Peak Ground Acceleration (g) from MMI (Wald et al. 1999 GMICE)
 * MMI = 3.66 * log10(PGA) - 1.66 (for MMI >= V, PGA in cm/s^2)
 * @param {number} mmi - Modified Mercalli Intensity (I - X)
 * @returns {number} Estimated PGA in g
 */
function estimatePgaFromMmi(mmi) {
	if (!mmi || mmi < 1) return 0.01;
	const detailed = estimatePgaFromMmiDetailed(mmi);
	return detailed.valid ? detailed.pgaG : 0.01;
}

/**
 * Parse and normalize USGS Earthquake GeoJSON
 * @param {object} geojson - USGS GeoJSON FeatureCollection
 * @param {object} options - Filters and provenance options
 */
function parseUsgsFeed(geojson, options = {}) {
	if (!geojson || !Array.isArray(geojson.features)) {
		throw new Error("Invalid USGS GeoJSON: missing features array");
	}

	const retrievedAt = options.retrievedAt || new Date().toISOString();
	const payloadHash = `sha256:${computeSnapshotHash(geojson)}`;
	const minMag = options.minMagnitude !== undefined
		? options.minMagnitude
		: (CONFIG.USGS_MIN_MAGNITUDE || 4.5);
	const results = [];

	for (const feature of geojson.features) {
		const props = feature.properties || {};
		const geom = feature.geometry || {};

		const mag = parseFloat(props.mag || 0);
		if (mag < minMag) continue;

		const coords = geom.coordinates || [];
		const lon = coords[0];
		const lat = coords[1];
		const depthKm = coords[2] !== undefined ? coords[2] : null;

		const mmi = props.mmi !== null && props.mmi !== undefined ? parseFloat(props.mmi) : null;
		const hasObservedMmi = mmi !== null && Number.isFinite(mmi);
		const gmice = hasObservedMmi
			? estimatePgaFromMmiDetailed(mmi)
			: estimatePgaFromMmiDetailed(mag * 1.15);

		const placeSanitized = sanitizeUntrustedFeedText(props.place || "Unknown Location");
		const titleSanitized = sanitizeUntrustedFeedText(props.title || `M ${mag} Earthquake`);
		const sourceIssuedAt = props.time ? new Date(props.time).toISOString() : null;

		results.push({
			id: `usgs_${feature.id || props.code}`,
			usgsId: feature.id,
			title: titleSanitized.text,
			place: placeSanitized.text,
			magnitude: mag,
			magType: props.magType || "mw",
			time: sourceIssuedAt || retrievedAt,
			sourceIssuedAt,
			retrievedAt,
			payloadHash,
			coordinates: [lon, lat],
			depthKm,
			mmi,
			estimatedPgaG: hasObservedMmi || !options.strictMmi ? gmice.pgaG : null,
			gmiceMetadata: {
				methodId: "gmice.wald1999",
				classification: "GMICE",
				unit: "g",
				pgaSource: hasObservedMmi ? "usgs_shakemap_mmi_gmice" : "magnitude_heuristic_uncalibrated",
				inEmpiricalRange: hasObservedMmi ? gmice.inEmpiricalRange : false,
				extrapolated: !hasObservedMmi || gmice.extrapolated,
				warnings: hasObservedMmi
					? gmice.warnings
					: [{
						code: "UNCALIBRATED_MAGNITUDE_TO_MMI_HEURISTIC",
						message: "No instrumental MMI supplied; PGA derived from uncalibrated magnitude heuristic (mag*1.15) via Wald99 GMICE. Not suitable for loss reporting.",
					}],
			},
			alertLevel: props.alert || (mag >= 6.5 ? "red" : mag >= 5.5 ? "orange" : "green"),
			tsunamiAlert: props.tsunami === 1,
			status: props.status,
			url: props.url,
			significance: props.sig,
			untrustedFeedSecurity: {
				untrustedData: true,
				injectionDetected: placeSanitized.injectionDetected || titleSanitized.injectionDetected,
			},
		});
	}

	return results.sort((a, b) => b.magnitude - a.magnitude);
}

/**
 * Ingest USGS earthquakes via live query or sample payload
 * @param {object} options - { minMagnitude, limit, samplePayload }
 */
async function ingestUsgsEarthquakes(options = {}) {
	const retrievedAt = new Date().toISOString();
	if (options.samplePayload) {
		const payload =
			typeof options.samplePayload === "string"
				? JSON.parse(options.samplePayload)
				: options.samplePayload;
		return parseUsgsFeed(payload, { ...options, retrievedAt });
	}

	const minMag = options.minMagnitude || CONFIG.USGS_MIN_MAGNITUDE || 4.5;
	const limit = options.limit || CONFIG.USGS_DEFAULT_LIMIT || 20;
	const url = `${CONFIG.USGS_API_URL}?format=geojson&minmagnitude=${minMag}&limit=${limit}&orderby=time`;

	try {
		const data = await fetchJsonWithConfig(url);
		return parseUsgsFeed(data, { ...options, retrievedAt });
	} catch (err) {
		throw new Error(`USGS query failed (${err.message}). Use samplePayload for offline operations.`);
	}
}

module.exports = {
	USGS_API_URL: CONFIG.USGS_API_URL,
	estimatePgaFromMmi,
	estimatePgaFromMmiDetailed,
	parseUsgsFeed,
	ingestUsgsEarthquakes,
};
