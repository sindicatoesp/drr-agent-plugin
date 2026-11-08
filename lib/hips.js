/**
 * UNDRR / ISC Hazard Information Profiles (HIPs) Taxonomy Module
 *
 * Provides in-code canonical mapping for all 8 HIP Types, 49 Clusters, and 301 Hazards
 * defined in the Sendai Framework and UNDRR / ISC technical reports.
 * Used for automated entity linkage in DELTA Resilience (disaster_event and disaster_records).
 */

const hipsData = require("./hips-data.json");

const HIP_TYPES = hipsData.types;
const HIP_CLUSTERS = hipsData.clusters;
const HIP_HAZARDS = hipsData.hazards;

// Build fast in-memory lookup indexes
const HAZARD_BY_ID = new Map();
const HAZARD_BY_CODE = new Map();
const HAZARD_BY_NAME_LOWER = new Map();

for (const h of HIP_HAZARDS) {
	HAZARD_BY_ID.set(String(h.id), h);
	HAZARD_BY_CODE.set(h.code.toUpperCase(), h);
	HAZARD_BY_NAME_LOWER.set(h.name.toLowerCase(), h);
}

/**
 * Common operational aliases and abbreviations mapping to standard HIP hazard codes
 */
const COMMON_ALIASES = {
	earthquake: "GH0001",
	eq: "GH0001",
	seismic: "GH0001",
	quake: "GH0001",
	flood: "MH0007",
	fl: "MH0007",
	fluvial: "MH0007",
	riverine: "MH0007",
	riverine_flood: "MH0007",
	flash_flood: "MH0006",
	flashflood: "MH0006",
	coastal_flood: "MH0004",
	storm_surge: "MH0004",
	cyclone: "MH0057",
	tc: "MH0057",
	tropical_cyclone: "MH0057",
	hurricane: "MH0057",
	typhoon: "MH0057",
	wind: "MH0057",
	windstorm: "MH0057",
	tsunami: "GH0006",
	volcano: "GH0015",
	vo: "GH0015",
	volcanic: "GH0015",
	eruption: "GH0015",
	drought: "MH0035",
	dr: "MH0035",
	wildfire: "EN0013",
	wf: "EN0013",
	bushfire: "EN0013",
	forest_fire: "EN0013",
	landslide: "GH0007",
	mudslide: "GH0007",
	debris_flow: "GH0007",
	heatwave: "MH0049",
	extreme_heat: "MH0049",
	coldwave: "MH0048",
	extreme_cold: "MH0048",
	tornado: "MH0056",
	hail: "MH0043",
	hailstorm: "MH0043",
	locust: "BI0003",
	pest_infestation: "BI0002",
	epidemic: "BI0020",
	pandemic: "BI0020",
};

/**
 * Enrich raw hazard object with cluster and type metadata
 */
function enrichHazard(hazard) {
	if (!hazard) return null;
	const cluster = HIP_CLUSTERS[hazard.clusterId] || {};
	const type = HIP_TYPES[hazard.typeId || cluster.typeId] || {};
	return {
		hipHazardId: String(hazard.id),
		hipClusterId: String(hazard.clusterId),
		hipTypeId: String(hazard.typeId || cluster.typeId),
		code: hazard.code,
		name: hazard.name,
		clusterName: cluster.name || "",
		typeName: type.name || "",
	};
}

/**
 * Look up official UNDRR/ISC HIP hierarchy by ID, Code, natural keyword, or alias
 * @param {string|object} query - Hazard query (e.g. "GH0001", "78531", "earthquake", "flood", "TC")
 * @returns {object|null} Enriched HIP mapping or null
 */
