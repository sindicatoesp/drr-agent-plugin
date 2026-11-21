/**
 * Sendai Framework Target D Critical Infrastructure Overlay & OGC API - Features Adapter
 *
 * Groups critical infrastructure assets by the 9 official UNDRR Sendai Framework Target D
 * sectors, ingests vector layers from local GeoJSON / DELTA Resilience / OGC API - Features
 * (OGC 17-069r4), overlays them onto any hazard footprint (ShakeMap, STAC, GDACS, GeoJSON),
 * and evaluates downstream lifeline interdependency cascades while strictly separating:
 *   - Physical exposure/damage (Sendai D-2, D-3, D-4)
 *   - Cascading service disruption risk (Sendai D-6, D-7, D-8) per C-02.
 *
 * Security & Governance:
 * - Zero external dependencies (pure Node.js standard library)
 * - SSRF host blocking on OGC API - Features endpoints
 * - Critical Infrastructure Protection (CIP) sensitivity & redistribution redaction
 * - Untrusted feed text sanitization (prompt-injection guard)
 * - Missing-data preservation (null valueUsd / capacity never coerced to 0)
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
const { spatialExposureJoin } = require("./spatial");

const INFRA_OVERLAY_METHOD_ID = "overlay.sendai.critical_infra_v1";

/**
 * Canonical 9 Sendai Framework Target D Critical Infrastructure Sectors
 */
const SENDAI_INFRA_SECTORS = {
	health: {
		id: "health",
		label: "Health",
		examples: "Hospitals, health centres, clinics",
		physicalDamageIndicator: "D-2",
		serviceDisruptionIndicator: "D-7",
		defaultColor: "#ef4444",
		defaultSensitivity: "public",
		aliases: ["health", "hospital", "clinic", "health_centre", "health_center", "medical", "pharmacy", "trauma_center", "doctors"],
	},
	education: {
		id: "education",
		label: "Education",
		examples: "Schools, universities",
		physicalDamageIndicator: "D-3",
		serviceDisruptionIndicator: "D-6",
		defaultColor: "#3b82f6",
		defaultSensitivity: "public",
		aliases: ["education", "school", "university", "college", "kindergarten", "academy", "campus"],
	},
	water: {
		id: "water",
		label: "Water",
		examples: "Water supply systems, treatment plants",
		physicalDamageIndicator: "D-4",
		serviceDisruptionIndicator: "D-8",
		defaultColor: "#06b6d4",
		defaultSensitivity: "eoc_internal",
		aliases: ["water", "water_supply", "water_treatment", "water_treatment_plant", "water_works", "pumping_station", "water_tower", "reservoir", "desalination"],
	},
	transportation: {
		id: "transportation",
		label: "Transportation",
		examples: "Roads, bridges, airports, seaports, railways",
		physicalDamageIndicator: "D-4",
		serviceDisruptionIndicator: "D-8",
		defaultColor: "#f59e0b",
		defaultSensitivity: "public",
		aliases: ["transportation", "transport", "road", "highway", "bridge", "airport", "seaport", "port", "railway", "rail", "ferry_terminal", "transit", "tunnel"],
	},
	telecommunications: {
		id: "telecommunications",
		label: "Telecommunications",
		examples: "Mobile networks, communication facilities",
		physicalDamageIndicator: "D-4",
		serviceDisruptionIndicator: "D-8",
		defaultColor: "#8b5cf6",
		defaultSensitivity: "eoc_internal",
		aliases: ["telecommunications", "telecom", "mobile_tower", "cell_tower", "communication", "comms", "broadcast_station", "data_center", "fiber_hub", "radio_tower"],
	},
	energy: {
		id: "energy",
		label: "Energy",
		examples: "Electricity generation, transmission and distribution",
		physicalDamageIndicator: "D-4",
		serviceDisruptionIndicator: "D-8",
		defaultColor: "#eab308",
		defaultSensitivity: "eoc_internal",
		aliases: ["energy", "power", "power_plant", "substation", "transmission_line", "grid", "electricity", "transformer", "generator", "fuel_depot"],
	},
	waste_management: {
		id: "waste_management",
		label: "Waste management",
		examples: "Wastewater and sanitation systems",
		physicalDamageIndicator: "D-4",
		serviceDisruptionIndicator: "D-8",
		defaultColor: "#84cc16",
		defaultSensitivity: "eoc_internal",
		aliases: ["waste_management", "waste", "wastewater", "wastewater_plant", "sewage", "sanitation", "landfill", "solid_waste"],
	},
	protective_infrastructure: {
		id: "protective_infrastructure",
		label: "Protective infrastructure",
		examples: "Flood protection, dams, drainage systems",
		physicalDamageIndicator: "D-4",
		serviceDisruptionIndicator: "D-8",
		defaultColor: "#14b8a6",
		defaultSensitivity: "eoc_internal",
		aliases: ["protective_infrastructure", "protective", "flood_protection", "levee", "dyke", "dike", "floodwall", "dam", "drainage", "drainage_pump", "seawall", "green_infrastructure", "mangrove_barrier"],
	},
	other_essential: {
		id: "other_essential",
		label: "Other essential infrastructure",
		examples: "Facilities designated by national governments",
		physicalDamageIndicator: "D-4",
		serviceDisruptionIndicator: "D-8",
		defaultColor: "#94a3b8",
		defaultSensitivity: "public",
		aliases: ["other_essential", "other", "shelter", "emergency_shelter", "evacuation_center", "eoc", "fire_station", "police", "government_designated", "food_reserve"],
	},
};

