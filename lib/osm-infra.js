/**
 * OpenStreetMap (Overpass API) Interim Critical Infrastructure Adapter
 *
 * Provides an open-source interim fallback for countries or municipalities that
 * do not yet have an authoritative national GIS / OGC API - Features or UNDRR DELTA
 * critical infrastructure inventory.
 *
 * Maps OpenStreetMap nodes, ways (center), and relations (center) into the
 * 9 canonical UNDRR Sendai Framework Target D critical infrastructure sectors
 * and produces a GeoJSON FeatureCollection directly compatible with
 * `drr_critical_infra_overlay` (lib/infra-overlay.js).
 *
 * Security & Governance:
 * - Zero external dependencies (pure Node.js standard library)
 * - SSRF host protection on custom Overpass API endpoints (respects ALLOW_PRIVATE_WEBHOOKS)
 * - Bounded bbox span guard to prevent accidental global Overpass queries
 * - Untrusted OSM tag text sanitization (prompt-injection guard)
 * - Explicit interim fallback provenance: verificationStatus="external_unverified",
 *   reportingEligibility="screening_only", ODbL-1.0 attribution, and completeness caveat
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
const { ingestCriticalInfraOverlay } = require("./infra-overlay");

const OSM_INTERIM_INFRA_METHOD_ID = "exposure.osm.interim_critical_infra_v1";
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const MAX_BBOX_SPAN_DEG = 5.0;

/**
 * Overpass QL tag selectors mapped to each of the 9 canonical Sendai Target D sectors.
 */
const OSM_SENDAI_SECTOR_QUERIES = {
	health: [
		'nwr["amenity"~"^(hospital|clinic|doctors)$"]',
		'nwr["healthcare"~"^(hospital|clinic|centre)$"]',
	],
	education: [
		'nwr["amenity"~"^(school|university|college|kindergarten)$"]',
	],
	water: [
		'nwr["man_made"~"^(water_works|water_tower|reservoir_covered|pumping_station)$"]',
	],
	transportation: [
		'nwr["aeroway"~"^(aerodrome|heliport)$"]',
		'nwr["amenity"~"^(ferry_terminal|bus_station)$"]',
		'nwr["railway"="station"]',
	],
	telecommunications: [
		'nwr["man_made"~"^(communications_tower|mast)$"]',
		'nwr["telecom"~"^(data_center|exchange)$"]',
	],
	energy: [
		'nwr["power"~"^(plant|substation|generator)$"]',
	],
	waste_management: [
		'nwr["man_made"="wastewater_plant"]',
		'nwr["landuse"="landfill"]',
		'nwr["amenity"="waste_transfer_station"]',
	],
	protective_infrastructure: [
		'nwr["man_made"~"^(dyke|embankment|levee|breakwater)$"]',
		'nwr["waterway"="dam"]',
	],
	other_essential: [
		'nwr["amenity"~"^(fire_station|police|townhall|shelter)$"]',
		'nwr["emergency"="assembly_point"]',
	],
};

const VALID_OSM_SECTORS = Object.keys(OSM_SENDAI_SECTOR_QUERIES);

function cleanOsmText(val, maxLen = 140) {
	if (val === null || val === undefined) return null;
	const res = sanitizeUntrustedFeedText(String(val), maxLen);
	const txt = typeof res === "string" ? res : res && typeof res.text === "string" ? res.text : String(val);
	return txt.replace(/<[^>]*>/g, "").trim();
}

/**
 * Validate Overpass endpoint URL with SSRF protection.
 */