function lookupHip(query) {
	if (!query) return null;

	if (typeof query === "object") {
		if (query.hipHazardId && query.hipClusterId && query.hipTypeId) {
			const existing = HAZARD_BY_ID.get(String(query.hipHazardId));
			if (existing) {
				return enrichHazard(existing);
			}
			return {
				hipHazardId: String(query.hipHazardId),
				hipClusterId: String(query.hipClusterId),
				hipTypeId: String(query.hipTypeId),
				code: query.code || "CUSTOM",
				name: query.name || "Custom Hazard",
				clusterName: query.clusterName || "",
				typeName: query.typeName || "",
			};
		}
		if (query.hazardType) return lookupHip(query.hazardType);
		if (query.code) return lookupHip(query.code);
		if (query.id) return lookupHip(query.id);
		if (query.name) return lookupHip(query.name);
		return null;
	}

	const raw = String(query).trim();
	const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");

	// 1. Check ID directly
	if (HAZARD_BY_ID.has(raw)) {
		return enrichHazard(HAZARD_BY_ID.get(raw));
	}

	// 2. Check Code directly (e.g. "GH0001")
	const upper = raw.toUpperCase();
	if (HAZARD_BY_CODE.has(upper)) {
		return enrichHazard(HAZARD_BY_CODE.get(upper));
	}

	// 3. Check Common Aliases
	if (COMMON_ALIASES[normalized]) {
		const code = COMMON_ALIASES[normalized];
		if (HAZARD_BY_CODE.has(code)) {
			return enrichHazard(HAZARD_BY_CODE.get(code));
		}
	}

	// 4. Exact Name Match
	if (HAZARD_BY_NAME_LOWER.has(raw.toLowerCase())) {
		return enrichHazard(HAZARD_BY_NAME_LOWER.get(raw.toLowerCase()));
	}

	// 5. Substring Search
	const queryLower = raw.toLowerCase();
	for (const h of HIP_HAZARDS) {
		const nameLower = h.name.toLowerCase();
		if (nameLower.includes(queryLower) || queryLower.includes(nameLower)) {
			return enrichHazard(h);
		}
	}

	return null;
}

/**
 * Filter or search hazards across the taxonomy
 * @param {object} params - { search: string, clusterId: string, typeId: string, limit: number }
 * @returns {Array<object>} Matching enriched hazard objects
 */
function findHipHazards(params = {}) {
	const search = (params.search || "").toLowerCase().trim();
	const clusterId = params.clusterId ? String(params.clusterId) : null;
	const typeId = params.typeId ? String(params.typeId) : null;
	const limit = params.limit ? parseInt(params.limit, 10) : 50;

	const results = [];
	for (const h of HIP_HAZARDS) {
		if (clusterId && String(h.clusterId) !== clusterId) continue;
		if (typeId && String(h.typeId) !== typeId) continue;
		if (search) {
			const matchName = h.name.toLowerCase().includes(search);
			const matchCode = h.code.toLowerCase().includes(search);
			if (!matchName && !matchCode) continue;
		}
		results.push(enrichHazard(h));
		if (results.length >= limit) break;
	}
	return results;
}

/**
 * Get all 8 HIP high-level types
 */
function getAllHipTypes() {
	return Object.values(HIP_TYPES);
}

/**
 * Get all 49 HIP clusters, optionally filtered by typeId
 */
function getAllHipClusters(typeId = null) {
	const all = Object.values(HIP_CLUSTERS);
	if (!typeId) return all;
	return all.filter((c) => String(c.typeId) === String(typeId));
}

/**
 * Get all 301 HIP hazards, optionally filtered by clusterId
 */
function getAllHipHazards(clusterId = null) {
	if (!clusterId) return HIP_HAZARDS.map(enrichHazard);
	return HIP_HAZARDS.filter((h) => String(h.clusterId) === String(clusterId)).map(enrichHazard);
}

module.exports = {
	HIP_TYPES,
	HIP_CLUSTERS,
	HIP_HAZARDS,
	COMMON_ALIASES,
	lookupHip,
	getHipHierarchy: lookupHip,
	findHipHazards,
	getAllHipTypes,
	getAllHipClusters,
	getAllHipHazards,
};