const ALIAS_TO_SECTOR = new Map();
for (const sector of Object.values(SENDAI_INFRA_SECTORS)) {
	for (const alias of sector.aliases) {
		ALIAS_TO_SECTOR.set(alias.toLowerCase(), sector.id);
	}
}

/**
 * Deterministically classify a GeoJSON feature's properties into one of the 9 Sendai Target D sectors.
 */
function classifySendaiInfraSector(props = {}) {
	const candidates = [
		props.sendaiSector,
		props.sendai_sector,
		props.sector,
		props.assetType,
		props.asset_type,
		props.facilityType,
		props.category,
		props.type,
		props.amenity,
		props.power,
		props.man_made,
	].filter((v) => v !== undefined && v !== null && String(v).trim() !== "");

	for (const raw of candidates) {
		const token = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
		if (ALIAS_TO_SECTOR.has(token)) {
			return {
				sector: ALIAS_TO_SECTOR.get(token),
				matchedFrom: String(raw),
				classificationWarning: false,
			};
		}
		// Check substring match against canonical aliases only for clear multi-word labels
		for (const [alias, sectorId] of ALIAS_TO_SECTOR.entries()) {
			if (alias.length >= 4 && token.includes(alias)) {
				return {
					sector: sectorId,
					matchedFrom: String(raw),
					classificationWarning: false,
				};
			}
		}
	}

	return {
		sector: "other_essential",
		matchedFrom: candidates[0] ? String(candidates[0]) : null,
		classificationWarning: true,
	};
}

/**
 * Build an SSRF-guarded OGC API - Features (OGC 17-069r4) /collections/{id}/items URL
 */
