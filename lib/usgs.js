/**
 * USGS Earthquake Hazards Program API Ingestion & GMPE Ground Motion Estimator
 * Connects to USGS FDSN-WS event service (https://earthquake.usgs.gov/fdsnws/event/1/)
 * Supports live network querying and offline test payloads.
 */

const { CONFIG, fetchJsonWithConfig } = require("./config");

/**
 * Empirical relationship to estimate Peak Ground Acceleration (g) from MMI (Wald et al. 1999)
 * MMI = 3.66 * log10(PGA) - 1.66 (for MMI >= V, PGA in cm/s^2)
 * @param {number} mmi - Modified Mercalli Intensity (I - X)
 * @returns {number} Estimated PGA in g
 */
function estimatePgaFromMmi(mmi) {
	if (!mmi || mmi < 1) return 0.01;
	let logPgaCmS2;
	if (mmi >= 5.0) {
		logPgaCmS2 = (mmi + 1.66) / 3.66;
	} else {
		logPgaCmS2 = (mmi + 0.22) / 2.2;
	}
	const pgaCmS2 = Math.pow(10, logPgaCmS2);
	// Convert from cm/s^2 to g (1 g = 980.665 cm/s^2)
	return parseFloat((pgaCmS2 / 980.665).toFixed(4));
}

/**
 * Parse and normalize USGS Earthquake GeoJSON
 * @param {object} geojson - USGS GeoJSON FeatureCollection
 * @param {object} options - Filters
 */
function parseUsgsFeed(geojson, options = {}) {
	if (!geojson || !Array.isArray(geojson.features)) {
		throw new Error("Invalid USGS GeoJSON: missing features array");
	}

	const minMag = options.minMagnitude || CONFIG.USGS_MIN_MAGNITUDE || 4.5;
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

		const mmi = props.mmi ? parseFloat(props.mmi) : null;
		const estimatedPga = mmi
			? estimatePgaFromMmi(mmi)
			: estimatePgaFromMmi(mag * 1.15); // Approximate epicentral intensity from magnitude

		results.push({
			id: `usgs_${feature.id || props.code}`,
			usgsId: feature.id,
			title: props.title || `M ${mag} Earthquake`,
			place: props.place || "Unknown Location",
			magnitude: mag,
			magType: props.magType || "mw",
			time: props.time ? new Date(props.time).toISOString() : new Date().toISOString(),
			coordinates: [lon, lat],
			depthKm,
			mmi,
			estimatedPgaG: estimatedPga,
			alertLevel: props.alert || (mag >= 6.5 ? "red" : mag >= 5.5 ? "orange" : "green"),
			tsunamiAlert: props.tsunami === 1,
			status: props.status,
			url: props.url,
			significance: props.sig,
		});
	}

	return results.sort((a, b) => b.magnitude - a.magnitude);
}

/**
 * Ingest USGS earthquakes via live query or sample payload
 * @param {object} options - { minMagnitude, limit, samplePayload }
 */
async function ingestUsgsEarthquakes(options = {}) {
	if (options.samplePayload) {
		const payload =
			typeof options.samplePayload === "string"
				? JSON.parse(options.samplePayload)
				: options.samplePayload;
		return parseUsgsFeed(payload, options);
	}

	const minMag = options.minMagnitude || CONFIG.USGS_MIN_MAGNITUDE || 4.5;
	const limit = options.limit || CONFIG.USGS_DEFAULT_LIMIT || 20;
	const url = `${CONFIG.USGS_API_URL}?format=geojson&minmagnitude=${minMag}&limit=${limit}&orderby=time`;

	try {
		const data = await fetchJsonWithConfig(url);
		return parseUsgsFeed(data, options);
	} catch (err) {
		throw new Error(`USGS query failed (${err.message}). Use samplePayload for offline operations.`);
	}
}

module.exports = {
	USGS_API_URL: CONFIG.USGS_API_URL,
	estimatePgaFromMmi,
	parseUsgsFeed,
	ingestUsgsEarthquakes,
};
