/**
 * OCHA HDX Humanitarian API (HAPI) & COD-AB Administrative Boundary Adapter
 *
 * Bridges OCHA Humanitarian Data Exchange (HDX) HAPI v2 indicators (population,
 * humanitarian needs, IDPs, refugees, operational presence, metadata) and OCHA
 * Common Operational Datasets - Administrative Boundaries (COD-AB) P-code validation
 * into DRR exposure, severity, and UNDRR DELTA Resilience workflows.
 *
 * Security & Governance:
 * - Zero external dependencies (pure Node.js standard library)
 * - SSRF host protection on custom HAPI endpoints (respects ALLOW_PRIVATE_WEBHOOKS)
 * - Untrusted feed text sanitization (prompt-injection guard)
 * - Explicit freshness, geographic coverage, and license/redistribution screening
 * - Preserves unknown !== 0 missing-data semantics (R-02)
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
const { validateGeoJson } = require("./spatial");

const HDX_HAPI_METHOD_ID = "telemetry.hdx.hapi_v1";
const COD_VALIDATION_METHOD_ID = "spatial.cod_ab.validation_v1";
const DEFAULT_HAPI_BASE_URL = "https://hapi.humdata.org/api/v2";

const SUPPORTED_HAPI_RESOURCES = new Set([
	"population-social/population",
	"affected-people/humanitarian-needs",
	"affected-people/idps",
	"affected-people/refugees-persons-of-concern",
	"coordination-context/operational-presence",
	"food-security-nutrition-poverty/food-security",
	"metadata/location",
	"metadata/admin1",
	"metadata/admin2",
	"metadata/dataset",
	"metadata/resource",
]);

const OPEN_HDX_LICENSES = new Set([
	"cc-by",
	"cc-by-4.0",
	"cc-by-3.0",
	"cc-by-igo",
	"cc-by-3.0-igo",
	"cc-by-sa",
	"cc-by-sa-4.0",
	"cc0",
	"cc0-1.0",
	"odc-by",
	"public-domain",
	"hdx-other-open",
]);

const ISO3_REGEX = /^[A-Z]{3}$/;
const PCODE_REGEX = /^[A-Z]{2,3}[A-Z0-9_-]{0,24}$/;

function cleanText(val, maxLen = 120) {
	if (val === null || val === undefined) return null;
	const res = sanitizeUntrustedFeedText(String(val), maxLen);
	const txt = typeof res === "string" ? res : res && typeof res.text === "string" ? res.text : String(val);
	return txt.replace(/<[^>]*>/g, "").trim();
}

/**
 * Build a validated OCHA HDX HAPI v2 query URL with SSRF protection.
 */
function buildHdxHapiUrl(options = {}) {
	const base = String(options.endpointUrl || process.env.HDX_HAPI_URL || DEFAULT_HAPI_BASE_URL).replace(/\/+$/, "");
	const resource = String(options.resource || "population-social/population").replace(/^\/+/, "");

	if (!SUPPORTED_HAPI_RESOURCES.has(resource)) {
		throw new Error(
			`Unsupported HDX HAPI resource '${resource}'. Supported: ${Array.from(SUPPORTED_HAPI_RESOURCES).join(", ")}.`,
		);
	}

	let parsedBase;
	try {
		parsedBase = new URL(base);
	} catch (_) {
		throw new Error(`Invalid HDX HAPI endpointUrl: '${base}'`);
	}

	if (parsedBase.protocol !== "https:" && parsedBase.protocol !== "http:") {
		throw new Error(`Unsupported protocol '${parsedBase.protocol}' for HDX HAPI endpoint.`);
	}

	if (!CONFIG.ALLOW_PRIVATE_WEBHOOKS && isBlockedWebhookHost(parsedBase.hostname)) {
		throw new Error(
			`SSRF protection blocked private/internal HDX HAPI host '${parsedBase.hostname}'. Set ALLOW_PRIVATE_WEBHOOKS=true only for trusted internal mirrors.`,
		);
	}

	const url = new URL(`${base}/${resource}`);
	const appIdentifier = options.appIdentifier || process.env.HAPI_APP_IDENTIFIER || "";
	if (appIdentifier) {
		url.searchParams.set("app_identifier", String(appIdentifier));
	}
	if (options.locationCode) {
		const iso3 = String(options.locationCode).trim().toUpperCase();
		if (!ISO3_REGEX.test(iso3)) {
			throw new Error(`Invalid ISO3 locationCode '${options.locationCode}'. Expected 3 uppercase letters (e.g. THA, PHL, BGD).`);
		}
		url.searchParams.set("location_code", iso3);
	}
	if (options.admin1Code) {
		url.searchParams.set("admin1_code", String(options.admin1Code).trim());
	}
	if (options.admin2Code) {
		url.searchParams.set("admin2_code", String(options.admin2Code).trim());
	}
	if (options.adminLevel !== undefined && options.adminLevel !== null) {
		url.searchParams.set("admin_level", String(options.adminLevel));
	}
	if (options.referencePeriodStartMin) {
		url.searchParams.set("reference_period_start_min", String(options.referencePeriodStartMin));
	}
	const limit = Math.min(Math.max(1, Number(options.limit) || 100), 10000);
	url.searchParams.set("limit", String(limit));
	if (options.offset !== undefined && options.offset !== null) {
		url.searchParams.set("offset", String(Math.max(0, Number(options.offset) || 0)));
	}
	url.searchParams.set("output_format", "json");

	return url.toString();
}