function buildOgcApiFeaturesUrl(baseUrl, options = {}) {
	if (!baseUrl || typeof baseUrl !== "string") {
		throw new Error("OGC API - Features endpointUrl is required when no offline infraGeoJSON is provided.");
	}
	let parsed;
	try {
		parsed = new URL(baseUrl);
	} catch (err) {
		throw new Error(`Invalid OGC API - Features URL: ${baseUrl}`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported protocol for OGC API - Features URL: ${parsed.protocol}`);
	}

	if (!CONFIG.ALLOW_PRIVATE_WEBHOOKS && isBlockedWebhookHost(parsed.hostname)) {
		throw new Error(
			`SSRF guard blocked OGC API - Features host "${parsed.hostname}". Set DRR_ALLOW_PRIVATE_WEBHOOKS=true only for trusted internal EOC networks.`,
		);
	}

	const cleanPath = parsed.pathname.replace(/\/+$/, "");
	if (options.collection && !/\/items$/i.test(cleanPath)) {
		const safeCol = encodeURIComponent(String(options.collection).trim());
		if (/\/collections$/i.test(cleanPath)) {
			parsed.pathname = `${cleanPath}/${safeCol}/items`;
		} else {
			parsed.pathname = `${cleanPath}/collections/${safeCol}/items`;
		}
	}

	if (!parsed.searchParams.has("f")) {
		parsed.searchParams.set("f", "json");
	}
	if (Array.isArray(options.bbox) && options.bbox.length === 4 && !parsed.searchParams.has("bbox")) {
		parsed.searchParams.set("bbox", options.bbox.join(","));
	}
	const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 1000) : 200;
	if (!parsed.searchParams.has("limit")) {
		parsed.searchParams.set("limit", String(limit));
	}

	return parsed.toString();
}

/**
 * Normalize one or more GeoJSON FeatureCollections into a Sendai-grouped Critical Infrastructure Overlay.
 */
function normalizeCriticalInfraOverlay(input, options = {}) {
	const collections = Array.isArray(input) ? input : [input];
	const allowedSectors = Array.isArray(options.sectors) && options.sectors.length > 0
		? new Set(options.sectors.map((s) => String(s).trim().toLowerCase()))
		: null;
	const audience = options.audience || "eoc_internal"; // "eoc_internal" | "public"

	const normalizedFeatures = [];
	const groupedBySector = {};
	for (const key of Object.keys(SENDAI_INFRA_SECTORS)) {
		groupedBySector[key] = {
			...SENDAI_INFRA_SECTORS[key],
			totalCount: 0,
			exposedCount: 0,
			cascadingRiskCount: 0,
			features: [],
		};
	}

	let unclassifiedCount = 0;
	let restrictedCount = 0;
	let redactedForPublicCount = 0;
	let anyPromptInjection = false;

	for (const fc of collections) {
		if (!fc || typeof fc !== "object" || !Array.isArray(fc.features)) {
			throw new Error("Invalid Critical Infrastructure GeoJSON: expected FeatureCollection with features[]");
		}
		for (const feat of fc.features) {
			if (!feat || typeof feat !== "object" || !feat.geometry) continue;
			const props = feat.properties || {};
			const classification = classifySendaiInfraSector(props);
			const sectorId = classification.sector;
			if (allowedSectors && !allowedSectors.has(sectorId)) continue;

			const sectorDef = SENDAI_INFRA_SECTORS[sectorId];
			if (classification.classificationWarning) unclassifiedCount += 1;

			const safeName = sanitizeUntrustedFeedText(props.name || feat.id || `${sectorDef.label} Facility`);
			const safeNotes = sanitizeUntrustedFeedText(props.notes || props.description || "");
			if (safeName.injectionDetected || safeNotes.injectionDetected) {
				anyPromptInjection = true;
			}

			const sensitivity = String(
				props.sensitivity || sectorDef.defaultSensitivity || "public",
			).toLowerCase();
			const redistributionAllowed =
				props.redistributionAllowed !== undefined
					? Boolean(props.redistributionAllowed)
					: sensitivity === "public";

			if (sensitivity === "restricted" || !redistributionAllowed) {
				restrictedCount += 1;
			}

			if (audience === "public" && (sensitivity === "restricted" || !redistributionAllowed)) {
				redactedForPublicCount += 1;
				continue;
			}

			// Preserve null for unknown replacement value / capacity (never coerce to 0, R-02)
			const valueUsd =
				props.valueUsd !== undefined && props.valueUsd !== null && Number.isFinite(Number(props.valueUsd))
					? Number(props.valueUsd)
					: null;
			const capacity =
				props.capacity !== undefined && props.capacity !== null && Number.isFinite(Number(props.capacity))
					? Number(props.capacity)
					: null;

			const dependsOn = Array.isArray(props.dependsOn)
				? props.dependsOn.map((id) => String(id))
				: [];

			const featureId = String(feat.id || props.id || `${sectorId}_${normalizedFeatures.length + 1}`);

			const normalizedFeature = {
				type: "Feature",
				id: featureId,
				geometry: feat.geometry,
				properties: {
					id: featureId,
					name: safeName.text,
					notes: safeNotes.text || undefined,
					sendaiSector: sectorId,
					sendaiSectorLabel: sectorDef.label,
					physicalDamageIndicator: sectorDef.physicalDamageIndicator,
					serviceDisruptionIndicator: sectorDef.serviceDisruptionIndicator,
					assetType: props.assetType || props.type || sectorId,
					nationalCategory: props.nationalCategory || null,
					taxonomy: props.taxonomy || null,
					valueUsd,
					capacity,
					dependsOn,
					sensitivity,
					redistributionAllowed,
					classificationWarning: classification.classificationWarning,
					color: sectorDef.defaultColor,
				},
			};

			normalizedFeatures.push(normalizedFeature);
			groupedBySector[sectorId].totalCount += 1;
			groupedBySector[sectorId].features.push(normalizedFeature);
		}
	}

	return {
		featureCollection: {
			type: "FeatureCollection",
			features: normalizedFeatures,
		},
		groupedBySector,
		meta: {
			totalFacilities: normalizedFeatures.length,
			unclassifiedCount,
			restrictedCount,
			redactedForPublicCount,
			audience,
			promptInjectionFlagged: anyPromptInjection,
		},
	};
}

/**
 * Overlay Sendai-grouped critical infrastructure onto a hazard footprint (or geodesic buffer)
 * and evaluate both direct physical exposure (D-2..D-4) and downstream lifeline cascades (D-6..D-8).
 */
function overlayCriticalInfraOnHazard(hazardGeoJSON, infraInput, options = {}) {
	const retrievedAt = options.retrievedAt || new Date().toISOString();
	const payloadHash = `sha256:${computeSnapshotHash({ hazardGeoJSON, infraInput })}`;

	const normalized = normalizeCriticalInfraOverlay(infraInput, options);
	const fc = normalized.featureCollection;

	const exposedIdSet = new Set();
	let spatialJoinReport = null;

	if (hazardGeoJSON || (options.epicenter && options.bufferKm)) {
		spatialJoinReport = spatialExposureJoin(hazardGeoJSON, fc, {
			epicenter: options.epicenter,
			bufferKm: options.bufferKm,
		});
		for (const asset of spatialJoinReport.exposedAssets || []) {
			const id = String(asset.id || asset.properties?.id || "");
			if (id) exposedIdSet.add(id);
		}
	}

	// Build lookup & annotate direct physical exposure + cascading lifeline disruption risk
	const exposedFeatures = [];
	const cascadingDisruptedFeatures = [];
	const physicalCounts = { "D-2": 0, "D-3": 0, "D-4": 0 };
	const cascadingCounts = { "D-6": 0, "D-7": 0, "D-8": 0 };

	for (const feat of fc.features) {
		const id = feat.properties.id;
		const sectorId = feat.properties.sendaiSector;
		const isPhysicallyExposed = exposedIdSet.has(id);

		const exposedDependencies = (feat.properties.dependsOn || []).filter((depId) =>
			exposedIdSet.has(depId),
		);
		const hasCascadingRisk = !isPhysicallyExposed && exposedDependencies.length > 0;

		feat.properties.physicallyExposed = isPhysicallyExposed;
		feat.properties.exposedDependencies = exposedDependencies;
		feat.properties.cascadingServiceDisruptionRisk = hasCascadingRisk;
		feat.properties.overlayStatus = isPhysicallyExposed
			? "physically_exposed"
			: hasCascadingRisk
				? "cascading_service_risk"
				: "unexposed";

		if (isPhysicallyExposed) {
			exposedFeatures.push(feat);
			normalized.groupedBySector[sectorId].exposedCount += 1;
			physicalCounts[feat.properties.physicalDamageIndicator] += 1;
		} else if (hasCascadingRisk) {
			cascadingDisruptedFeatures.push(feat);
			normalized.groupedBySector[sectorId].cascadingRiskCount += 1;
			cascadingCounts[feat.properties.serviceDisruptionIndicator] += 1;
		}
	}

	const sectorSummary = {};
	for (const [sectorId, bucket] of Object.entries(normalized.groupedBySector)) {
		sectorSummary[sectorId] = {
			label: bucket.label,
			physicalDamageIndicator: bucket.physicalDamageIndicator,
			serviceDisruptionIndicator: bucket.serviceDisruptionIndicator,
			color: bucket.defaultColor,
			totalCount: bucket.totalCount,
			exposedCount: bucket.exposedCount,
			cascadingRiskCount: bucket.cascadingRiskCount,
		};
	}

	return {
		standard: "UNDRR Sendai Target D (9 Sectors) + OGC API - Features (OGC 17-069r4)",
		method: getRegisteredMethod(INFRA_OVERLAY_METHOD_ID),
		sourceUrl: options.sourceUrl ? redactUrlSecrets(options.sourceUrl) : "offline_geojson",
		retrievedAt,
		payloadHash,
		audience: normalized.meta.audience,
		summary: {
			totalFacilities: normalized.meta.totalFacilities,
			physicallyExposedCount: exposedFeatures.length,
			cascadingServiceRiskCount: cascadingDisruptedFeatures.length,
			unclassifiedCount: normalized.meta.unclassifiedCount,
			restrictedCount: normalized.meta.restrictedCount,
			redactedForPublicCount: normalized.meta.redactedForPublicCount,
		},
		sendaiTargetDSummary: {
			// C-02: Physical exposure/damage (D-2..D-4) strictly separated from service disruption (D-6..D-8)
			physicalExposureByIndicator: {
				D2_healthFacilities: physicalCounts["D-2"],
				D3_educationFacilities: physicalCounts["D-3"],
				D4_otherCriticalInfra: physicalCounts["D-4"],
			},
			cascadingServiceDisruptionRiskByIndicator: {
				D6_educationServiceRisk: cascadingCounts["D-6"],
				D7_healthServiceRisk: cascadingCounts["D-7"],
				D8_otherBasicServiceRisk: cascadingCounts["D-8"],
			},
		},
		sectorSummary,
		exposedFacilities: exposedFeatures.map((f) => ({
			id: f.properties.id,
			name: f.properties.name,
			sendaiSector: f.properties.sendaiSector,
			physicalDamageIndicator: f.properties.physicalDamageIndicator,
			sensitivity: f.properties.sensitivity,
		})),
		cascadingDisruptionFacilities: cascadingDisruptedFeatures.map((f) => ({
			id: f.properties.id,
			name: f.properties.name,
			sendaiSector: f.properties.sendaiSector,
			serviceDisruptionIndicator: f.properties.serviceDisruptionIndicator,
			exposedDependencies: f.properties.exposedDependencies,
		})),
		overlayGeoJSON: fc,
		governanceMetadata: {
			evidenceBasis: "modelled",
			verificationStatus: "unreviewed",
			approvalStatus: "draft",
			reportingEligibility: "pending",
		},
		untrustedFeedSecurity: {
			untrustedData: true,
			promptInjectionFlagged: normalized.meta.promptInjectionFlagged,
		},
	};
}

/**
 * Ingest Critical Infrastructure from offline GeoJSON (single or multi-layer) or live OGC API - Features,
 * optionally overlaying onto a hazard footprint.
 */
async function ingestCriticalInfraOverlay(options = {}) {
	const retrievedAt = options.retrievedAt || new Date().toISOString();
	let infraInput = options.infraGeoJSON || options.infraLayers || null;
	let resolvedUrl = null;

	if (typeof infraInput === "string") {
		try {
			infraInput = JSON.parse(infraInput);
		} catch (err) {
			throw new Error(`Failed to parse infraGeoJSON JSON: ${err.message}`);
		}
	}

	if (!infraInput) {
		const baseUrl = options.endpointUrl || CONFIG.OGC_FEATURES_API_URL;
		resolvedUrl = buildOgcApiFeaturesUrl(baseUrl, options);

		const headers = {};
		const apiKey = options.apiKey || CONFIG.OGC_FEATURES_API_KEY;
		const apiKeyHeader = options.apiKeyHeader || CONFIG.OGC_FEATURES_API_KEY_HEADER || "X-API-Key";
		if (apiKey) {
			headers[apiKeyHeader] = apiKey;
		}

		infraInput = await fetchJsonWithConfig(resolvedUrl, headers);
	}

	return overlayCriticalInfraOnHazard(options.hazardGeoJSON || null, infraInput, {
		...options,
		retrievedAt,
		sourceUrl: resolvedUrl,
	});
}

module.exports = {
	INFRA_OVERLAY_METHOD_ID,
	SENDAI_INFRA_SECTORS,
	classifySendaiInfraSector,
	buildOgcApiFeaturesUrl,
	normalizeCriticalInfraOverlay,
	overlayCriticalInfraOnHazard,
	ingestCriticalInfraOverlay,
};