function buildOverpassEndpointUrl(options = {}) {
	const base = String(options.endpointUrl || process.env.OSM_OVERPASS_URL || DEFAULT_OVERPASS_URL).trim();
	let parsed;
	try {
		parsed = new URL(base);
	} catch (_) {
		throw new Error(`Invalid Overpass API endpointUrl: '${base}'`);
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error(`Unsupported protocol '${parsed.protocol}' for Overpass API endpoint.`);
	}
	if (!CONFIG.ALLOW_PRIVATE_WEBHOOKS && isBlockedWebhookHost(parsed.hostname)) {
		throw new Error(
			`SSRF protection blocked private/internal Overpass host '${parsed.hostname}'. Set ALLOW_PRIVATE_WEBHOOKS=true only for trusted internal mirrors.`,
		);
	}
	return parsed.toString();
}

/**
 * Build a bounded Overpass QL query for a WGS84 bbox [minLon, minLat, maxLon, maxLat]
 * and selected Sendai Target D sectors.
 */
function buildOverpassQuery(options = {}) {
	const bbox = options.bbox;
	if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => !Number.isFinite(Number(n)))) {
		throw new Error("buildOverpassQuery requires 'bbox' as [minLon, minLat, maxLon, maxLat].");
	}
	const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
	if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90 || minLon >= maxLon || minLat >= maxLat) {
		throw new Error(`Invalid WGS84 bbox [${bbox.join(", ")}]: expected minLon < maxLon and minLat < maxLat within valid WGS84 bounds.`);
	}
	if (maxLon - minLon > MAX_BBOX_SPAN_DEG || maxLat - minLat > MAX_BBOX_SPAN_DEG) {
		throw new Error(
			`Overpass bbox span exceeds maximum ${MAX_BBOX_SPAN_DEG}° x ${MAX_BBOX_SPAN_DEG}° guardrail; narrow the area of interest or use country HDX/HOTOSM exports.`,
		);
	}

	const requestedSectors = Array.isArray(options.sectors) && options.sectors.length > 0
		? options.sectors.map((s) => String(s).trim().toLowerCase())
		: VALID_OSM_SECTORS;

	const unknown = requestedSectors.filter((s) => !OSM_SENDAI_SECTOR_QUERIES[s]);
	if (unknown.length > 0) {
		throw new Error(`Unsupported Sendai sector(s): ${unknown.join(", ")}. Supported: ${VALID_OSM_SECTORS.join(", ")}.`);
	}

	const timeoutSec = Math.min(Math.max(5, Math.round(Number(options.timeoutSec) || 25)), 60);
	const maxElements = Math.min(Math.max(1, Math.round(Number(options.maxElements) || 500)), 2000);
	// Overpass bbox order is (south, west, north, east) = (minLat, minLon, maxLat, maxLon)
	const ovBbox = `${minLat},${minLon},${maxLat},${maxLon}`;

	const clauses = [];
	for (const sector of requestedSectors) {
		for (const selector of OSM_SENDAI_SECTOR_QUERIES[sector]) {
			clauses.push(`  ${selector}(${ovBbox});`);
		}
	}

	return `[out:json][timeout:${timeoutSec}];\n(\n${clauses.join("\n")}\n);\nout center tags ${maxElements};`;
}

/**
 * Deterministically classify an OSM element's tags into one of the 9 Sendai Target D sectors.
 */
