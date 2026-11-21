/**
 * OGC SensorThings API v1.1 (OGC 18-088) Custom Sensor Telemetry Adapter
 *
 * Enables government agencies (NMHS, USGS, national hydrological/seismic agencies)
 * and private IoT sensor providers to integrate in-situ gauges (water level, flood
 * depth, rainfall, river discharge, wind speed, ground acceleration) using the
 * open OGC SensorThings API v1.1 REST/JSON standard.
 *
 * Security & Governance:
 * - Zero external dependencies (pure Node.js standard library)
 * - SSRF host protection on custom endpoints (respects ALLOW_PRIVATE_WEBHOOKS)
 * - Untrusted feed text sanitization (prompt-injection guard)
 * - Missing-data preservation (null/missing readings are never coerced to 0)
 * - WMO/QARTOD quality control flag filtering (bad/missing excluded from triggers)
 * - Staleness detection, calibration metadata, and private redistribution flags
 * - SHA-256 payload provenance hash & C-03 governance metadata
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

const SENSORTHINGS_METHOD_ID = "telemetry.ogc.sensorthings_v1_1";

/**
 * Normalize unit string to canonical DRR unit & conversion factor.
 * Returns { canonicalUnit, convert(val), domain } or null if unrecognized.
 */
function resolveSensorUnit(rawUnit) {
	if (!rawUnit || typeof rawUnit !== "string") return null;
	const u = rawUnit.trim().toLowerCase();

	// Length / Water Level / Inundation Depth -> meters ("m")
	if (u === "m" || u === "meter" || u === "meters" || u === "metre" || u === "metres") {
		return { canonicalUnit: "m", domain: "water_level_or_depth", convert: (v) => v };
	}
	if (u === "cm" || u === "centimeter" || u === "centimeters") {
		return { canonicalUnit: "m", domain: "water_level_or_depth", convert: (v) => v / 100 };
	}
	if (u === "ft" || u === "foot" || u === "feet") {
		return { canonicalUnit: "m", domain: "water_level_or_depth", convert: (v) => v * 0.3048 };
	}

	// Precipitation -> millimeters ("mm")
	if (u === "mm" || u === "millimeter" || u === "millimeters" || u === "mm/h" || u === "mm/hr") {
		return { canonicalUnit: u.includes("/") ? "mm/h" : "mm", domain: "precipitation", convert: (v) => v };
	}
	if (u === "in" || u === "inch" || u === "inches") {
		return { canonicalUnit: "mm", domain: "precipitation", convert: (v) => v * 25.4 };
	}

	// River Discharge -> cubic meters per second ("m3/s")
	if (u === "m3/s" || u === "m^3/s" || u === "m³/s" || u === "cms" || u === "cumecs") {
		return { canonicalUnit: "m3/s", domain: "river_discharge", convert: (v) => v };
	}
	if (u === "ft3/s" || u === "ft^3/s" || u === "cfs") {
		return { canonicalUnit: "m3/s", domain: "river_discharge", convert: (v) => v * 0.0283168466 };
	}

	// Wind Speed -> km/h
	if (u === "km/h" || u === "kph" || u === "kmh") {
		return { canonicalUnit: "km/h", domain: "wind_speed", convert: (v) => v };
	}
	if (u === "m/s" || u === "mps") {
		return { canonicalUnit: "km/h", domain: "wind_speed", convert: (v) => v * 3.6 };
	}
	if (u === "kt" || u === "kts" || u === "knot" || u === "knots") {
		return { canonicalUnit: "km/h", domain: "wind_speed", convert: (v) => v * 1.852 };
	}
	if (u === "mph") {
		return { canonicalUnit: "km/h", domain: "wind_speed", convert: (v) => v * 1.609344 };
	}

	// Seismic Ground Acceleration -> g
	if (u === "g") {
		return { canonicalUnit: "g", domain: "ground_acceleration", convert: (v) => v };
	}
	if (u === "m/s2" || u === "m/s^2" || u === "m/s²") {
		return { canonicalUnit: "g", domain: "ground_acceleration", convert: (v) => v / 9.80665 };
	}
	if (u === "cm/s2" || u === "cm/s^2" || u === "gal") {
		return { canonicalUnit: "g", domain: "ground_acceleration", convert: (v) => v / 980.665 };
	}

	return null;
}

/**
 * Normalize WMO / IOOS QARTOD quality control flag to canonical token.
 * QARTOD numeric codes: 1=good, 2=not_evaluated, 3=suspect, 4=bad, 9=missing
 */
