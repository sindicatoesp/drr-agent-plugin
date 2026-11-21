/**
 * UNDRR / ISC Hazard Information Profiles (HIPs) Taxonomy & Crosswalk Module (R-09)
 *
 * Provides in-code canonical mapping for all 8 HIP Types, 49 Clusters, and 301 Hazards
 * defined in UNDRR-ISC HIP 2020 (DELTA dataset v1), plus deterministic crosswalk matching
 * vs. ambiguous candidate generation and explicit HIP 2025 revision awareness.
 */

const hipsData = require("./hips-data.json");

const HIP_TAXONOMY_VERSION = "UNDRR-ISC-HIP-2020-DELTA-v1";
const HIP_CROSSWALK_VERSION = "2020-base-with-2025-review-flags";

const HIP_TYPES = hipsData.types;
const HIP_CLUSTERS = hipsData.clusters;
const HIP_HAZARDS = hipsData.hazards;

// Build fast in-memory lookup indexes with pre-normalized strings and pre-enriched objects
const HAZARD_BY_ID = new Map();
const HAZARD_BY_CODE = new Map();
const HAZARD_BY_NAME_LOWER = new Map();
const INDEXED_HAZARDS = [];

/**
 * Enrich raw hazard object with cluster and type metadata
 */
function enrichHazard(hazard) {
	if (!hazard) return null;
	if (hazard._enriched) return hazard._enriched;
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
		taxonomyVersion: HIP_TAXONOMY_VERSION,
	};
}

for (const h of HIP_HAZARDS) {
	const nameLower = h.name.toLowerCase();
	const codeLower = h.code.toLowerCase();
	const enriched = enrichHazard(h);
	const clusterNameLower = enriched.clusterName.toLowerCase();
	HAZARD_BY_ID.set(String(h.id), enriched);
	HAZARD_BY_CODE.set(h.code.toUpperCase(), enriched);
	HAZARD_BY_NAME_LOWER.set(nameLower, enriched);
	INDEXED_HAZARDS.push({ raw: h, enriched, nameLower, codeLower, clusterNameLower });
}

/**
 * Common operational aliases and abbreviations mapping deterministically to HIP 2020 hazard codes
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
 * Explicit crosswalk table from external operational systems to UNDRR-ISC HIP 2020 codes
 */
const EXTERNAL_SYSTEM_CROSSWALK = {
	GDACS: {
		EQ: { hipCode: "GH0001", exact: true, note: "GDACS Earthquake eventtype 'EQ'" },
		TC: { hipCode: "MH0057", exact: true, note: "GDACS Tropical Cyclone eventtype 'TC'" },
		FL: { hipCode: "MH0007", exact: false, candidates: ["MH0007", "MH0006", "MH0004"], note: "GDACS Flood 'FL' maps cleanly to Flood cluster; specific subtype (Fluvial MH0007 / Flash MH0006 / Coastal MH0004) may require hydrologist confirmation." },
		VO: { hipCode: "GH0015", exact: false, candidates: ["GH0015"], note: "GDACS Volcano 'VO' (general volcanic activity)." },
		DR: { hipCode: "MH0035", exact: true, note: "GDACS Drought 'DR'" },
		WF: { hipCode: "EN0013", exact: true, note: "GDACS Wildfire / Forest Fire 'WF'" },
	},
	USGS: {
		EARTHQUAKE: { hipCode: "GH0001", exact: true, note: "USGS Earthquake feed event" },
	},
};

/**
 * Annotated clusters/codes where UNDRR/ISC HIP 2025 update (282 profiles) introduced revisions
 * or consolidations relative to 2020 (302 profiles). Flags review without inventing unverified 2025 IDs.
 */
const HIP_2025_REVIEW_NOTES = {
	TL: "UNDRR-ISC HIP 2025 expanded/reclassified Technological & Cyber profiles; verify DELTA instance mapping if synced to 2025 catalog.",
	EN: "UNDRR-ISC HIP 2025 revised Environmental degradation/pollution classifications; confirm exact DELTA catalog version.",
	BI: "UNDRR-ISC HIP 2025 refined biological / infectious disease profiles; verify alignment if national DELTA uses 2025 update.",
	MH0007: "Confirm flood subtype (Fluvial vs. Flash vs. Pluvial/Surface Water) against 2025 HIP hydrological revision when national catalog upgrades.",
};

