/**
 * STAC v1.0.0 (SpatioTemporal Asset Catalog) + Validated Flood Depth Grid Adapter
 *
 * Bridges government (Copernicus EMS, Sentinel-1 SAR, NASA SWOT, NOAA) and private
 * commercial (ICEYE SAR flood depth, Capella Space, Planet, Floodbase) Earth Observation
 * catalogs into DRR spatial exposure joins and validated inundation depth grids (C-05 / R-12).
 *
 * Security & Governance:
 * - Zero external dependencies (pure Node.js standard library)
 * - SSRF host protection on custom STAC API endpoints (respects ALLOW_PRIVATE_WEBHOOKS)
 * - Untrusted feed text sanitization (prompt-injection guard)
 * - Strict C-05 separation: flood extent != flood depth; binary COGs are flagged cleanly
 * - Bridges validated JSON depth grids directly through ingestValidatedInundationGrid (lib/hydro.js)
 * - Commercial EO licensing & redistributionAllowed enforcement
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
const { ingestValidatedInundationGrid } = require("./hydro");

const STAC_METHOD_ID = "telemetry.stac.hazard_grid_v1";

const OPEN_LICENSES = new Set([
	"cc-by-4.0",
	"cc-by-3.0",
	"cc0-1.0",
	"cc-by-sa-4.0",
	"public-domain",
	"us-pd",
	"copernicus-open",
	"odc-by",
	"apache-2.0",
	"mit",
]);

/**
 * Normalize depth grid values to meters while preserving nodata/null cells.
 */
function normalizeDepthValuesToMeters(values, rawUnit, nodata = -9999) {
	const u = String(rawUnit || "m").trim().toLowerCase();
	let factor = 1;
	if (u === "m" || u === "meter" || u === "meters" || u === "metre" || u === "metres") {
		factor = 1;
	} else if (u === "cm" || u === "centimeter" || u === "centimeters") {
		factor = 0.01;
	} else if (u === "mm" || u === "millimeter" || u === "millimeters") {
		factor = 0.001;
	} else if (u === "ft" || u === "foot" || u === "feet") {
		factor = 0.3048;
	} else {
		return { error: `Unsupported depth grid unit '${rawUnit}'. Supported: m, cm, mm, ft.` };
	}

	const convertCell = (v) => {
		if (v === null || v === undefined) return nodata;
		const num = Number(v);
		if (!Number.isFinite(num) || num === nodata) return nodata;
		return Number((num * factor).toFixed(6));
	};

	const is2D = Array.isArray(values[0]);
	const normalized = is2D
		? values.map((row) => (Array.isArray(row) ? row.map(convertCell) : []))
		: values.map(convertCell);

	return { values: normalized, unit: "m", conversionFactor: factor };
}

/**
 * Compute summary statistics over a validated depth grid (excluding nodata cells).
 */
function summarizeDepthGrid(values, nodata = -9999) {
	const flat = Array.isArray(values[0]) ? values.flat() : values;
	let validCount = 0;
	let inundatedCount = 0;
	let nodataCount = 0;
	let sum = 0;
	let min = Infinity;
	let max = -Infinity;

	for (const raw of flat) {
		if (raw === null || raw === undefined || !Number.isFinite(raw) || raw === nodata) {
			nodataCount += 1;
			continue;
		}
		validCount += 1;
		if (raw > 0) inundatedCount += 1;
		sum += raw;
		if (raw < min) min = raw;
		if (raw > max) max = raw;
	}

	return {
		totalCells: flat.length,
		validCells: validCount,
		inundatedCells: inundatedCount,
		nodataCells: nodataCount,
		minDepthMeters: validCount > 0 ? Number(min.toFixed(4)) : null,
		maxDepthMeters: validCount > 0 ? Number(max.toFixed(4)) : null,
		meanDepthMeters: validCount > 0 ? Number((sum / validCount).toFixed(4)) : null,
	};
}

/**
 * Classify a STAC Item's assets into flood depth, flood extent, COG, and JSON grid assets.
 */