function normalizeQcFlag(obs) {
	const raw =
		obs?.parameters?.qcFlag ??
		obs?.parameters?.qualityFlag ??
		obs?.resultQuality ??
		null;

	if (raw === null || raw === undefined || raw === "") {
		return "not_evaluated";
	}
	if (typeof raw === "number") {
		if (raw === 1) return "good";
		if (raw === 2) return "not_evaluated";
		if (raw === 3) return "suspect";
		if (raw === 4) return "bad";
		if (raw === 9) return "missing";
		return "not_evaluated";
	}
	const s = String(raw).trim().toLowerCase();
	if (s === "good" || s === "pass" || s === "valid" || s === "1") return "good";
	if (s === "suspect" || s === "questionable" || s === "warning" || s === "3") return "suspect";
	if (s === "bad" || s === "fail" || s === "invalid" || s === "rejected" || s === "4") return "bad";
	if (s === "missing" || s === "nodata" || s === "9") return "missing";
	return "not_evaluated";
}

/**
 * Extract GeoJSON geometry & representative [lon, lat] coordinates from a Datastream or Thing
 */
function extractSensorLocation(datastream) {
	const thingLocations = datastream?.Thing?.Locations;
	let geom = null;

	if (Array.isArray(thingLocations) && thingLocations.length > 0) {
		const loc = thingLocations[0]?.location || thingLocations[0];
		if (loc && loc.type === "Feature" && loc.geometry) {
			geom = loc.geometry;
		} else if (loc && loc.type && loc.coordinates) {
			geom = loc;
		}
	}

	if (!geom && datastream?.observedArea && datastream.observedArea.type) {
		geom = datastream.observedArea;
	}

	if (!geom && Array.isArray(datastream?.Observations) && datastream.Observations.length > 0) {
		const foi = datastream.Observations[0]?.FeatureOfInterest?.feature;
		if (foi && foi.type === "Feature" && foi.geometry) {
			geom = foi.geometry;
		} else if (foi && foi.type && foi.coordinates) {
			geom = foi;
		}
	}

	let coordinates = null;
	if (geom && geom.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
		coordinates = [Number(geom.coordinates[0]), Number(geom.coordinates[1])];
	}

	return { geometry: geom, coordinates };
}

/**
 * Parse a timestamp (or ISO interval "start/end") and return its end/instant ISO string
 */
function parsePhenomenonTime(rawTime) {
	if (!rawTime || typeof rawTime !== "string") return null;
	const parts = rawTime.split("/");
	const candidate = parts[parts.length - 1].trim();
	const ts = Date.parse(candidate);
	if (Number.isNaN(ts)) return null;
	return new Date(ts).toISOString();
}

/**
 * Build an OGC SensorThings API v1.1 Datastreams query URL with standard $expand/$filter/$top
 * @param {string} baseUrl - SensorThings API root (e.g. https://sensors.agency.gov/v1.1) or /Datastreams URL
 * @param {object} options - { observedProperty, top, observationsTop, filter }
 * @returns {string}
 */