/**
 * Evaluate dataset license string for open redistribution compatibility.
 */
function evaluateHdxLicense(rawLicense) {
	if (!rawLicense) {
		return {
			license: "unknown",
			redistributionAllowed: false,
			warning: "Dataset license is missing; verify HDX terms before redistribution.",
		};
	}
	const norm = String(rawLicense).trim().toLowerCase().replace(/\s+/g, "-");
	const open = OPEN_HDX_LICENSES.has(norm) || norm.startsWith("cc-by") || norm.startsWith("cc0");
	return {
		license: cleanText(rawLicense, 80),
		redistributionAllowed: open,
		warning: open ? null : `License '${norm}' is not on the open-redistribution allowlist; confirm reuse rights.`,
	};
}

/**
 * Normalize and validate an HDX HAPI v2 JSON payload (`{ data: [...] }` or raw array).
 */
function parseHdxHapiPayload(payload, options = {}) {
	if (!payload || typeof payload !== "object") {
		throw new Error("HDX HAPI payload must be a JSON object or array.");
	}
	const rawRows = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : null;
	if (!rawRows) {
		throw new Error("HDX HAPI payload missing 'data' array.");
	}

	const resource = String(options.resource || "population-social/population");
	const nowMs = options.referenceTime ? Date.parse(options.referenceTime) : Date.now();
	const maxAgeDays = options.maxAgeDays !== undefined && options.maxAgeDays !== null ? Number(options.maxAgeDays) : 365;
	const filterIso3 = options.locationCode ? String(options.locationCode).trim().toUpperCase() : null;

	const records = [];
	const warnings = [];
	const countries = new Set();
	const organizations = new Set();
	const adminLevels = new Set();
	const pcodes = new Set();

	let staleCount = 0;
	let restrictedLicenseCount = 0;
	let missingValueCount = 0;
	let totalPopulationSum = 0;
	let hasPopulationValue = false;

	for (let idx = 0; idx < rawRows.length; idx++) {
		const row = rawRows[idx];
		if (!row || typeof row !== "object") continue;

		const iso3Raw = row.location_code || row.iso3 || row.country_code || null;
		const iso3 = iso3Raw ? String(iso3Raw).trim().toUpperCase() : null;
		if (filterIso3 && iso3 && iso3 !== filterIso3) {
			continue;
		}
		if (iso3 && !ISO3_REGEX.test(iso3)) {
			warnings.push(`Row ${idx}: invalid ISO3 code '${iso3}'.`);
		}
		if (iso3) countries.add(iso3);

		const admin1Code = row.admin1_code ? cleanText(row.admin1_code, 64) : null;
		const admin2Code = row.admin2_code ? cleanText(row.admin2_code, 64) : null;
		const pcode = admin2Code || admin1Code || iso3 || null;
		if (pcode) pcodes.add(pcode);

		const adminLevel =
			row.admin_level !== undefined && row.admin_level !== null
				? Number(row.admin_level)
				: admin2Code
					? 2
					: admin1Code
						? 1
						: iso3
							? 0
							: null;
		if (adminLevel !== null && Number.isFinite(adminLevel)) adminLevels.add(adminLevel);

		const refStart = row.reference_period_start || row.date || null;
		const refEnd = row.reference_period_end || refStart || null;
		let ageDays = null;
		let stale = false;
		if (refEnd) {
			const parsedEnd = Date.parse(refEnd);
			if (Number.isFinite(parsedEnd) && Number.isFinite(nowMs)) {
				ageDays = Number(((nowMs - parsedEnd) / 86400000).toFixed(1));
				if (Number.isFinite(maxAgeDays) && ageDays > maxAgeDays) {
					stale = true;
					staleCount += 1;
				}
			}
		}

		const licenseInfo = evaluateHdxLicense(row.license || row.dataset_license || options.defaultLicense);
		if (!licenseInfo.redistributionAllowed) {
			restrictedLicenseCount += 1;
		}

		const org = row.org_name || row.organization || row.provider_name || row.source || null;
		const cleanOrg = org ? cleanText(org, 120) : null;
		if (cleanOrg) organizations.add(cleanOrg);

		// Extract primary numeric indicator without coercing null/undefined to 0 (R-02)
		const rawVal =
			row.population !== undefined
				? row.population
				: row.affected_population !== undefined
					? row.affected_population
					: row.in_need !== undefined
						? row.in_need
						: row.targeted !== undefined
							? row.targeted
							: row.reached !== undefined
								? row.reached
								: row.value !== undefined
									? row.value
									: null;

		const numericVal = rawVal === null || rawVal === undefined || rawVal === "" ? null : Number(rawVal);
		const value = numericVal !== null && Number.isFinite(numericVal) ? numericVal : null;
		if (value === null && !resource.startsWith("metadata/")) {
			missingValueCount += 1;
		} else if (value !== null) {
			totalPopulationSum += value;
			hasPopulationValue = true;
		}

		records.push({
			locationCode: iso3,
			locationName: row.location_name ? cleanText(row.location_name, 120) : null,
			adminLevel,
			admin1Code,
			admin1Name: row.admin1_name ? cleanText(row.admin1_name, 120) : null,
			admin2Code,
			admin2Name: row.admin2_name ? cleanText(row.admin2_name, 120) : null,
			pcode,
			value,
			indicatorType:
				row.population !== undefined
					? "population"
					: row.in_need !== undefined
						? "humanitarian_needs"
						: row.affected_population !== undefined
							? "affected_population"
							: resource,
			populationGroup: row.population_group ? cleanText(row.population_group, 64) : null,
			sectorCode: row.sector_code ? cleanText(row.sector_code, 64) : null,
			organization: cleanOrg,
			datasetId: row.dataset_hdx_id || row.resource_hdx_id || null,
			referencePeriodStart: refStart,
			referencePeriodEnd: refEnd,
			ageDays,
			stale,
			license: licenseInfo.license,
			redistributionAllowed: licenseInfo.redistributionAllowed,
		});
	}

	if (staleCount > 0) {
		warnings.push(`${staleCount} record(s) exceed maxAgeDays (${maxAgeDays} days) and may be outdated.`);
	}
	if (restrictedLicenseCount > 0) {
		warnings.push(`${restrictedLicenseCount} record(s) have missing or non-open redistribution licenses.`);
	}
	if (missingValueCount > 0) {
		warnings.push(`${missingValueCount} indicator record(s) have null/missing numeric values (preserved as null, never coerced to 0).`);
	}

	return {
		resource,
		records,
		summary: {
			recordCount: records.length,
			countries: Array.from(countries).sort(),
			adminLevels: Array.from(adminLevels).sort((a, b) => a - b),
			uniquePcodeCount: pcodes.size,
			organizations: Array.from(organizations).sort(),
			staleCount,
			restrictedLicenseCount,
			missingValueCount,
			totalIndicatorValue: hasPopulationValue ? totalPopulationSum : null,
		},
		warnings,
	};
}