function classifyStacAssets(assetsObj = {}) {
	const classified = [];
	let hasDepthAsset = false;
	let hasExtentAsset = false;
	let hasCogAsset = false;
	let hasJsonDepthAsset = false;

	for (const [key, asset] of Object.entries(assetsObj || {})) {
		if (!asset || typeof asset !== "object") continue;
		const keyLower = key.toLowerCase();
		const titleLower = String(asset.title || "").toLowerCase();
		const typeLower = String(asset.type || "").toLowerCase();
		const roles = Array.isArray(asset.roles) ? asset.roles.map((r) => String(r).toLowerCase()) : [];

		const isDepth =
			keyLower.includes("depth") ||
			titleLower.includes("depth") ||
			roles.some((r) => r.includes("depth") || r === "flood-depth");
		const isExtent =
			!isDepth &&
			(keyLower.includes("extent") ||
				keyLower.includes("mask") ||
				titleLower.includes("extent") ||
				roles.some((r) => r.includes("extent") || r.includes("mask")));
		const isCog =
			typeLower.includes("cloud-optimized") ||
			typeLower.includes("geotiff") ||
			String(asset.href || "").toLowerCase().endsWith(".tif") ||
			String(asset.href || "").toLowerCase().endsWith(".tiff");
		const isJson =
			typeLower.includes("json") ||
			String(asset.href || "").toLowerCase().endsWith(".json");

		if (isDepth) hasDepthAsset = true;
		if (isExtent) hasExtentAsset = true;
		if (isCog) hasCogAsset = true;
		if (isDepth && isJson) hasJsonDepthAsset = true;

		const safeTitle = sanitizeUntrustedFeedText(asset.title || key);

		classified.push({
			key,
			title: safeTitle.text,
			href: asset.href ? redactUrlSecrets(asset.href) : null,
			mediaType: asset.type || null,
			roles,
			kind: isDepth ? "flood_depth" : isExtent ? "flood_extent" : "auxiliary",
			isCog,
			isJson,
			injectionDetected: safeTitle.injectionDetected,
		});
	}

	return {
		assets: classified,
		hasDepthAsset,
		hasExtentAsset,
		hasCogAsset,
		hasJsonDepthAsset,
	};
}

/**
 * Determine licensing & redistribution policy from a STAC item's properties
 */
function extractStacLicensing(props = {}, itemOverrides = {}) {
	const rawLicense = props.license || itemOverrides.license || null;
	const licenseLower = rawLicense ? String(rawLicense).trim().toLowerCase() : "";

	let providerType = props["drr:provider_type"] || itemOverrides.providerType || null;
	const providers = Array.isArray(props.providers) ? props.providers : [];
	if (!providerType && providers.length > 0) {
		const names = providers.map((p) => String(p.name || "").toLowerCase()).join(" ");
		if (
			names.includes("copernicus") ||
			names.includes("esa") ||
			names.includes("nasa") ||
			names.includes("noaa") ||
			names.includes("usgs") ||
			names.includes("jaxa")
		) {
			providerType = "government";
		} else if (
			names.includes("iceye") ||
			names.includes("capella") ||
			names.includes("planet") ||
			names.includes("maxar") ||
			names.includes("floodbase")
		) {
			providerType = "private";
		}
	}
	if (!providerType) providerType = "unspecified";

	let redistributionAllowed;
	if (props["drr:redistribution_allowed"] !== undefined) {
		redistributionAllowed = Boolean(props["drr:redistribution_allowed"]);
	} else if (licenseLower && OPEN_LICENSES.has(licenseLower)) {
		redistributionAllowed = true;
	} else if (licenseLower === "proprietary" || licenseLower.includes("commercial") || providerType === "private") {
		redistributionAllowed = false;
	} else {
		redistributionAllowed = false; // Fail-closed when license is unknown/missing
	}

	return {
		providerType,
		license: rawLicense,
		providers: providers.map((p) => sanitizeUntrustedFeedText(p.name || "").text).filter(Boolean),
		redistributionAllowed,
	};
}

/**
 * Build an SSRF-guarded STAC API v1.0.0 /search URL
 */