function classifyOsmTagsToSendaiSector(tags = {}) {
	const t = tags || {};
	const amenity = String(t.amenity || "").toLowerCase();
	const healthcare = String(t.healthcare || "").toLowerCase();
	const manMade = String(t.man_made || "").toLowerCase();
	const power = String(t.power || "").toLowerCase();
	const aeroway = String(t.aeroway || "").toLowerCase();
	const railway = String(t.railway || "").toLowerCase();
	const telecom = String(t.telecom || "").toLowerCase();
	const waterway = String(t.waterway || "").toLowerCase();
	const landuse = String(t.landuse || "").toLowerCase();
	const emergency = String(t.emergency || "").toLowerCase();

	if (["hospital", "clinic", "doctors"].includes(amenity) || ["hospital", "clinic", "centre"].includes(healthcare)) {
		return { sector: "health", assetType: amenity || healthcare };
	}
	if (["school", "university", "college", "kindergarten"].includes(amenity)) {
		return { sector: "education", assetType: amenity };
	}
	if (["water_works", "water_tower", "reservoir_covered", "pumping_station"].includes(manMade)) {
		return { sector: "water", assetType: manMade };
	}
	if (["aerodrome", "heliport"].includes(aeroway) || ["ferry_terminal", "bus_station"].includes(amenity) || railway === "station") {
		return { sector: "transportation", assetType: aeroway || amenity || "railway_station" };
	}
	if (["communications_tower", "mast"].includes(manMade) || ["data_center", "exchange"].includes(telecom)) {
		return { sector: "telecommunications", assetType: telecom || manMade };
	}
	if (["plant", "substation", "generator", "transformer"].includes(power)) {
		return { sector: "energy", assetType: `power_${power}` };
	}
	if (manMade === "wastewater_plant" || landuse === "landfill" || amenity === "waste_transfer_station") {
		return { sector: "waste_management", assetType: manMade || landuse || amenity };
	}
	if (["dyke", "embankment", "levee", "breakwater"].includes(manMade) || waterway === "dam") {
		return { sector: "protective_infrastructure", assetType: manMade || waterway };
	}
	if (["fire_station", "police", "townhall", "shelter"].includes(amenity) || emergency === "assembly_point") {
		return { sector: "other_essential", assetType: amenity || emergency };
	}
	return { sector: "other_essential", assetType: amenity || manMade || power || "unclassified_osm_asset" };
}

/**
 * Parse an Overpass API JSON payload `{ elements: [...] }` into a normalized
 * Sendai Target D GeoJSON FeatureCollection ready for `drr_critical_infra_overlay`.
 */
function parseOverpassPayload(payload, options = {}) {
	if (!payload || typeof payload !== "object" || !Array.isArray(payload.elements)) {
		throw new Error("Overpass payload must be a JSON object containing an 'elements' array.");
	}

	const sectorFilter =
		Array.isArray(options.sectors) && options.sectors.length > 0
			? new Set(options.sectors.map((s) => String(s).trim().toLowerCase()))
			: null;

	const features = [];
	const sectorCounts = {};
	let skippedNoCoords = 0;

	for (const el of payload.elements) {
		if (!el || typeof el !== "object") continue;
		const lat = el.lat !== undefined ? Number(el.lat) : el.center && el.center.lat !== undefined ? Number(el.center.lat) : NaN;
		const lon = el.lon !== undefined ? Number(el.lon) : el.center && el.center.lon !== undefined ? Number(el.center.lon) : NaN;
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
			skippedNoCoords += 1;
			continue;
		}

		const tags = el.tags || {};
		const { sector, assetType } = classifyOsmTagsToSendaiSector(tags);
		if (sectorFilter && !sectorFilter.has(sector)) continue;

		const osmId = `${el.type || "node"}/${el.id}`;
		const name = cleanOsmText(tags.name || tags["name:en"] || `${assetType} (${osmId})`, 140);
		const operator = cleanOsmText(tags.operator || null, 120);

		sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;

		features.push({
			type: "Feature",
			id: osmId,
			properties: {
				id: osmId,
				name,
				sector,
				assetType,
				operator,
				osmType: el.type || "node",
				osmId: el.id,
				dataAuthority: "interim_open_source",
				verificationStatus: "external_unverified",
				source: "OpenStreetMap (Overpass API)",
				license: "ODbL-1.0",
				attribution: "© OpenStreetMap contributors",
				redistributionAllowed: true,
			},
			geometry: {
				type: "Point",
				coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))],
			},
		});
	}

	return {
		infraGeoJSON: {
			type: "FeatureCollection",
			features,
		},
		summary: {
			totalElementsParsed: payload.elements.length,
			totalFacilities: features.length,
			skippedNoCoords,
			sectorCounts,
		},
	};
}