/**
 * Ingest HDX HAPI humanitarian data (live REST fetch or offline samplePayload).
 */
async function ingestHdxHapiData(options = {}) {
	const method = getRegisteredMethod(HDX_HAPI_METHOD_ID);
	let rawPayload = options.samplePayload || null;
	let sourceUrl = null;
	let mode = "offline_sample";

	if (!rawPayload) {
		sourceUrl = buildHdxHapiUrl(options);
		rawPayload = await fetchJsonWithConfig(sourceUrl);
		mode = "live_hapi";
	}

	const parsed = parseHdxHapiPayload(rawPayload, options);
	const sanitizedUrl = sourceUrl ? redactUrlSecrets(sourceUrl) : "offline://samplePayload";
	const snapshotHash = computeSnapshotHash({
		resource: parsed.resource,
		summary: parsed.summary,
		recordCount: parsed.records.length,
	});

	return {
		method: method
			? { id: method.id, version: method.version, productionStatus: method.productionStatus }
			: { id: HDX_HAPI_METHOD_ID, version: "2.0", productionStatus: "registered_empirical_screening" },
		mode,
		sourceUrl: sanitizedUrl,
		resource: parsed.resource,
		summary: parsed.summary,
		records: parsed.records,
		warnings: parsed.warnings,
		provenance: {
			source: "OCHA HDX HAPI",
			retrievedAt: new Date().toISOString(),
			snapshotHash,
			evidenceBasis: "observed",
			verificationStatus: "external_unverified",
			approvalStatus: "draft",
			reportingEligibility: "screening_only",
		},
	};
}

