/**
 * Global Disaster Alert and Coordination System (GDACS) Feed Ingestion & Parser
 * Supports live HTTP(S) fetching and offline/fixture GeoJSON ingestion.
 */

const { CONFIG, fetchJsonWithConfig } = require("./config");

/**
 * Map GDACS event type code to human-readable label
 */
function mapEventType(code) {
	const map = {
		EQ: "Earthquake",
		TC: "Tropical Cyclone",
		FL: "Flood",
		VO: "Volcano",
		DR: "Drought",
		WF: "Wildfire",
		TS: "Tsunami",
	};
	return map[code] || code || "Unknown";
}

/**
 * Parse and normalize GDACS GeoJSON events into clean DRR records
 * @param {object} geojson - GDACS GeoJSON FeatureCollection
 * @param {object} filters - { minAlertLevel: 'Green'|'Orange'|'Red', eventType: string, country: string }
 * @returns {Array<object>} Normalized event items
 */
function parseGdacsFeed(geojson, filters = {}) {
	if (!geojson || !Array.isArray(geojson.features)) {
		throw new Error("Invalid GDACS GeoJSON: missing features array");
	}

	const minLevel = filters.minAlertLevel || "Green";
	const levelWeights = { Green: 1, Orange: 2, Red: 3 };
	const minWeight = levelWeights[minLevel] || 1;

	const results = [];

	for (const feature of geojson.features) {
		const props = feature.properties || {};
		const geom = feature.geometry || {};

		const alertLevel = props.alertlevel || props.alertLevel || "Green";
		const currentWeight = levelWeights[alertLevel] || 1;

		if (currentWeight < minWeight) continue;

		const eventType = props.eventtype || props.eventType || "Unknown";
		if (filters.eventType && filters.eventType.toUpperCase() !== eventType.toUpperCase()) {
			continue;
		}

		if (filters.country && props.country) {
			const countryMatch = props.country
				.toLowerCase()
				.includes(filters.country.toLowerCase());
			if (!countryMatch) continue;
		}

		// Coordinates
		let coordinates = null;
		if (geom.type === "Point") {
			coordinates = geom.coordinates; // [lon, lat]
		}

		results.push({
			id: props.eventid ? `${eventType}_${props.eventid}` : `gdacs_${results.length + 1}`,
			eventId: props.eventid,
			episodeId: props.episodeid,
			eventName: props.eventname || props.name || `${mapEventType(eventType)} Event`,
			eventType,
			eventTypeLabel: mapEventType(eventType),
			alertLevel,
			alertScore: parseFloat(props.alertscore || 0),
			country: props.country || "Multi-country / International waters",
			fromdate: props.fromdate,
			todate: props.todate,
			severityText: props.severitydata?.severitytext || props.severity || "",
			populationAffected: parseInt(props.population?.value || props.population || 0, 10),
			coordinates,
			geometry: geom,
			url: props.url?.report || props.url || null,
			rawProperties: props,
		});
	}

	return results.sort((a, b) => b.alertScore - a.alertScore);
}

/**
 * Ingest GDACS alerts either from live feed or from provided GeoJSON string/object
 * @param {object|string|null} input - GeoJSON object, JSON string, or null (fetch live)
 * @param {object} filters 
 * @returns {Promise<Array<object>>}
 */
async function ingestGdacsAlerts(input = null, filters = {}) {
	let geojson = input;

	if (typeof input === "string") {
		try {
			geojson = JSON.parse(input);
		} catch (err) {
			throw new Error(`Failed to parse input JSON: ${err.message}`);
		}
	}

	if (!geojson) {
		geojson = await fetchJsonWithConfig(CONFIG.GDACS_FEED_URL);
	}

	return parseGdacsFeed(geojson, filters);
}

module.exports = {
	GDACS_FEED_URL: CONFIG.GDACS_FEED_URL,
	mapEventType,
	parseGdacsFeed,
	ingestGdacsAlerts,
};