function buildSensorThingsUrl(baseUrl, options = {}) {
	if (!baseUrl || typeof baseUrl !== "string") {
		throw new Error("OGC SensorThings endpointUrl is required when no samplePayload is provided.");
	}
	let parsed;
	try {
		parsed = new URL(baseUrl);
	} catch (err) {
		throw new Error(`Invalid OGC SensorThings URL: ${baseUrl}`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported protocol for OGC SensorThings URL: ${parsed.protocol}`);
	}

	if (!CONFIG.ALLOW_PRIVATE_WEBHOOKS && isBlockedWebhookHost(parsed.hostname)) {
		throw new Error(
			`SSRF guard blocked OGC SensorThings host "${parsed.hostname}". Set DRR_ALLOW_PRIVATE_WEBHOOKS=true only for trusted internal EOC networks.`,
		);
	}

	// Append /Datastreams if caller passed the service root
	const cleanPath = parsed.pathname.replace(/\/+$/, "");
	if (!/\/(Datastreams|Observations)(\([^)]*\))?$/i.test(cleanPath)) {
		parsed.pathname = `${cleanPath}/Datastreams`;
	}

	const obsTop = Number.isInteger(options.observationsTop) && options.observationsTop > 0
		? Math.min(options.observationsTop, 100)
		: 5;

	if (!parsed.searchParams.has("$expand")) {
		parsed.searchParams.set(
			"$expand",
			`Thing($expand=Locations),Sensor,ObservedProperty,Observations($orderby=phenomenonTime desc;$top=${obsTop})`,
		);
	}

	const top = Number.isInteger(options.top) && options.top > 0 ? Math.min(options.top, 200) : 50;
	if (!parsed.searchParams.has("$top")) {
		parsed.searchParams.set("$top", String(top));
	}

	if (options.filter && typeof options.filter === "string" && !parsed.searchParams.has("$filter")) {
		parsed.searchParams.set("$filter", options.filter);
	} else if (
		options.observedProperty &&
		typeof options.observedProperty === "string" &&
		!parsed.searchParams.has("$filter")
	) {
		const safeProp = options.observedProperty.replace(/'/g, "''");
		parsed.searchParams.set("$filter", `substringof('${safeProp}',ObservedProperty/name)`);
	}

	return parsed.toString();
}

/**
 * Parse and normalize an OGC SensorThings API v1.1 payload (Datastreams collection,
 * single Datastream, or standalone Observations collection).
 *
 * @param {object} payload - Raw OGC SensorThings v1.1 JSON
 * @param {object} options - {
 *   observedProperty?: string,
 *   providerType?: string,
 *   thresholds?: { warning?: number, critical?: number, unit?: string },
 *   maxAgeMinutes?: number,
 *   excludeSuspect?: boolean,
 *   retrievedAt?: string,
 *   sourceUrl?: string
 * }
 * @returns {object} Normalized provenance-tracked telemetry report
 */
function parseSensorThingsPayload(payload, options = {}) {
	if (!payload || typeof payload !== "object") {
		throw new Error("Invalid OGC SensorThings payload: expected a JSON object");
	}

	const retrievedAt = options.retrievedAt || new Date().toISOString();
	const retrievedMs = Date.parse(retrievedAt);
	const maxAgeMinutes =
		typeof options.maxAgeMinutes === "number" && options.maxAgeMinutes > 0
			? options.maxAgeMinutes
			: 180;
	const excludeSuspect = Boolean(options.excludeSuspect);
	const payloadHash = `sha256:${computeSnapshotHash(payload)}`;

	// Normalize input shape into an array of Datastream-like objects
	let rawDatastreams = [];
	if (Array.isArray(payload.value)) {
		const first = payload.value[0];
		// Detect standalone Observations collection vs Datastreams collection
		if (first && ("result" in first || "phenomenonTime" in first) && !("unitOfMeasurement" in first)) {
			rawDatastreams = [
				{
					"@iot.id": "observations-collection",
					name: "Standalone Observations Collection",
					description: "",
					unitOfMeasurement: first.unitOfMeasurement || {},
					ObservedProperty: first.ObservedProperty || {},
					Thing: first.Thing || {},
					Sensor: first.Sensor || {},
					Observations: payload.value,
				},
			];
		} else {
			rawDatastreams = payload.value;
		}
	} else if ("@iot.id" in payload || "Observations" in payload || "unitOfMeasurement" in payload) {
		rawDatastreams = [payload];
	} else {
		throw new Error(
			"Invalid OGC SensorThings payload: expected { value: [...] } or a Datastream object",
		);
	}

	const thresholds = options.thresholds || null;
	let thresholdUnitInfo = null;
	if (thresholds && thresholds.unit) {
		thresholdUnitInfo = resolveSensorUnit(thresholds.unit);
	}

	const normalizedDatastreams = [];
	let totalObservations = 0;
	let validObservations = 0;
	let badOrMissingObservations = 0;
	let suspectObservations = 0;
	let staleDatastreams = 0;
	let anyPromptInjection = false;
	let anyRestrictedRedistribution = false;
	let latestSourceIssuedAt = null;

	const propertyFilter = options.observedProperty
		? String(options.observedProperty).trim().toLowerCase()
		: null;

	for (const ds of rawDatastreams) {
		if (!ds || typeof ds !== "object") continue;

		const obsPropRaw = ds.ObservedProperty || {};
		const propNameSanitized = sanitizeUntrustedFeedText(obsPropRaw.name || ds.name || "Unknown Property");
		const propDescSanitized = sanitizeUntrustedFeedText(obsPropRaw.description || "");
		const dsNameSanitized = sanitizeUntrustedFeedText(ds.name || `Datastream ${ds["@iot.id"] || ""}`.trim());
		const dsDescSanitized = sanitizeUntrustedFeedText(ds.description || "");
		const thingRaw = ds.Thing || {};
		const thingNameSanitized = sanitizeUntrustedFeedText(thingRaw.name || "");
		const sensorRaw = ds.Sensor || {};
		const sensorNameSanitized = sanitizeUntrustedFeedText(sensorRaw.name || "");

		const dsInjection =
			propNameSanitized.injectionDetected ||
			propDescSanitized.injectionDetected ||
			dsNameSanitized.injectionDetected ||
			dsDescSanitized.injectionDetected ||
			thingNameSanitized.injectionDetected ||
			sensorNameSanitized.injectionDetected;
		if (dsInjection) anyPromptInjection = true;

		if (
			propertyFilter &&
			!propNameSanitized.text.toLowerCase().includes(propertyFilter) &&
			!dsNameSanitized.text.toLowerCase().includes(propertyFilter)
		) {
			continue;
		}

		const uom = ds.unitOfMeasurement || {};
		const rawUnitSymbol = uom.symbol || uom.name || null;
		const unitInfo = resolveSensorUnit(rawUnitSymbol);

		const { geometry, coordinates } = extractSensorLocation(ds);

		const thingProps = thingRaw.properties || {};
		const sensorProps = sensorRaw.properties || {};
		const dsProps = ds.properties || {};

		const providerType =
			dsProps.providerType ||
			thingProps.providerType ||
			options.providerType ||
			"unspecified";
		const license = dsProps.license || thingProps.license || null;
		const redistributionAllowed =
			dsProps.redistributionAllowed !== undefined
				? Boolean(dsProps.redistributionAllowed)
				: thingProps.redistributionAllowed !== undefined
					? Boolean(thingProps.redistributionAllowed)
					: providerType !== "private";
		if (!redistributionAllowed) anyRestrictedRedistribution = true;

		const calibrationDate =
			sensorProps.calibrationDate || thingProps.calibrationDate || dsProps.calibrationDate || null;

		const rawObsList = Array.isArray(ds.Observations) ? ds.Observations : [];
		const observations = [];

		for (const obs of rawObsList) {
			if (!obs || typeof obs !== "object") continue;
			totalObservations += 1;

			const qcFlag = normalizeQcFlag(obs);
			const phenomenonTime = parsePhenomenonTime(obs.phenomenonTime);
			const resultTime = parsePhenomenonTime(obs.resultTime) || phenomenonTime;

			// Preserve null/missing values (never coerce null/""/NaN to 0)
			const rawResult = obs.result;
			let numericValue = null;
			if (typeof rawResult === "number" && Number.isFinite(rawResult)) {
				numericValue = rawResult;
			} else if (typeof rawResult === "string" && rawResult.trim() !== "") {
				const parsedNum = Number(rawResult);
				if (Number.isFinite(parsedNum)) numericValue = parsedNum;
			}

			const effectiveQc = numericValue === null ? "missing" : qcFlag;

			if (effectiveQc === "bad" || effectiveQc === "missing") {
				badOrMissingObservations += 1;
			} else if (effectiveQc === "suspect") {
				suspectObservations += 1;
			} else {
				validObservations += 1;
			}

			let normalizedValue = numericValue;
			let normalizedUnit = rawUnitSymbol;
			if (numericValue !== null && unitInfo) {
				normalizedValue = Number(unitInfo.convert(numericValue).toFixed(6));
				normalizedUnit = unitInfo.canonicalUnit;
			}

			if (resultTime && (!latestSourceIssuedAt || resultTime > latestSourceIssuedAt)) {
				latestSourceIssuedAt = resultTime;
			}

			observations.push({
				id: obs["@iot.id"] !== undefined ? String(obs["@iot.id"]) : null,
				phenomenonTime,
				resultTime,
				result: rawResult !== undefined ? rawResult : null,
				numericValue,
				unit: rawUnitSymbol,
				normalizedValue,
				normalizedUnit,
				qualityControlFlag: effectiveQc,
			});
		}

		// Sort newest first by resultTime/phenomenonTime
		observations.sort((a, b) => {
			const ta = a.resultTime ? Date.parse(a.resultTime) : 0;
			const tb = b.resultTime ? Date.parse(b.resultTime) : 0;
			return tb - ta;
		});

		const usableObs = observations.find((o) => {
			if (o.numericValue === null) return false;
			if (o.qualityControlFlag === "bad" || o.qualityControlFlag === "missing") return false;
			if (excludeSuspect && o.qualityControlFlag === "suspect") return false;
			return true;
		}) || null;

		let ageMinutes = null;
		let stale = false;
		if (usableObs && usableObs.resultTime && !Number.isNaN(retrievedMs)) {
			ageMinutes = Number(((retrievedMs - Date.parse(usableObs.resultTime)) / 60000).toFixed(2));
			if (ageMinutes > maxAgeMinutes) {
				stale = true;
				staleDatastreams += 1;
			}
		}

		// Threshold evaluation against latest valid observation
		let thresholdStatus = "not_evaluated";
		let thresholdExceeded = false;
		if (thresholds && (thresholds.warning !== undefined || thresholds.critical !== undefined)) {
			if (!usableObs) {
				thresholdStatus = "no_valid_data";
			} else if (
				thresholdUnitInfo &&
				unitInfo &&
				thresholdUnitInfo.canonicalUnit !== unitInfo.canonicalUnit
			) {
				// Prevent cross-unit/cross-domain false triggers (e.g., comparing mm rainfall against m flood level)
				thresholdStatus = "unit_mismatch_not_evaluated";
			} else {
				let compareVal = usableObs.normalizedValue;
				let warnVal = thresholds.warning;
				let critVal = thresholds.critical;

				if (thresholdUnitInfo && unitInfo && thresholdUnitInfo.canonicalUnit === unitInfo.canonicalUnit) {
					if (typeof warnVal === "number") warnVal = thresholdUnitInfo.convert(warnVal);
					if (typeof critVal === "number") critVal = thresholdUnitInfo.convert(critVal);
				}

				if (typeof critVal === "number" && compareVal >= critVal) {
					thresholdStatus = "critical";
					thresholdExceeded = true;
				} else if (typeof warnVal === "number" && compareVal >= warnVal) {
					thresholdStatus = "warning";
					thresholdExceeded = true;
				} else {
					thresholdStatus = "normal";
				}
			}
		}

		const evidenceBasis =
			usableObs && usableObs.qualityControlFlag === "good" && !stale
				? "observed"
				: "unverified_sensor";

		normalizedDatastreams.push({
			datastreamId: ds["@iot.id"] !== undefined ? String(ds["@iot.id"]) : null,
			name: dsNameSanitized.text,
			description: dsDescSanitized.text,
			thing: {
				id: thingRaw["@iot.id"] !== undefined ? String(thingRaw["@iot.id"]) : null,
				name: thingNameSanitized.text,
			},
			sensor: {
				id: sensorRaw["@iot.id"] !== undefined ? String(sensorRaw["@iot.id"]) : null,
				name: sensorNameSanitized.text,
				encodingType: sensorRaw.encodingType || null,
				calibrationDate,
			},
			observedProperty: {
				id: obsPropRaw["@iot.id"] !== undefined ? String(obsPropRaw["@iot.id"]) : null,
				name: propNameSanitized.text,
				definition: obsPropRaw.definition || null,
				domain: unitInfo ? unitInfo.domain : "other",
			},
			unitOfMeasurement: {
				rawSymbol: rawUnitSymbol,
				canonicalUnit: unitInfo ? unitInfo.canonicalUnit : rawUnitSymbol,
			},
			location: {
				coordinates,
				geometry,
			},
			latestValidObservation: usableObs,
			observationsCount: observations.length,
			observations,
			freshness: {
				ageMinutes,
				maxAgeMinutes,
				stale,
			},
			thresholdEvaluation: {
				status: thresholdStatus,
				exceeded: thresholdExceeded,
				thresholds: thresholds || null,
			},
			licensing: {
				providerType,
				license,
				redistributionAllowed,
			},
			governanceMetadata: {
				evidenceBasis,
				verificationStatus: "unreviewed",
				approvalStatus: "draft",
				reportingEligibility: "pending",
			},
			untrustedFeedSecurity: {
				untrustedData: true,
				injectionDetected: dsInjection,
			},
		});
	}

	const alertingDatastreams = normalizedDatastreams.filter(
		(d) => d.thresholdEvaluation.exceeded,
	);

	return {
		standard: "OGC SensorThings API v1.1 (OGC 18-088)",
		method: getRegisteredMethod(SENSORTHINGS_METHOD_ID),
		sourceUrl: options.sourceUrl ? redactUrlSecrets(options.sourceUrl) : "offline_fixture",
		sourceIssuedAt: latestSourceIssuedAt,
		retrievedAt,
		payloadHash,
		summary: {
			datastreamCount: normalizedDatastreams.length,
			totalObservations,
			validObservations,
			suspectObservations,
			badOrMissingObservations,
			staleDatastreams,
			warningCount: normalizedDatastreams.filter((d) => d.thresholdEvaluation.status === "warning").length,
			criticalCount: normalizedDatastreams.filter((d) => d.thresholdEvaluation.status === "critical").length,
			anyRestrictedRedistribution,
		},
		alertingDatastreams: alertingDatastreams.map((d) => ({
			datastreamId: d.datastreamId,
			name: d.name,
			station: d.thing.name,
			status: d.thresholdEvaluation.status,
			value: d.latestValidObservation ? d.latestValidObservation.normalizedValue : null,
			unit: d.latestValidObservation ? d.latestValidObservation.normalizedUnit : null,
			stale: d.freshness.stale,
			redistributionAllowed: d.licensing.redistributionAllowed,
		})),
		datastreams: normalizedDatastreams,
		untrustedFeedSecurity: {
			untrustedData: true,
			promptInjectionFlagged: anyPromptInjection,
		},
	};
}

/**
 * Convert a parsed OGC SensorThings report into a GeoJSON FeatureCollection
 * compatible with drr_spatial_exposure_join or GIS mapping.
 */
function toSensorGeoJSON(parsedReport) {
	const datastreams = Array.isArray(parsedReport?.datastreams) ? parsedReport.datastreams : [];
	const features = [];

	for (const ds of datastreams) {
		if (!ds.location || !ds.location.geometry) continue;
		features.push({
			type: "Feature",
			id: ds.datastreamId || ds.name,
			geometry: ds.location.geometry,
			properties: {
				name: ds.thing?.name || ds.name,
				datastreamName: ds.name,
				observedProperty: ds.observedProperty?.name || null,
				domain: ds.observedProperty?.domain || "other",
				latestValue: ds.latestValidObservation ? ds.latestValidObservation.normalizedValue : null,
				unit: ds.latestValidObservation ? ds.latestValidObservation.normalizedUnit : ds.unitOfMeasurement?.canonicalUnit,
				qualityControlFlag: ds.latestValidObservation ? ds.latestValidObservation.qualityControlFlag : "missing",
				resultTime: ds.latestValidObservation ? ds.latestValidObservation.resultTime : null,
				stale: ds.freshness?.stale || false,
				thresholdStatus: ds.thresholdEvaluation?.status || "not_evaluated",
				providerType: ds.licensing?.providerType || "unspecified",
				redistributionAllowed: ds.licensing?.redistributionAllowed ?? true,
				evidenceBasis: ds.governanceMetadata?.evidenceBasis || "unverified_sensor",
			},
		});
	}

	return {
		type: "FeatureCollection",
		features,
	};
}

/**
 * Ingest OGC SensorThings API v1.1 data from either an offline samplePayload or live HTTP(S) endpoint.
 *
 * @param {object} options - {
 *   endpointUrl?: string,
 *   apiKey?: string,
 *   apiKeyHeader?: string,
 *   observedProperty?: string,
 *   filter?: string,
 *   top?: number,
 *   observationsTop?: number,
 *   providerType?: string,
 *   thresholds?: { warning?: number, critical?: number, unit?: string },
 *   maxAgeMinutes?: number,
 *   excludeSuspect?: boolean,
 *   samplePayload?: object | string
 * }
 * @returns {Promise<object>}
 */
async function ingestSensorThings(options = {}) {
	const retrievedAt = options.retrievedAt || new Date().toISOString();
	let payload = options.samplePayload || null;
	let resolvedUrl = null;

	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch (err) {
			throw new Error(`Failed to parse OGC SensorThings samplePayload JSON: ${err.message}`);
		}
	}

	if (!payload) {
		const baseUrl = options.endpointUrl || CONFIG.OGC_SENSORTHINGS_URL;
		resolvedUrl = buildSensorThingsUrl(baseUrl, options);

		const headers = {};
		const apiKey = options.apiKey || CONFIG.OGC_SENSORTHINGS_API_KEY;
		const apiKeyHeader = options.apiKeyHeader || CONFIG.OGC_SENSORTHINGS_API_KEY_HEADER || "X-API-Key";
		if (apiKey) {
			headers[apiKeyHeader] = apiKey;
		}

		payload = await fetchJsonWithConfig(resolvedUrl, headers);
	}

	return parseSensorThingsPayload(payload, {
		...options,
		retrievedAt,
		sourceUrl: resolvedUrl,
	});
}

module.exports = {
	SENSORTHINGS_METHOD_ID,
	resolveSensorUnit,
	normalizeQcFlag,
	buildSensorThingsUrl,
	parseSensorThingsPayload,
	toSensorGeoJSON,
	ingestSensorThings,
};
