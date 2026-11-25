/**
 * WFP ADAM (Automated Disaster Analysis and Mapping) OGC API - Features Integration
 * Connects to https://api.adam.geospatial.wfp.org/api/collections
 *
 * Provides pre-processed humanitarian impact & exposure feeds:
 * - Earthquakes (adam.adam_eq_events): USGS-backed events with concentric population buffers
 * - Floods (adam.adam_fl_events, adam.adam_fl_alerts, adam.adam_fl_alerts_mom_forecast,
 *           adam.adam_fl_glofas_gauges_forecast): flood area/population/cropland & GloFAS return periods
 * - Tropical Storms (adam.adam_ts_events, adam.adam_ts_buffers, adam.adam_ts_tracks,
 *                    adam.adam_ts_nodes, adam.adam_ts_disturbance_*): wind buffers, tracks & pop exposure
 *
 * Pure Node.js standard library only.
 */

const { CONFIG, fetchJsonWithConfig } = require("./config");
const { sanitizeUntrustedFeedText } = require("./security");
const { computeSnapshotHash } = require("./contracts");

const ADAM_COLLECTIONS = {
	eq: "adam.adam_eq_events",
	fl: "adam.adam_fl_events",
	fl_alerts: "adam.adam_fl_alerts",
	fl_mom: "adam.adam_fl_alerts_mom_forecast",
	glofas: "adam.adam_fl_glofas_gauges_forecast",
	ts: "adam.adam_ts_events",
	ts_buffers: "adam.adam_ts_buffers",
	ts_tracks: "adam.adam_ts_tracks",
	ts_nodes: "adam.adam_ts_nodes",
	ts_disturbance_tracks: "adam.adam_ts_disturbance_tracks",
	ts_disturbance_buffers: "adam.adam_ts_disturbance_buffers",
	ts_disturbance_nodes: "adam.adam_ts_disturbance_nodes",
};

const VALID_COLLECTION_IDS = new Set(Object.values(ADAM_COLLECTIONS));

/**
 * Resolve a collection alias (e.g. "eq", "ts_buffers", "glofas") or full ID ("adam.adam_eq_events")
 * @param {string} collection
 * @returns {string}
 */
function resolveAdamCollection(collection = "eq") {
	const raw = String(collection || "eq").trim();
	if (ADAM_COLLECTIONS[raw]) return ADAM_COLLECTIONS[raw];
	if (VALID_COLLECTION_IDS.has(raw)) return raw;
	throw new Error(
		`Unknown WFP ADAM collection "${raw}". Valid aliases: ${Object.keys(ADAM_COLLECTIONS).join(", ")}`,
	);
}

/**
 * Infer normalized hazard type code from collection ID or feature properties
 */
function inferAdamHazardType(collectionId, props = {}) {
	if (props.event_type) return String(props.event_type).toUpperCase();
	if (collectionId.includes("_eq_")) return "EQ";
	if (collectionId.includes("_fl_")) return "FL";
	if (collectionId.includes("_ts_")) return "TC";
	return "Unknown";
}

/**
 * Normalize GloFAS / ADAM numeric sentinel values (e.g. "-9999.0") to null
 */
function parseAdamNullableNumber(val) {
	if (val === null || val === undefined || val === "" || val === "-") return null;
	const num = Number(val);
	if (!Number.isFinite(num) || num <= -9999) return null;
	return num;
}

/**
 * Parse and normalize a WFP ADAM OGC API GeoJSON FeatureCollection
 * @param {object} geojson - OGC API FeatureCollection
 * @param {object} options - Filters and provenance options
 * @returns {Array<object>} Normalized ADAM records
 */