/**
 * Extract administrative P-code properties from a COD-AB GeoJSON feature or record.
 */
function extractCodProperties(props = {}, requestedAdminLevel = null) {
	const get = (...keys) => {
		for (const k of keys) {
			if (props[k] !== undefined && props[k] !== null && String(props[k]).trim() !== "") {
				return String(props[k]).trim();
			}
		}
		return null;
	};

	const iso3 = (get("ADM0_PCODE", "adm0_pcode", "ISO3", "iso3", "location_code") || "").toUpperCase() || null;
	const adm1 = get("ADM1_PCODE", "adm1_pcode", "admin1_code");
	const adm2 = get("ADM2_PCODE", "adm2_pcode", "admin2_code");
	const adm3 = get("ADM3_PCODE", "adm3_pcode", "admin3_code");
	const adm4 = get("ADM4_PCODE", "adm4_pcode", "admin4_code");

	let detectedLevel = requestedAdminLevel !== null && requestedAdminLevel !== undefined ? Number(requestedAdminLevel) : null;
	if (detectedLevel === null || !Number.isFinite(detectedLevel)) {
		if (adm4) detectedLevel = 4;
		else if (adm3) detectedLevel = 3;
		else if (adm2) detectedLevel = 2;
		else if (adm1) detectedLevel = 1;
		else if (iso3) detectedLevel = 0;
	}

	const levelMap = { 0: iso3, 1: adm1, 2: adm2, 3: adm3, 4: adm4 };
	const pcode = detectedLevel !== null ? levelMap[detectedLevel] || get("PCODE", "pcode") : get("PCODE", "pcode");
	const parentPcode = detectedLevel !== null && detectedLevel > 0 ? levelMap[detectedLevel - 1] || get("PARENT_PCODE", "parent_pcode") : null;

	const name =
		get(
			`ADM${detectedLevel}_EN`,
			`adm${detectedLevel}_en`,
			`ADM${detectedLevel}_NAME`,
			"name",
			"NAME",
			"admin2_name",
			"admin1_name",
		) || null;

	const releaseDate = get("date", "validOn", "valid_on", "release_date", "updated_at") || null;
	const source = get("source", "SOURCE", "cod_source") || null;

	return {
		iso3,
		adminLevel: detectedLevel,
		pcode,
		parentPcode,
		name: name ? cleanText(name, 120) : null,
		releaseDate,
		source: source ? cleanText(source, 120) : null,
	};
}

/**
 * Validate OCHA COD-AB administrative boundaries (GeoJSON FeatureCollection or metadata array):
 * - ISO3 & P-code syntax and uniqueness
 * - Parent-child P-code hierarchy consistency (prefix & parent presence)
 * - Release date freshness & boundary source attribution
 * - RFC 7946 GeoJSON geometry validation (via validateGeoJson)
 * - Optional reconciliation against UNDRR DELTA administrative divisions
 */