/**
 * Look up official UNDRR/ISC HIP hierarchy by ID, Code, natural keyword, or alias
 * (Backwards-compatible helper preserved for DELTA ingestion)
 * @param {string|object} query
 * @returns {object|null} Enriched HIP mapping or null
 */
function lookupHip(query) {
	if (!query) return null;

	if (typeof query === "object") {
		if (query.hipHazardId && query.hipClusterId && query.hipTypeId) {
			const existing = HAZARD_BY_ID.get(String(query.hipHazardId));
			if (existing) return existing;
			return {
				hipHazardId: String(query.hipHazardId),
				hipClusterId: String(query.hipClusterId),
				hipTypeId: String(query.hipTypeId),
				code: query.code || "CUSTOM",
				name: query.name || "Custom Hazard",
				clusterName: query.clusterName || "",
				typeName: query.typeName || "",
				taxonomyVersion: HIP_TAXONOMY_VERSION,
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

	if (HAZARD_BY_ID.has(raw)) return HAZARD_BY_ID.get(raw);
	const upper = raw.toUpperCase();
	if (HAZARD_BY_CODE.has(upper)) return HAZARD_BY_CODE.get(upper);
	if (COMMON_ALIASES[normalized]) {
		const code = COMMON_ALIASES[normalized];
		if (HAZARD_BY_CODE.has(code)) return HAZARD_BY_CODE.get(code);
	}
	const queryLower = raw.toLowerCase();
	if (HAZARD_BY_NAME_LOWER.has(queryLower)) return HAZARD_BY_NAME_LOWER.get(queryLower);

	for (let i = 0; i < INDEXED_HAZARDS.length; i++) {
		const item = INDEXED_HAZARDS[i];
		if (item.nameLower.includes(queryLower) || queryLower.includes(item.nameLower)) {
			return item.enriched;
		}
	}

	return null;
}

function getHip2025Note(code) {
	if (!code) return null;
	if (HIP_2025_REVIEW_NOTES[code]) return HIP_2025_REVIEW_NOTES[code];
	const prefix = String(code).slice(0, 2).toUpperCase();
	return HIP_2025_REVIEW_NOTES[prefix] || null;
}

/**
 * Versioned Hazard Crosswalk separating deterministic exact matches from
 * ambiguous free-text candidate generation (R-09, C-08).
 *
 * @param {string|object} query - Hazard query, code, ID, or free text
 * @param {object} options - { sourceSystem?: string, candidateLimit?: number }
 * @returns {object} Crosswalk report with status ("resolved_exact" | "candidates_require_review" | "unresolved")
 */
function crosswalkHazard(query, options = {}) {
	const sourceSystem = options.sourceSystem ? String(options.sourceSystem).toUpperCase().trim() : null;
	const candidateLimit = Math.min(Math.max(parseInt(options.candidateLimit || 5, 10), 1), 20);

	if (!query || (typeof query === "string" && !query.trim())) {
		return {
			status: "unresolved",
			autoMatched: false,
			requiresHumanConfirmation: true,
			taxonomyVersion: HIP_TAXONOMY_VERSION,
			crosswalkVersion: HIP_CROSSWALK_VERSION,
			query: query ?? null,
			mapping: null,
			candidates: [],
			reason: "Empty or missing hazard query.",
		};
	}

	const rawStr = typeof query === "object"
		? String(query.code || query.id || query.hazardType || query.name || "").trim()
		: String(query).trim();

	// 0. Check explicit triad object
	if (typeof query === "object" && query.hipHazardId && query.hipClusterId && query.hipTypeId) {
		const mapped = lookupHip(query);
		return {
			status: "resolved_exact",
			matchType: "explicit_hip_triad",
			autoMatched: true,
			requiresHumanConfirmation: false,
			taxonomyVersion: HIP_TAXONOMY_VERSION,
			crosswalkVersion: HIP_CROSSWALK_VERSION,
			query,
			mapping: mapped,
			candidates: [mapped],
			hip2025ReviewNote: getHip2025Note(mapped?.code),
		};
	}

	// 1. External system crosswalk check (e.g. GDACS, USGS)
	if (sourceSystem && EXTERNAL_SYSTEM_CROSSWALK[sourceSystem]) {
		const sysEntry = EXTERNAL_SYSTEM_CROSSWALK[sourceSystem][rawStr.toUpperCase()];
		if (sysEntry) {
			const primary = HAZARD_BY_CODE.get(sysEntry.hipCode) || null;
			if (sysEntry.exact && primary) {
				return {
					status: "resolved_exact",
					matchType: `external_system_exact:${sourceSystem}`,
					autoMatched: true,
					requiresHumanConfirmation: false,
					taxonomyVersion: HIP_TAXONOMY_VERSION,
					crosswalkVersion: HIP_CROSSWALK_VERSION,
					query: rawStr,
					sourceSystem,
					mapping: primary,
					candidates: [primary],
					note: sysEntry.note,
					hip2025ReviewNote: getHip2025Note(primary.code),
				};
			}
			const candList = (sysEntry.candidates || [sysEntry.hipCode])
				.map((c) => HAZARD_BY_CODE.get(c))
				.filter(Boolean);
			return {
				status: "candidates_require_review",
				matchType: `external_system_broad:${sourceSystem}`,
				autoMatched: false,
				requiresHumanConfirmation: true,
				taxonomyVersion: HIP_TAXONOMY_VERSION,
				crosswalkVersion: HIP_CROSSWALK_VERSION,
				query: rawStr,
				sourceSystem,
				mapping: null,
				suggestedDefault: primary,
				candidates: candList,
				note: sysEntry.note,
				hip2025ReviewNote: getHip2025Note(primary?.code),
			};
		}
	}

	// 2. Exact HIP ID
	if (HAZARD_BY_ID.has(rawStr)) {
		const exact = HAZARD_BY_ID.get(rawStr);
		return {
			status: "resolved_exact",
			matchType: "exact_hip_id",
			autoMatched: true,
			requiresHumanConfirmation: false,
			taxonomyVersion: HIP_TAXONOMY_VERSION,
			crosswalkVersion: HIP_CROSSWALK_VERSION,
			query: rawStr,
			mapping: exact,
			candidates: [exact],
			hip2025ReviewNote: getHip2025Note(exact.code),
		};
	}

	// 3. Exact HIP Code
	const upper = rawStr.toUpperCase();
	if (HAZARD_BY_CODE.has(upper)) {
		const exact = HAZARD_BY_CODE.get(upper);
		return {
			status: "resolved_exact",
			matchType: "exact_hip_code",
			autoMatched: true,
			requiresHumanConfirmation: false,
			taxonomyVersion: HIP_TAXONOMY_VERSION,
			crosswalkVersion: HIP_CROSSWALK_VERSION,
			query: rawStr,
			mapping: exact,
			candidates: [exact],
			hip2025ReviewNote: getHip2025Note(exact.code),
		};
	}

	// Reject malformed/unknown code-like strings rather than fuzzy matching them (e.g. "ZZ9999")
	if (/^[A-Z]{2}\d{3,4}$/i.test(rawStr)) {
		return {
			status: "unresolved",
			matchType: "unknown_hip_code",
			autoMatched: false,
			requiresHumanConfirmation: true,
			taxonomyVersion: HIP_TAXONOMY_VERSION,
			crosswalkVersion: HIP_CROSSWALK_VERSION,
			query: rawStr,
			mapping: null,
			candidates: [],
			reason: `Code '${rawStr}' does not match any registered profile in ${HIP_TAXONOMY_VERSION}.`,
		};
	}

	// 4. Exact canonical name
	const lower = rawStr.toLowerCase();
	if (HAZARD_BY_NAME_LOWER.has(lower)) {
		const exact = HAZARD_BY_NAME_LOWER.get(lower);
		return {
			status: "resolved_exact",
			matchType: "exact_canonical_name",
			autoMatched: true,
			requiresHumanConfirmation: false,
			taxonomyVersion: HIP_TAXONOMY_VERSION,
			crosswalkVersion: HIP_CROSSWALK_VERSION,
			query: rawStr,
			mapping: exact,
			candidates: [exact],
			hip2025ReviewNote: getHip2025Note(exact.code),
		};
	}

	// 5. Exact controlled alias
	const normalizedAlias = lower.replace(/[\s-]+/g, "_");
	if (COMMON_ALIASES[normalizedAlias]) {
		const exact = HAZARD_BY_CODE.get(COMMON_ALIASES[normalizedAlias]);
		if (exact) {
			return {
				status: "resolved_exact",
				matchType: "controlled_alias",
				autoMatched: true,
				requiresHumanConfirmation: false,
				taxonomyVersion: HIP_TAXONOMY_VERSION,
				crosswalkVersion: HIP_CROSSWALK_VERSION,
				query: rawStr,
				mapping: exact,
				candidates: [exact],
				hip2025ReviewNote: getHip2025Note(exact.code),
			};
		}
	}

	// 6. Free-text query: generate ranked candidates WITHOUT silent auto-assignment (C-08 / R-09)
	const tokens = lower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
	const scored = [];

	if (tokens.length > 0) {
		for (const item of INDEXED_HAZARDS) {
			let score = 0;
			if (item.nameLower.includes(lower)) score += 3;
			for (const tok of tokens) {
				if (item.nameLower.includes(tok)) score += 1;
				if (item.clusterNameLower.includes(tok)) score += 0.5;
			}
			if (score > 0) {
				scored.push({ score, hazard: item.enriched });
			}
		}
	}

	scored.sort((a, b) => b.score - a.score || a.hazard.code.localeCompare(b.hazard.code));
	const candidates = scored.slice(0, candidateLimit).map((s) => ({
		...s.hazard,
		matchScore: s.score,
	}));

	if (candidates.length === 0) {
		return {
			status: "unresolved",
			matchType: "no_candidate_found",
			autoMatched: false,
			requiresHumanConfirmation: true,
			taxonomyVersion: HIP_TAXONOMY_VERSION,
			crosswalkVersion: HIP_CROSSWALK_VERSION,
			query: rawStr,
			mapping: null,
			candidates: [],
			reason: `No HIP candidates matched free-text description '${rawStr}'.`,
		};
	}

	return {
		status: "candidates_require_review",
		matchType: "free_text_candidate_generation",
		autoMatched: false,
		requiresHumanConfirmation: true,
		taxonomyVersion: HIP_TAXONOMY_VERSION,
		crosswalkVersion: HIP_CROSSWALK_VERSION,
		query: rawStr,
		mapping: null,
		candidates,
		reason: "Free-text hazard description matched via lexical candidate scoring; select exact HIP profile manually before persisting.",
	};
}

function findHipHazards(params = {}) {
	const search = (params.search || "").toLowerCase().trim();
	const clusterId = params.clusterId ? String(params.clusterId) : null;
	const typeId = params.typeId ? String(params.typeId) : null;
	const limit = params.limit ? parseInt(params.limit, 10) : 50;

	const results = [];
	for (let i = 0; i < INDEXED_HAZARDS.length; i++) {
		const { raw: h, enriched, nameLower, codeLower } = INDEXED_HAZARDS[i];
		if (clusterId && String(h.clusterId) !== clusterId) continue;
		if (typeId && String(h.typeId) !== typeId) continue;
		if (search) {
			if (!nameLower.includes(search) && !codeLower.includes(search)) continue;
		}
		results.push(enriched);
		if (results.length >= limit) break;
	}
	return results;
}

function getAllHipTypes() {
	return Object.values(HIP_TYPES);
}

function getAllHipClusters(typeId = null) {
	const all = Object.values(HIP_CLUSTERS);
	if (!typeId) return all;
	return all.filter((c) => String(c.typeId) === String(typeId));
}

function getAllHipHazards(clusterId = null) {
	if (!clusterId) return INDEXED_HAZARDS.map((item) => item.enriched);
	const cid = String(clusterId);
	return INDEXED_HAZARDS.filter((item) => String(item.raw.clusterId) === cid).map(
		(item) => item.enriched,
	);
}

module.exports = {
	HIP_TAXONOMY_VERSION,
	HIP_CROSSWALK_VERSION,
	HIP_TYPES,
	HIP_CLUSTERS,
	HIP_HAZARDS,
	COMMON_ALIASES,
	EXTERNAL_SYSTEM_CROSSWALK,
	lookupHip,
	getHipHierarchy: lookupHip,
	crosswalkHazard,
	findHipHazards,
	getAllHipTypes,
	getAllHipClusters,
	getAllHipHazards,
};