function parseAdamFeatureCollection(geojson, options = {}) {
	if (!geojson || !Array.isArray(geojson.features)) {
		throw new Error("Invalid WFP ADAM GeoJSON: missing features array");
	}

	const collectionId = geojson.id || options.collectionId || "adam.unknown";
	const retrievedAt = options.retrievedAt || new Date().toISOString();
	const payloadHash = `sha256:${computeSnapshotHash(geojson)}`;

	const levelWeights = { Green: 1, Orange: 2, Red: 3 };
	const normalizeAlertLevel = (val) => {
		if (!val) return null;
		const lower = String(val).trim().toLowerCase();
		if (lower === "red") return "Red";
		if (lower === "orange") return "Orange";
		if (lower === "green") return "Green";
		return null;
	};

	const minWeight = options.minAlertLevel
		? levelWeights[normalizeAlertLevel(options.minAlertLevel) || "Green"] || 1
		: 0;
	const minMag = options.minMagnitude !== undefined && options.minMagnitude !== null
		? Number(options.minMagnitude)
		: null;

	const results = [];

	for (const feature of geojson.features) {
		const props = feature.properties || {};
		const geom = feature.geometry || {};

		const mag = parseAdamNullableNumber(props.mag);
		if (minMag !== null && Number.isFinite(minMag) && (mag === null || mag < minMag)) {
			continue;
		}

		const alertLevel = normalizeAlertLevel(props.alert_level || props.alert);
		if (minWeight > 0) {
			const currentWeight = alertLevel ? (levelWeights[alertLevel] || 1) : 1;
			if (currentWeight < minWeight) continue;
		}

		const iso3 = (props.iso3 || props.ISO3 || props.iso2 || "").trim() || null;
		if (options.iso3 && (!iso3 || iso3.toUpperCase() !== String(options.iso3).trim().toUpperCase())) {
			continue;
		}

		const rawCountry = props.country || props.adm0_name || props.countries || "";
		const countrySanitized = sanitizeUntrustedFeedText(rawCountry || "Unknown / Multi-country");
		if (options.country) {
			const match = countrySanitized.text.toLowerCase().includes(String(options.country).toLowerCase());
			if (!match) continue;
		}

		const rawName = props.name || props.place || props.riverbasin || props.eventid || props.alertid || props.uid || `${collectionId} #${feature.id}`;
		const nameSanitized = sanitizeUntrustedFeedText(String(rawName));
		const sitrepSanitized = sanitizeUntrustedFeedText(String(props.sitrep || ""));
		const adm1Sanitized = sanitizeUntrustedFeedText(String(props.adm1_name || ""));
		const basinSanitized = sanitizeUntrustedFeedText(String(props.riverbasin || ""));

		const coordinates = geom.type === "Point" && Array.isArray(geom.coordinates)
			? geom.coordinates
			: null;

		const hazardType = inferAdamHazardType(collectionId, props);
		const upstreamSourceId = props.source_id || props.event_id || props.eventid || props.alertid || props.provid || props.uid || null;
		const externalId = props.uid || upstreamSourceId || (feature.id !== undefined ? String(feature.id) : null);

		const sourceIssuedAt =
			props.published_at ||
			props.updated_at ||
			props.from_date ||
			props.effective ||
			props.forecast_base_date ||
			props.created_at ||
			null;

		const record = {
			id: `adam_${collectionId}_${feature.id ?? externalId ?? results.length + 1}`,
			collectionId,
			source: "WFP_ADAM",
			upstreamSource: props.source || null,
			upstreamSourceId,
			externalId,
			hazardType,
			name: nameSanitized.text,
			country: countrySanitized.text,
			adm1: adm1Sanitized.text || null,
			iso3,
			alertLevel,
			alertLevelNumeric: parseAdamNullableNumber(props.alertlvl),
			magnitude: mag,
			magType: props.mag_type || null,
			depthKm: parseAdamNullableNumber(props.depth),
			mmi: parseAdamNullableNumber(props.mmi),
			windSpeedKmh: parseAdamNullableNumber(props.wind_speed),
			maxStormSurgeM: parseAdamNullableNumber(props.max_storm_surge),
			stormStatus: props.current_storm_status || props.storm_status || null,
			onLand: typeof props.on_land === "boolean" ? props.on_land : null,
			distToLandKm: parseAdamNullableNumber(props.dist_to_land_km),
			exposure: {
				distKmBuff1: parseAdamNullableNumber(props.dist_km_buff_1),
				distKmBuff2: parseAdamNullableNumber(props.dist_km_buff_2),
				distKmBuff3: parseAdamNullableNumber(props.dist_km_buff_3),
				popEstBuff1: parseAdamNullableNumber(props.pop_est_buff_1),
				popEstBuff2: parseAdamNullableNumber(props.pop_est_buff_2),
				popEstBuff3: parseAdamNullableNumber(props.pop_est_buff_3),
				floodArea: parseAdamNullableNumber(props.flood_area),
				floodedPopulation: parseAdamNullableNumber(props.fl_popn),
				floodedCropland: parseAdamNullableNumber(props.fl_croplnd),
			},
			glofas: collectionId.includes("glofas") || props.riverbasin
				? {
					riverBasin: basinSanitized.text || null,
					riverName: props.rivername && props.rivername !== "unknown" ? props.rivername : null,
					prob2Yr: parseAdamNullableNumber(props["2yrProb"]),
					prob5Yr: parseAdamNullableNumber(props["5yrProb"]),
					prob20Yr: parseAdamNullableNumber(props["20yrProb"]),
					dateOfPeakDays: parseAdamNullableNumber(props.dateofpeak),
					forecastBaseDate: props.forecast_base_date || null,
					forecastPeakFlowDate: props.forecast_peakflow || null,
					trend: parseAdamNullableNumber(props.trend),
				}
				: null,
			artifacts: {
				detailUrl: props.detail_url || null,
				outputMapUrl: props.output_map_url || null,
				dashboardUrl: props.dashboard_url || null,
				populationCsvUrl: props.population_csv_url || null,
				populationTableUrl: props.population_table_url || props.output_table_url || null,
				shapefileUrl: props.shapefile_url || null,
				windMapUrl: props.wind_map_url || null,
				rainfallMapUrl: props.rainfall_map_url || null,
				sitrepPdfUrl: props.prod_url || null,
			},
			sitrep: sitrepSanitized.text || null,
			sourceIssuedAt,
			retrievedAt,
			payloadHash,
			coordinates,
			geometry: geom,
			rawProperties: props,
			untrustedFeedSecurity: {
				untrustedData: true,
				injectionDetected:
					nameSanitized.injectionDetected ||
					countrySanitized.injectionDetected ||
					sitrepSanitized.injectionDetected ||
					adm1Sanitized.injectionDetected ||
					basinSanitized.injectionDetected,
			},
		};

		results.push(record);
	}

	return results;
}