function validateCodBoundaries(options = {}) {
	const method = getRegisteredMethod(COD_VALIDATION_METHOD_ID);
	const boundaryGeoJSON = options.boundaryGeoJSON || options.geojson || null;
	const recordsInput = Array.isArray(options.records) ? options.records : null;

	if (!boundaryGeoJSON && !recordsInput) {
		throw new Error("validateCodBoundaries requires either 'boundaryGeoJSON' (FeatureCollection) or 'records' (array).");
	}

	const expectedIso3 = options.expectedIso3 ? String(options.expectedIso3).trim().toUpperCase() : null;
	const expectedAdminLevel =
		options.expectedAdminLevel !== undefined && options.expectedAdminLevel !== null
			? Number(options.expectedAdminLevel)
			: null;
	const maxAgeDays = options.maxAgeDays !== undefined && options.maxAgeDays !== null ? Number(options.maxAgeDays) : 1095;
	const nowMs = options.referenceTime ? Date.parse(options.referenceTime) : Date.now();

	const errors = [];
	const warnings = [];
	let geometryReport = null;
	let featureRows = [];

	if (boundaryGeoJSON) {
		geometryReport = validateGeoJson(boundaryGeoJSON, { crs: options.crs || "EPSG:4326" });
		if (!geometryReport.valid) {
			for (const gErr of geometryReport.errors) {
				errors.push({
					code: `GEOJSON_${gErr.code || "INVALID"}`,
					message: gErr.message || String(gErr),
				});
			}
		}
		if (Array.isArray(geometryReport.warnings)) {
			for (const gWarn of geometryReport.warnings) {
				warnings.push({
					code: `GEOJSON_${gWarn.code || "WARNING"}`,
					message: gWarn.message || String(gWarn),
				});
			}
		}
		if (boundaryGeoJSON.type === "FeatureCollection" && Array.isArray(boundaryGeoJSON.features)) {
			featureRows = boundaryGeoJSON.features.map((f) => f.properties || {});
		} else if (boundaryGeoJSON.type === "Feature") {
			featureRows = [boundaryGeoJSON.properties || {}];
		}
	} else {
		featureRows = recordsInput;
	}

	const seenPcodes = new Map();
	const duplicatePcodes = [];
	const iso3Set = new Set();
	const adminLevels = new Set();
	const extracted = [];
	const releaseDates = new Set();
	const sources = new Set();
	let missingPcodeCount = 0;
	let hierarchyMismatchCount = 0;
	let staleFeatureCount = 0;

	for (let i = 0; i < featureRows.length; i++) {
		const info = extractCodProperties(featureRows[i], expectedAdminLevel);
		extracted.push(info);

		if (info.iso3) {
			iso3Set.add(info.iso3);
			if (!ISO3_REGEX.test(info.iso3)) {
				errors.push({ code: "INVALID_ISO3", index: i, message: `Feature ${i}: invalid ISO3 '${info.iso3}'.` });
			}
			if (expectedIso3 && info.iso3 !== expectedIso3) {
				errors.push({
					code: "ISO3_MISMATCH",
					index: i,
					message: `Feature ${i}: ISO3 '${info.iso3}' does not match expected '${expectedIso3}'.`,
				});
			}
		} else {
			warnings.push({ code: "MISSING_ISO3", index: i, message: `Feature ${i}: missing ADM0_PCODE / ISO3.` });
		}

		if (info.adminLevel !== null) {
			adminLevels.add(info.adminLevel);
			if (expectedAdminLevel !== null && info.adminLevel !== expectedAdminLevel) {
				errors.push({
					code: "ADMIN_LEVEL_MISMATCH",
					index: i,
					message: `Feature ${i}: detected adminLevel ${info.adminLevel} != expected ${expectedAdminLevel}.`,
				});
			}
		}

		if (!info.pcode) {
			missingPcodeCount += 1;
			errors.push({ code: "MISSING_PCODE", index: i, message: `Feature ${i}: missing P-code at admin level ${info.adminLevel ?? "unknown"}.` });
		} else {
			if (!PCODE_REGEX.test(info.pcode)) {
				errors.push({ code: "INVALID_PCODE_SYNTAX", index: i, pcode: info.pcode, message: `Feature ${i}: invalid P-code syntax '${info.pcode}'.` });
			}
			if (seenPcodes.has(info.pcode)) {
				duplicatePcodes.push(info.pcode);
				errors.push({ code: "DUPLICATE_PCODE", index: i, pcode: info.pcode, message: `Duplicate P-code '${info.pcode}' at feature ${i}.` });
			} else {
				seenPcodes.set(info.pcode, i);
			}
		}

		// Parent-child P-code hierarchy check
		if (info.pcode && info.parentPcode) {
			if (!info.pcode.startsWith(info.parentPcode) && info.adminLevel > 1) {
				hierarchyMismatchCount += 1;
				errors.push({
					code: "PCODE_HIERARCHY_MISMATCH",
					index: i,
					pcode: info.pcode,
					parentPcode: info.parentPcode,
					message: `Feature ${i}: P-code '${info.pcode}' does not nest under parent '${info.parentPcode}'.`,
				});
			}
		} else if (info.adminLevel !== null && info.adminLevel >= 2 && !info.parentPcode) {
			warnings.push({
				code: "MISSING_PARENT_PCODE",
				index: i,
				pcode: info.pcode,
				message: `Feature ${i} ('${info.pcode}'): ADM${info.adminLevel} feature is missing parent ADM${info.adminLevel - 1} P-code.`,
			});
		}

		if (info.releaseDate) {
			releaseDates.add(info.releaseDate);
			const parsedDate = Date.parse(info.releaseDate);
			if (Number.isFinite(parsedDate) && Number.isFinite(nowMs)) {
				const ageDays = (nowMs - parsedDate) / 86400000;
				if (ageDays > maxAgeDays) {
					staleFeatureCount += 1;
				}
			}
		}
		if (info.source) sources.add(info.source);
	}

	if (staleFeatureCount > 0) {
		warnings.push({
			code: "STALE_COD_BOUNDARIES",
			message: `${staleFeatureCount} feature(s) have release dates older than ${maxAgeDays} days.`,
		});
	}
	if (sources.size === 0 && !options.boundarySource) {
		warnings.push({
			code: "MISSING_BOUNDARY_SOURCE",
			message: "No COD-AB boundary source attribution found in feature properties or options.boundarySource.",
		});
	}

	// Optional reconciliation against UNDRR DELTA administrative divisions
	let deltaReconciliation = null;
	if (Array.isArray(options.deltaDivisions)) {
		const deltaCodes = new Set();
		for (const div of options.deltaDivisions) {
			const code = typeof div === "string" ? div.trim() : String(div.pcode || div.code || div.nationalId || div.id || "").trim();
			if (code) deltaCodes.add(code);
		}
		const codCodes = new Set(seenPcodes.keys());
		const matched = [...codCodes].filter((c) => deltaCodes.has(c)).sort();
		const unmatchedInCod = [...codCodes].filter((c) => !deltaCodes.has(c)).sort();
		const unmatchedInDelta = [...deltaCodes].filter((c) => !codCodes.has(c)).sort();

		if (unmatchedInCod.length > 0 || unmatchedInDelta.length > 0) {
			warnings.push({
				code: "DELTA_DIVISION_RECONCILIATION_GAP",
				message: `COD-AB vs DELTA reconciliation: ${matched.length} matched, ${unmatchedInCod.length} only in COD-AB, ${unmatchedInDelta.length} only in DELTA.`,
			});
		}

		deltaReconciliation = {
			matchedCount: matched.length,
			matchedPcodes: matched,
			unmatchedInCod,
			unmatchedInDelta,
			reconciled: unmatchedInCod.length === 0 && unmatchedInDelta.length === 0,
		};
	}

	const valid = errors.length === 0;
	const snapshotHash = computeSnapshotHash({
		featureCount: featureRows.length,
		pcodes: Array.from(seenPcodes.keys()).sort(),
		valid,
	});

	return {
		valid,
		method: method
			? { id: method.id, version: method.version, productionStatus: method.productionStatus }
			: { id: COD_VALIDATION_METHOD_ID, version: "1.0", productionStatus: "registered_empirical_screening" },
		summary: {
			featureCount: featureRows.length,
			uniquePcodeCount: seenPcodes.size,
			duplicatePcodeCount: duplicatePcodes.length,
			missingPcodeCount,
			hierarchyMismatchCount,
			staleFeatureCount,
			iso3Countries: Array.from(iso3Set).sort(),
			adminLevels: Array.from(adminLevels).sort((a, b) => a - b),
			releaseDates: Array.from(releaseDates).sort(),
			boundarySources: options.boundarySource ? [options.boundarySource, ...Array.from(sources)] : Array.from(sources),
			geometryValid: geometryReport ? geometryReport.valid : null,
		},
		deltaReconciliation,
		errors,
		warnings,
		provenance: {
			checkedAt: new Date().toISOString(),
			snapshotHash,
		},
	};
}

module.exports = {
	HDX_HAPI_METHOD_ID,
	COD_VALIDATION_METHOD_ID,
	DEFAULT_HAPI_BASE_URL,
	SUPPORTED_HAPI_RESOURCES,
	buildHdxHapiUrl,
	evaluateHdxLicense,
	parseHdxHapiPayload,
	ingestHdxHapiData,
	extractCodProperties,
	validateCodBoundaries,
};