function buildStacSearchUrl(baseUrl, options = {}) {
	if (!baseUrl || typeof baseUrl !== "string") {
		throw new Error("STAC endpointUrl is required when no samplePayload is provided.");
	}
	let parsed;
	try {
		parsed = new URL(baseUrl);
	} catch (err) {
		throw new Error(`Invalid STAC URL: ${baseUrl}`);
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported protocol for STAC URL: ${parsed.protocol}`);
	}

	if (!CONFIG.ALLOW_PRIVATE_WEBHOOKS && isBlockedWebhookHost(parsed.hostname)) {
		throw new Error(
			`SSRF guard blocked STAC host "${parsed.hostname}". Set DRR_ALLOW_PRIVATE_WEBHOOKS=true only for trusted internal EOC networks.`,
		);
	}

	const cleanPath = parsed.pathname.replace(/\/+$/, "");
	if (!/\/(search|items)(\/[^/]+)?$/i.test(cleanPath)) {
		parsed.pathname = `${cleanPath}/search`;
	}

	if (Array.isArray(options.bbox) && options.bbox.length === 4 && !parsed.searchParams.has("bbox")) {
		parsed.searchParams.set("bbox", options.bbox.join(","));
	}
	if (options.datetime && typeof options.datetime === "string" && !parsed.searchParams.has("datetime")) {
		parsed.searchParams.set("datetime", options.datetime);
	}
	if (Array.isArray(options.collections) && options.collections.length > 0 && !parsed.searchParams.has("collections")) {
		parsed.searchParams.set("collections", options.collections.join(","));
	} else if (typeof options.collections === "string" && options.collections.trim() && !parsed.searchParams.has("collections")) {
		parsed.searchParams.set("collections", options.collections.trim());
	}

	const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 100) : 20;
	if (!parsed.searchParams.has("limit")) {
		parsed.searchParams.set("limit", String(limit));
	}

	return parsed.toString();
}

/**
 * Validate and normalize a raw depth grid linked to a STAC Item via lib/hydro.js ingestValidatedInundationGrid
 */
function validateStacDepthGrid(rawGrid, itemMeta = {}) {
	if (!rawGrid || typeof rawGrid !== "object" || !Array.isArray(rawGrid.values)) {
		return {
			valid: false,
			depthStatus: "depth_unavailable",
			errors: ["Depth grid payload must be an object containing a values array."],
		};
	}

	const nodata = rawGrid.nodata ?? -9999;
	const norm = normalizeDepthValuesToMeters(rawGrid.values, rawGrid.unit || "m", nodata);
	if (norm.error) {
		return {
			valid: false,
			depthStatus: "depth_unavailable",
			errors: [norm.error],
		};
	}

	const bbox = rawGrid.bbox || itemMeta.bbox;
	const crs = rawGrid.crs || itemMeta.crs || "EPSG:4326";
	const modelSource = rawGrid.modelSource || itemMeta.modelSource || itemMeta.id || "stac-eo-depth-grid";
	const width = rawGrid.width || (Array.isArray(norm.values[0]) ? norm.values[0].length : undefined);
	const height = rawGrid.height || (Array.isArray(norm.values[0]) ? norm.values.length : undefined);

	const validated = ingestValidatedInundationGrid({
		modelSource,
		validationStatus: rawGrid.validationStatus || itemMeta.validationStatus || "stac_validated_external_grid",
		unit: "m",
		crs,
		bbox,
		width,
		height,
		values: norm.values,
		nodata,
	});

	if (!validated.valid) {
		return validated;
	}

	return {
		...validated,
		originalUnit: rawGrid.unit || "m",
		conversionFactorToMeters: norm.conversionFactor,
		quantityType: "continuous",
		statistics: summarizeDepthGrid(norm.values, nodata),
	};
}

/**
 * Parse a STAC v1.0.0 ItemCollection or single STAC Item into normalized DRR hazard products
 * and validated inundation depth grids.
 */
function parseStacCatalogPayload(payload, options = {}) {
	if (!payload || typeof payload !== "object") {
		throw new Error("Invalid STAC payload: expected a STAC FeatureCollection or Feature object");
	}

	const retrievedAt = options.retrievedAt || new Date().toISOString();
	const payloadHash = `sha256:${computeSnapshotHash(payload)}`;
	const maxCloudCover =
		typeof options.maxCloudCover === "number" && options.maxCloudCover >= 0
			? options.maxCloudCover
			: 25;

	let rawItems = [];
	if (payload.type === "FeatureCollection" && Array.isArray(payload.features)) {
		rawItems = payload.features;
	} else if (payload.type === "Feature" && payload.id) {
		rawItems = [payload];
	} else {
		throw new Error("Invalid STAC payload: expected FeatureCollection with features[] or a STAC Item Feature");
	}

	const normalizedItems = [];
	let validatedDepthGridCount = 0;
	let extentOnlyCount = 0;
	let cogRequiresExtractionCount = 0;
	let cloudObscuredCount = 0;
	let anyRestrictedRedistribution = false;
	let anyPromptInjection = false;
	let latestSourceIssuedAt = null;

	for (const item of rawItems) {
		if (!item || typeof item !== "object") continue;
		const props = item.properties || {};

		const titleSanitized = sanitizeUntrustedFeedText(props.title || item.id || "STAC Hazard Item");
		const descSanitized = sanitizeUntrustedFeedText(props.description || "");
		const collectionSanitized = sanitizeUntrustedFeedText(item.collection || "");

		const assetSummary = classifyStacAssets(item.assets || {});
		const itemInjection =
			titleSanitized.injectionDetected ||
			descSanitized.injectionDetected ||
			collectionSanitized.injectionDetected ||
			assetSummary.assets.some((a) => a.injectionDetected);
		if (itemInjection) anyPromptInjection = true;

		const licensing = extractStacLicensing(props, { providerType: options.providerType });
		if (!licensing.redistributionAllowed) anyRestrictedRedistribution = true;

		const datetime = props.datetime || props.end_datetime || props.start_datetime || null;
		if (datetime && (!latestSourceIssuedAt || datetime > latestSourceIssuedAt)) {
			latestSourceIssuedAt = datetime;
		}

		const cloudCover =
			typeof props["eo:cloud_cover"] === "number" ? props["eo:cloud_cover"] : null;
		const cloudObscured = cloudCover !== null && cloudCover > maxCloudCover;
		if (cloudObscured) cloudObscuredCount += 1;

		const crs = props["proj:epsg"]
			? `EPSG:${props["proj:epsg"]}`
			: props["proj:code"] || "EPSG:4326";

		// Check for inline or caller-supplied depth grid
		const candidateGrid =
			props["drr:depth_grid"] ||
			(options.sampleDepthGrid &&
			(!options.sampleDepthGrid.itemId || options.sampleDepthGrid.itemId === item.id)
				? options.sampleDepthGrid
				: null);

		let depthStatus = "depth_unavailable";
		let validatedInundationGrid = null;
		let requiresExternalCogDecoder = false;

		if (candidateGrid) {
			const res = validateStacDepthGrid(candidateGrid, {
				id: item.id,
				bbox: item.bbox,
				crs,
				modelSource: `${item.collection || "stac"}:${item.id}`,
			});
			if (res.valid) {
				depthStatus = "validated_depth_grid";
				validatedInundationGrid = res;
				validatedDepthGridCount += 1;
			} else {
				depthStatus = "invalid_depth_grid";
				validatedInundationGrid = res;
			}
		} else if (assetSummary.hasDepthAsset && assetSummary.hasCogAsset) {
			depthStatus = "cog_asset_requires_extraction";
			requiresExternalCogDecoder = true;
			cogRequiresExtractionCount += 1;
		} else if (assetSummary.hasExtentAsset) {
			depthStatus = "extent_only_no_depth";
			extentOnlyCount += 1;
		}

		const evidenceBasis =
			!cloudObscured && (depthStatus === "validated_depth_grid" || assetSummary.hasExtentAsset || assetSummary.hasDepthAsset)
				? "observed"
				: "unverified_eo";

		normalizedItems.push({
			id: String(item.id || `stac_item_${normalizedItems.length + 1}`),
			stacVersion: item.stac_version || "1.0.0",
			collection: collectionSanitized.text || null,
			title: titleSanitized.text,
			description: descSanitized.text,
			datetime,
			bbox: Array.isArray(item.bbox) ? item.bbox : null,
			geometry: item.geometry || null,
			crs,
			eoMetadata: {
				platform: props.platform || null,
				constellation: props.constellation || null,
				instruments: Array.isArray(props.instruments) ? props.instruments : [],
				sarMode: props["sar:instrument_mode"] || null,
				gsdMeters: typeof props.gsd === "number" ? props.gsd : null,
				cloudCoverPercent: cloudCover,
				cloudObscured,
			},
			depthStatus,
			requiresExternalCogDecoder,
			validatedInundationGrid,
			assets: assetSummary.assets,
			licensing,
			governanceMetadata: {
				evidenceBasis,
				verificationStatus: "unreviewed",
				approvalStatus: "draft",
				reportingEligibility: "pending",
			},
			untrustedFeedSecurity: {
				untrustedData: true,
				injectionDetected: itemInjection,
			},
		});
	}

	return {
		standard: "STAC Specification v1.0.0 + DRR Validated Inundation Grid (R-12 / C-05)",
		method: getRegisteredMethod(STAC_METHOD_ID),
		sourceUrl: options.sourceUrl ? redactUrlSecrets(options.sourceUrl) : "offline_fixture",
		sourceIssuedAt: latestSourceIssuedAt,
		retrievedAt,
		payloadHash,
		summary: {
			itemCount: normalizedItems.length,
			validatedDepthGridCount,
			extentOnlyCount,
			cogRequiresExtractionCount,
			cloudObscuredCount,
			anyRestrictedRedistribution,
		},
		items: normalizedItems,
		untrustedFeedSecurity: {
			untrustedData: true,
			promptInjectionFlagged: anyPromptInjection,
		},
	};
}

/**
 * Convert parsed STAC items into a GeoJSON FeatureCollection of footprints
 * compatible with drr_spatial_exposure_join.
 */
function toStacFootprintGeoJSON(parsedReport) {
	const items = Array.isArray(parsedReport?.items) ? parsedReport.items : [];
	const features = [];

	for (const item of items) {
		if (!item.geometry) continue;
		features.push({
			type: "Feature",
			id: item.id,
			bbox: item.bbox || undefined,
			geometry: item.geometry,
			properties: {
				id: item.id,
				title: item.title,
				collection: item.collection,
				datetime: item.datetime,
				depthStatus: item.depthStatus,
				maxDepthMeters: item.validatedInundationGrid?.statistics?.maxDepthMeters ?? null,
				meanDepthMeters: item.validatedInundationGrid?.statistics?.meanDepthMeters ?? null,
				providerType: item.licensing?.providerType || "unspecified",
				redistributionAllowed: item.licensing?.redistributionAllowed ?? false,
				evidenceBasis: item.governanceMetadata?.evidenceBasis || "unverified_eo",
			},
		});
	}

	return {
		type: "FeatureCollection",
		features,
	};
}

/**
 * Ingest STAC v1.0.0 catalog items from either an offline samplePayload or live STAC API endpoint.
 */
async function ingestStacHazardCatalog(options = {}) {
	const retrievedAt = options.retrievedAt || new Date().toISOString();
	let payload = options.samplePayload || null;
	let resolvedUrl = null;

	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch (err) {
			throw new Error(`Failed to parse STAC samplePayload JSON: ${err.message}`);
		}
	}

	if (!payload) {
		const baseUrl = options.endpointUrl || CONFIG.STAC_API_URL;
		resolvedUrl = buildStacSearchUrl(baseUrl, options);

		const headers = {};
		const apiKey = options.apiKey || CONFIG.STAC_API_KEY;
		const apiKeyHeader = options.apiKeyHeader || CONFIG.STAC_API_KEY_HEADER || "X-API-Key";
		if (apiKey) {
			headers[apiKeyHeader] = apiKey;
		}

		payload = await fetchJsonWithConfig(resolvedUrl, headers);
	}

	return parseStacCatalogPayload(payload, {
		...options,
		retrievedAt,
		sourceUrl: resolvedUrl,
	});
}

module.exports = {
	STAC_METHOD_ID,
	normalizeDepthValuesToMeters,
	summarizeDepthGrid,
	classifyStacAssets,
	buildStacSearchUrl,
	validateStacDepthGrid,
	parseStacCatalogPayload,
	toStacFootprintGeoJSON,
	ingestStacHazardCatalog,
};