/**
 * List available collections from WFP ADAM OGC API
 * @param {object} options - { samplePayload?: object, baseUrl?: string }
 */
async function fetchAdamCollections(options = {}) {
	const baseUrl = (options.baseUrl || CONFIG.WFP_ADAM_API_URL).replace(/\/+$/, "");
	const data = options.samplePayload || (await fetchJsonWithConfig(`${baseUrl}/collections`));
	const collections = Array.isArray(data.collections) ? data.collections : [];
	return {
		source: "WFP_ADAM",
		apiUrl: `${baseUrl}/collections`,
		count: collections.length,
		collections: collections.map((c) => ({
			id: c.id,
			title: c.title || c.id,
			itemType: c.itemType || "feature",
			spatialBbox: c.extent?.spatial?.bbox?.[0] || null,
			temporalInterval: c.extent?.temporal?.interval?.[0] || null,
		})),
	};
}

/**
 * Ingest features from a WFP ADAM OGC API collection
 * @param {object} options - { collection, limit, offset, bbox, datetime, country, iso3, minMagnitude, minAlertLevel, samplePayload, baseUrl }
 * @returns {Promise<object>} { collectionId, totalMatched, count, features }
 */
async function ingestAdamFeed(options = {}) {
	const retrievedAt = new Date().toISOString();
	const collectionId = resolveAdamCollection(options.collection || "eq");

	let geojson = options.samplePayload || null;
	if (typeof geojson === "string") {
		geojson = JSON.parse(geojson);
	}

	if (!geojson) {
		const baseUrl = (options.baseUrl || CONFIG.WFP_ADAM_API_URL).replace(/\/+$/, "");
		const params = new URLSearchParams();
		params.set("limit", String(options.limit || 20));
		if (options.offset !== undefined && options.offset !== null) {
			params.set("offset", String(options.offset));
		}
		if (options.bbox) {
			params.set("bbox", Array.isArray(options.bbox) ? options.bbox.join(",") : String(options.bbox));
		}
		if (options.datetime) {
			params.set("datetime", String(options.datetime));
		}

		const url = `${baseUrl}/collections/${encodeURIComponent(collectionId)}/items?${params.toString()}`;
		geojson = await fetchJsonWithConfig(url, {
			Accept: "application/geo+json",
		});
	}

	const features = parseAdamFeatureCollection(geojson, {
		...options,
		collectionId,
		retrievedAt,
	});

	return {
		source: "WFP_ADAM",
		collectionId,
		totalMatched: geojson.numberMatched ?? features.length,
		count: features.length,
		retrievedAt,
		features,
	};
}

module.exports = {
	WFP_ADAM_API_URL: CONFIG.WFP_ADAM_API_URL,
	ADAM_COLLECTIONS,
	resolveAdamCollection,
	parseAdamNullableNumber,
	parseAdamFeatureCollection,
	fetchAdamCollections,
	ingestAdamFeed,
};