/**
 * Fetch or parse OpenStreetMap interim critical infrastructure across the 9 Sendai Target D sectors,
 * and optionally overlay directly onto a hazard footprint via `ingestCriticalInfraOverlay`.
 */
async function ingestOsmInterimCriticalInfra(options = {}) {
	const method = getRegisteredMethod(OSM_INTERIM_INFRA_METHOD_ID);
	let rawPayload = options.samplePayload || null;
	let mode = "offline_sample";
	let sourceUrl = "offline://samplePayload";
	let overpassQuery = null;

	if (!rawPayload) {
		overpassQuery = buildOverpassQuery({
			bbox: options.bbox,
			sectors: options.sectors,
			timeoutSec: options.timeoutSec,
			maxElements: options.maxElements,
		});
		const endpoint = buildOverpassEndpointUrl(options);
		const queryUrl = `${endpoint}?data=${encodeURIComponent(overpassQuery)}`;
		rawPayload = await fetchJsonWithConfig(queryUrl);
		mode = "live_overpass";
		sourceUrl = redactUrlSecrets(endpoint);
	}

	const parsed = parseOverpassPayload(rawPayload, { sectors: options.sectors });

	// Optional direct bridge into Sendai Target D Critical Infrastructure Overlay
	let overlayReport = null;
	if (options.hazardGeoJSON || (Array.isArray(options.epicenter) && Number(options.bufferKm) > 0)) {
		overlayReport = await ingestCriticalInfraOverlay({
			infraGeoJSON: parsed.infraGeoJSON,
			hazardGeoJSON: options.hazardGeoJSON,
			epicenter: options.epicenter,
			bufferKm: options.bufferKm,
			sectors: options.sectors,
			audience: options.audience || "eoc_internal",
		});
	}

	const warnings = [
		"INTERIM OPEN-SOURCE FALLBACK: Data sourced from OpenStreetMap (© OpenStreetMap contributors, ODbL-1.0). Replace with an authoritative national GIS / OGC API - Features or UNDRR DELTA layer when available.",
		"Crowdsourced OSM completeness varies by region; unmapped facilities MUST NOT be treated as zero infrastructure (unknown !== 0).",
		"OSM provides facility locations (physical exposure D-2..D-4) but does not include operational lifeline dependency graphs (dependsOn for D-6..D-8 cascades).",
	];

	const snapshotHash = computeSnapshotHash({
		mode,
		totalFacilities: parsed.summary.totalFacilities,
		sectorCounts: parsed.summary.sectorCounts,
	});

	return {
		method: method
			? { id: method.id, version: method.version, productionStatus: method.productionStatus }
			: { id: OSM_INTERIM_INFRA_METHOD_ID, version: "1.0", productionStatus: "registered_screening_only" },
		interimFallback: true,
		dataAuthority: "interim_open_source",
		mode,
		sourceUrl,
		overpassQuery,
		summary: parsed.summary,
		infraGeoJSON: parsed.infraGeoJSON,
		overlayReport,
		warnings,
		provenance: {
			source: "OpenStreetMap (Overpass API)",
			license: "ODbL-1.0",
			attribution: "© OpenStreetMap contributors",
			retrievedAt: new Date().toISOString(),
			snapshotHash,
			evidenceBasis: "observed",
			verificationStatus: "external_unverified",
			approvalStatus: "draft",
			reportingEligibility: "screening_only",
		},
	};
}

module.exports = {
	OSM_INTERIM_INFRA_METHOD_ID,
	DEFAULT_OVERPASS_URL,
	MAX_BBOX_SPAN_DEG,
	OSM_SENDAI_SECTOR_QUERIES,
	VALID_OSM_SECTORS,
	buildOverpassEndpointUrl,
	buildOverpassQuery,
	classifyOsmTagsToSendaiSector,
	parseOverpassPayload,
	ingestOsmInterimCriticalInfra,
};
