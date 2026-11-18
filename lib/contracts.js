/**
 * Input Contracts, Unit Conversions, Missing-Data Semantics, Provenance Manifest,
 * and Common Assessment Result Contract (Schema v1.0)
 *
 * Implements R-02, R-03, C-03, and Section 9 of the DRR Assessment Baseline.
 * Pure Node.js standard library only.
 */

const crypto = require("crypto");
const { version: PLUGIN_VERSION } = require("../package.json");

const CONTRACT_SCHEMA_VERSION = "1.0";

const EVIDENCE_BASIS_VALUES = ["modelled", "observed", "field_reported", "hybrid"];
const VERIFICATION_STATUS_VALUES = ["unreviewed", "peer_reviewed", "field_verified"];
const APPROVAL_STATUS_VALUES = ["draft", "pending_review", "approved", "rejected"];
const REPORTING_ELIGIBILITY_VALUES = ["pending", "eligible", "ineligible"];

const SECRET_FIELD_PATTERN = /^(?:apikey|api_key|token|access_token|secret|password|x-auth|authorization|key|credential|private_key)$/i;
const PII_FIELD_PATTERN = /^(?:email|phone|mobile|ssn|national_id|passport|address|full_name|contact_email)$/i;

const INTENSITY_UNIT_SPECS = {
	earthquake: {
		canonicalUnit: "g",
		conversions: {
			g: (v) => ({ value: v, factor: 1, converted: false }),
			"m/s2": (v) => ({ value: v / 9.80665, factor: 1 / 9.80665, converted: true }),
			"m/s^2": (v) => ({ value: v / 9.80665, factor: 1 / 9.80665, converted: true }),
			"cm/s2": (v) => ({ value: v / 980.665, factor: 1 / 980.665, converted: true }),
			"cm/s^2": (v) => ({ value: v / 980.665, factor: 1 / 980.665, converted: true }),
			gal: (v) => ({ value: v / 980.665, factor: 1 / 980.665, converted: true }),
			"%g": (v) => ({ value: v / 100, factor: 0.01, converted: true }),
		},
		validRange: { min: 0, max: 5.0 },
	},
	flood: {
		canonicalUnit: "m",
		conversions: {
			m: (v) => ({ value: v, factor: 1, converted: false }),
			meters: (v) => ({ value: v, factor: 1, converted: false }),
			cm: (v) => ({ value: v / 100, factor: 0.01, converted: true }),
			ft: (v) => ({ value: v * 0.3048, factor: 0.3048, converted: true }),
		},
		validRange: { min: 0, max: 30.0 },
	},
	wind: {
		canonicalUnit: "km/h",
		conversions: {
			"km/h": (v) => ({ value: v, factor: 1, converted: false }),
			kmh: (v) => ({ value: v, factor: 1, converted: false }),
			"m/s": (v) => ({ value: v * 3.6, factor: 3.6, converted: true }),
			kt: (v) => ({ value: v * 1.852, factor: 1.852, converted: true }),
			knots: (v) => ({ value: v * 1.852, factor: 1.852, converted: true }),
			mph: (v) => ({ value: v * 1.609344, factor: 1.609344, converted: true }),
		},
		validRange: { min: 0, max: 450.0 },
	},
};

/**
 * Normalize unit string for matching
 */
function normalizeUnitString(unit) {
	if (unit == null) return null;
	return String(unit).trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Convert and validate hazard intensity and unit
 * Rejects unit mismatches (e.g. rainfall mm passed as flood depth m) and invalid numbers.
 */
function normalizeHazardIntensity(hazardType, rawIntensity, rawUnit = null) {
	const type = hazardType ? String(hazardType).toLowerCase().trim() : null;
	const canonicalType = type === "cyclone" ? "wind" : type;

	if (!canonicalType || !INTENSITY_UNIT_SPECS[canonicalType]) {
		return {
			valid: false,
			error: {
				code: "UNSUPPORTED_HAZARD_TYPE",
				field: "hazardType",
				message: `Unsupported or missing hazardType '${hazardType}'. Supported: earthquake, flood, wind.`,
			},
		};
	}

	if (rawIntensity === undefined || rawIntensity === null || rawIntensity === "") {
		return {
			valid: false,
			error: {
				code: "MISSING_REQUIRED_INPUT",
				field: "intensity",
				message: `Missing required hazard intensity for '${canonicalType}'. Assessment cannot use silent defaults.`,
			},
		};
	}

	const numericIntensity = typeof rawIntensity === "number" ? rawIntensity : Number(rawIntensity);
	if (!Number.isFinite(numericIntensity)) {
		return {
			valid: false,
			error: {
				code: "INVALID_INTENSITY",
				field: "intensity",
				message: `Hazard intensity must be a finite number, received '${rawIntensity}'.`,
			},
		};
	}

	const spec = INTENSITY_UNIT_SPECS[canonicalType];
	if (numericIntensity < spec.validRange.min) {
		return {
			valid: false,
			error: {
				code: "OUT_OF_RANGE_INPUT",
				field: "intensity",
				message: `Hazard intensity ${numericIntensity} cannot be below ${spec.validRange.min} ${spec.canonicalUnit}.`,
			},
		};
	}

	const normUnit = normalizeUnitString(rawUnit);
	let convertedValue = numericIntensity;
	let conversionInfo = null;

	if (normUnit) {
		const converter = spec.conversions[normUnit];
		if (!converter) {
			return {
				valid: false,
				error: {
					code: "UNIT_MISMATCH",
					field: "intensityUnit",
					message: `Unit '${rawUnit}' is incompatible with '${canonicalType}' (expected ${spec.canonicalUnit} or compatible unit: ${Object.keys(spec.conversions).join(", ")}).`,
				},
			};
		}
		const res = converter(numericIntensity);
		convertedValue = res.value;
		if (res.converted) {
			conversionInfo = {
				fromValue: numericIntensity,
				fromUnit: rawUnit,
				toValue: parseFloat(convertedValue.toFixed(6)),
				toUnit: spec.canonicalUnit,
				factor: res.factor,
			};
		}
	}

	const warnings = [];
	if (!normUnit) {
		warnings.push({
			code: "IMPLICIT_UNIT_ASSUMED",
			field: "intensityUnit",
			message: `No explicit intensityUnit supplied; assuming canonical unit '${spec.canonicalUnit}'. Supply intensityUnit explicitly for full provenance.`,
		});
	}

	if (convertedValue > spec.validRange.max) {
		return {
			valid: false,
			error: {
				code: "OUT_OF_RANGE_INPUT",
				field: "intensity",
				message: `Converted intensity ${convertedValue} ${spec.canonicalUnit} exceeds physical upper bound (${spec.validRange.max} ${spec.canonicalUnit}).`,
			},
		};
	}

	return {
		valid: true,
		hazardType: canonicalType,
		intensity: parseFloat(convertedValue.toFixed(6)),
		unit: spec.canonicalUnit,
		conversion: conversionInfo,
		warnings,
	};
}

/**
 * Validate [lon, lat] coordinate pair and detect likely [lat, lon] swaps
 */
function validateCoordinatePair(coord, fieldName = "coordinates") {
	if (!Array.isArray(coord) || coord.length < 2) {
		return {
			valid: false,
			error: {
				code: "INVALID_COORDINATES",
				field: fieldName,
				message: `Coordinate at '${fieldName}' must be [longitude, latitude].`,
			},
		};
	}
	const [lon, lat] = coord;
	if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
		return {
			valid: false,
			error: {
				code: "INVALID_COORDINATES",
				field: fieldName,
				message: `Coordinate values at '${fieldName}' must be finite numbers.`,
			},
		};
	}
	if (lat < -90 || lat > 90) {
		const swapHint = Math.abs(lon) <= 90 && Math.abs(lat) <= 180
			? " Possible [lat, lon] coordinate order swap detected (GeoJSON requires [lon, lat])."
			: "";
		return {
			valid: false,
			error: {
				code: "INVALID_COORDINATE_ORDER",
				field: fieldName,
				message: `Latitude ${lat} out of range [-90, 90] at '${fieldName}'.${swapHint}`,
			},
		};
	}
	if (lon < -180 || lon > 180) {
		return {
			valid: false,
			error: {
				code: "INVALID_COORDINATES",
				field: fieldName,
				message: `Longitude ${lon} out of range [-180, 180] at '${fieldName}'.`,
			},
		};
	}
	return { valid: true };
}

/**
 * Validate a temporal interval (ISO-8601 dates, start <= end)
 */
function validateTemporalInterval(startDate, endDate = null) {
	const errors = [];
	if (!startDate) {
		return { valid: true, errors };
	}
	const startMs = Date.parse(startDate);
	if (Number.isNaN(startMs)) {
		errors.push({
			code: "INVALID_TEMPORAL_INPUT",
			field: "startDate",
			message: `Invalid startDate timestamp '${startDate}'. Expected ISO-8601 format.`,
		});
	}
	if (endDate !== null && endDate !== undefined) {
		const endMs = Date.parse(endDate);
		if (Number.isNaN(endMs)) {
			errors.push({
				code: "INVALID_TEMPORAL_INPUT",
				field: "endDate",
				message: `Invalid endDate timestamp '${endDate}'. Expected ISO-8601 format.`,
			});
		} else if (!Number.isNaN(startMs) && endMs < startMs) {
			errors.push({
				code: "INVALID_TEMPORAL_INTERVAL",
				field: "endDate",
				message: `endDate '${endDate}' precedes startDate '${startDate}'.`,
			});
		}
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Validate input contract across hazard, intensity/units, coordinates, temporal interval,
 * valuation currency/year, asset classes, and missing population/asset values.
 * Never converts unknown/missing values to zero.
 */
function validateInputContract(input = {}, options = {}) {
	const errors = [];
	const warnings = [];
	const assumptions = [];

	const strictMissingData = options.strictMissingData === true;

	// 1. Hazard & Intensity & Units
	let normalizedIntensity = null;
	if (input.hazardType !== undefined || input.intensity !== undefined) {
		const intCheck = normalizeHazardIntensity(
			input.hazardType,
			input.intensity,
			input.intensityUnit || input.unit || null,
		);
		if (!intCheck.valid) {
			errors.push(intCheck.error);
		} else {
			normalizedIntensity = intCheck;
			if (intCheck.warnings.length > 0) warnings.push(...intCheck.warnings);
			if (intCheck.conversion) {
				assumptions.push(
					`Converted intensity from ${intCheck.conversion.fromValue} ${intCheck.conversion.fromUnit} to ${intCheck.conversion.toValue} ${intCheck.conversion.toUnit}.`,
				);
			}
		}
	} else if (options.requireHazardIntensity !== false && input.requireHazardIntensity) {
		errors.push({
			code: "MISSING_REQUIRED_INPUT",
			field: "hazardIntensity",
			message: "Assessment cannot be completed without a valid hazardType and intensity input.",
		});
	}

	// 2. Coordinates
	if (input.coordinates !== undefined && input.coordinates !== null) {
		const coordRes = validateCoordinatePair(input.coordinates, "coordinates");
		if (!coordRes.valid) errors.push(coordRes.error);
	}
	if (input.epicenter !== undefined && input.epicenter !== null) {
		const epRes = validateCoordinatePair(input.epicenter, "epicenter");
		if (!epRes.valid) errors.push(epRes.error);
	}

	// 3. Temporal interval
	const tempCheck = validateTemporalInterval(input.startDate, input.endDate);
	if (!tempCheck.valid) errors.push(...tempCheck.errors);

	// 4. Currency & Valuation Year
	if (input.currency !== undefined && input.currency !== null) {
		if (!/^[A-Z]{3}$/.test(String(input.currency))) {
			errors.push({
				code: "INVALID_CURRENCY",
				field: "currency",
				message: `Currency '${input.currency}' must be an ISO-4217 3-letter code (e.g. USD, EUR, THB).`,
			});
		}
	}
	if (input.valuationYear !== undefined && input.valuationYear !== null) {
		const yr = Number(input.valuationYear);
		if (!Number.isInteger(yr) || yr < 1900 || yr > 2100) {
			errors.push({
				code: "INVALID_VALUATION_YEAR",
				field: "valuationYear",
				message: `valuationYear '${input.valuationYear}' must be an integer year between 1900 and 2100.`,
			});
		}
	}

	// 5. Exposed Assets / Missing-Data Semantics (Unknown !== Zero)
	const missingSummary = {
		totalAssets: 0,
		unknownPopulationAssets: 0,
		unknownValueAssets: 0,
		unknownTaxonomyAssets: 0,
		invalidCoordinateAssets: 0,
	};

	const assets = Array.isArray(input.assets)
		? input.assets
		: Array.isArray(input.exposureGeoJSON?.features)
			? input.exposureGeoJSON.features
			: null;

	if (assets) {
		missingSummary.totalAssets = assets.length;
		if (assets.length === 0 && strictMissingData) {
			errors.push({
				code: "MISSING_REQUIRED_INPUT",
				field: "assets",
				message: "Asset inventory is empty; cannot estimate exposure or losses.",
			});
		}

		for (let i = 0; i < assets.length; i++) {
			const asset = assets[i] || {};
			const props = asset.properties || asset;
			const rawPop = props.population !== undefined ? props.population : props.capacity;
			const rawVal = props.valueUsd !== undefined ? props.valueUsd : props.replacementValue;

			if (rawPop === undefined || rawPop === null || rawPop === "") {
				missingSummary.unknownPopulationAssets++;
			} else if (!Number.isFinite(Number(rawPop)) || Number(rawPop) < 0) {
				errors.push({
					code: "INVALID_ASSET_POPULATION",
					field: `assets[${i}].population`,
					message: `Asset '${props.name || i}' has invalid population value '${rawPop}'.`,
				});
			}

			if (rawVal === undefined || rawVal === null || rawVal === "") {
				missingSummary.unknownValueAssets++;
			} else if (!Number.isFinite(Number(rawVal)) || Number(rawVal) < 0) {
				errors.push({
					code: "INVALID_ASSET_VALUE",
					field: `assets[${i}].valueUsd`,
					message: `Asset '${props.name || i}' has invalid asset value '${rawVal}'.`,
				});
			}

			if (!props.taxonomy && !props.buildingType && !props.occupancy) {
				missingSummary.unknownTaxonomyAssets++;
			}

			const pt = asset.geometry?.type === "Point"
				? asset.geometry.coordinates
				: asset.coordinates;
			if (pt) {
				const cRes = validateCoordinatePair(pt, `assets[${i}].coordinates`);
				if (!cRes.valid) {
					missingSummary.invalidCoordinateAssets++;
					errors.push(cRes.error);
				}
			}
		}

		if (missingSummary.unknownPopulationAssets > 0) {
			const msg = `${missingSummary.unknownPopulationAssets} of ${missingSummary.totalAssets} asset(s) have unknown population/capacity (preserved as unknown, not zero).`;
			if (strictMissingData && missingSummary.unknownPopulationAssets === missingSummary.totalAssets) {
				errors.push({ code: "MISSING_REQUIRED_INPUT", field: "assets.population", message: msg });
			} else {
				warnings.push({ code: "PARTIAL_MISSING_POPULATION", field: "assets.population", message: msg });
			}
		}

		if (missingSummary.unknownValueAssets > 0) {
			const msg = `${missingSummary.unknownValueAssets} of ${missingSummary.totalAssets} asset(s) have unknown replacement value (preserved as unknown, not zero).`;
			if (strictMissingData && missingSummary.unknownValueAssets === missingSummary.totalAssets) {
				errors.push({ code: "MISSING_REQUIRED_INPUT", field: "assets.valueUsd", message: msg });
			} else {
				warnings.push({ code: "PARTIAL_MISSING_ASSET_VALUE", field: "assets.valueUsd", message: msg });
			}
		}

		if (missingSummary.unknownTaxonomyAssets > 0) {
			warnings.push({
				code: "MISSING_ASSET_TAXONOMY",
				field: "assets.taxonomy",
				message: `${missingSummary.unknownTaxonomyAssets} asset(s) lack explicit structural taxonomy or occupancy; fallback requires explicit default policy.`,
			});
		}
	}

	const status = errors.length > 0
		? (errors.some((e) => e.code === "MISSING_REQUIRED_INPUT") ? "incomplete" : "failed")
		: "valid";

	return {
		valid: errors.length === 0,
		status,
		normalized: normalizedIntensity
			? {
					hazardType: normalizedIntensity.hazardType,
					intensity: normalizedIntensity.intensity,
					intensityUnit: normalizedIntensity.unit,
					conversion: normalizedIntensity.conversion,
				}
			: null,
		missingDataSummary: missingSummary,
		assumptions,
		warnings,
		errors,
	};
}

/**
 * Strip secret and PII fields recursively before hashing or persisting provenance snapshots
 */
function sanitizeForProvenanceHash(value) {
	if (value === null || value === undefined) return value;
	if (Array.isArray(value)) return value.map((item) => sanitizeForProvenanceHash(item));
	if (typeof value === "object") {
		const sorted = {};
		const keys = Object.keys(value).sort();
		for (const k of keys) {
			if (SECRET_FIELD_PATTERN.test(k) || PII_FIELD_PATTERN.test(k)) {
				continue;
			}
			sorted[k] = sanitizeForProvenanceHash(value[k]);
		}
		return sorted;
	}
	if (typeof value === "string") {
		// Redact URL query secrets if present
		return value.replace(
			/([?&](?:apikey|api_key|token|access_token|secret|password|key)=)[^&\s]+/gi,
			"$1[REDACTED]",
		);
	}
	return value;
}

/**
 * Compute deterministic SHA-256 hash of canonical JSON without leaking credentials/PII
 */
function computeSnapshotHash(payload) {
	const sanitized = sanitizeForProvenanceHash(payload);
	const serialized = JSON.stringify(sanitized === undefined ? null : sanitized);
	return crypto.createHash("sha256").update(serialized).digest("hex");
}

/**
 * Build a Provenance & Independent Governance Manifest (R-03, C-03)
 */
function createProvenanceManifest(params = {}) {
	const evidenceBasis = EVIDENCE_BASIS_VALUES.includes(params.evidenceBasis)
		? params.evidenceBasis
		: "modelled";
	const verificationStatus = VERIFICATION_STATUS_VALUES.includes(params.verificationStatus)
		? params.verificationStatus
		: "unreviewed";
	// Approval status cannot be self-asserted as "approved" without a verified policy approval reference
	const hasVerifiedApprovalRef = Boolean(
		params.approvalReference &&
		params.approvalReference.verified === true &&
		params.approvalReference.actorId &&
		params.approvalReference.policyVersion,
	);
	let approvalStatus = "draft";
	if (params.approvalStatus === "pending_review") {
		approvalStatus = "pending_review";
	} else if (params.approvalStatus === "rejected") {
		approvalStatus = "rejected";
	} else if (params.approvalStatus === "approved" && hasVerifiedApprovalRef) {
		approvalStatus = "approved";
	}

	// C-03: Model output alone is never automatically eligible for official reporting
	let reportingEligibility = "pending";
	if (params.reportingEligibility === "ineligible" || approvalStatus === "rejected") {
		reportingEligibility = "ineligible";
	} else if (
		approvalStatus === "approved" &&
		verificationStatus !== "unreviewed" &&
		params.methodologyEligible === true
	) {
		reportingEligibility = "eligible";
	}

	const snapshotInput = params.inputsSnapshot !== undefined ? params.inputsSnapshot : params.inputs || {};
	const snapshotHash = computeSnapshotHash(snapshotInput);

	return {
		schemaVersion: CONTRACT_SCHEMA_VERSION,
		manifestId: params.manifestId || `prov_${snapshotHash.slice(0, 12)}`,
		generatedAt: params.generatedAt || new Date().toISOString(),
		inputs: {
			sourceIds: Array.isArray(params.sourceIds) ? params.sourceIds : [],
			sourceIssuedAt: params.sourceIssuedAt || null,
			retrievedAt: params.retrievedAt || null,
			snapshotHash: `sha256:${snapshotHash}`,
		},
		method: {
			id: params.method?.id || "unregistered-method",
			version: params.method?.version || "unknown",
			parameterSetId: params.method?.parameterSetId || null,
			references: Array.isArray(params.method?.references) ? params.method.references : [],
		},
		runtime: {
			pluginVersion: PLUGIN_VERSION,
			nodeVersion: process.version,
			seed: params.seed !== undefined ? params.seed : null,
		},
		spatialContext: {
			crs: params.spatialContext?.crs || "EPSG:4326",
			boundaryDataset: params.spatialContext?.boundaryDataset || null,
			boundaryVersion: params.spatialContext?.boundaryVersion || null,
		},
		governance: {
			evidenceBasis,
			verificationStatus,
			approvalStatus,
			reportingEligibility,
			approvalReference: hasVerifiedApprovalRef ? params.approvalReference : null,
		},
		assumptions: Array.isArray(params.assumptions) ? params.assumptions : [],
		limitations: Array.isArray(params.limitations) ? params.limitations : [],
	};
}

/**
 * Update governance verification/approval state WITHOUT mutating evidenceBasis (C-03)
 */
function transitionGovernanceState(manifest, transition = {}) {
	if (!manifest || !manifest.governance) {
		throw new Error("Invalid provenance manifest: missing governance state");
	}
	const updated = JSON.parse(JSON.stringify(manifest));
	// Evidence basis is immutable through approval transitions
	if (transition.verificationStatus && VERIFICATION_STATUS_VALUES.includes(transition.verificationStatus)) {
		updated.governance.verificationStatus = transition.verificationStatus;
	}
	if (transition.approvalStatus === "approved") {
		const ref = transition.approvalReference;
		if (!ref || ref.verified !== true || !ref.actorId || !ref.payloadHash || !ref.policyVersion) {
			throw new Error(
				"Security policy violation: approvalStatus cannot transition to 'approved' without a verified approvalReference bound to actorId, payloadHash, and policyVersion.",
			);
		}
		if (updated.inputs?.snapshotHash && ref.snapshotHash && ref.snapshotHash !== updated.inputs.snapshotHash) {
			throw new Error("Approval snapshotHash mismatch: cannot approve modified inputs.");
		}
		updated.governance.approvalStatus = "approved";
		updated.governance.approvalReference = ref;
	} else if (transition.approvalStatus && APPROVAL_STATUS_VALUES.includes(transition.approvalStatus)) {
		updated.governance.approvalStatus = transition.approvalStatus;
	}

	// Recompute reporting eligibility deterministically
	if (updated.governance.approvalStatus === "rejected" || transition.methodologyEligible === false) {
		updated.governance.reportingEligibility = "ineligible";
	} else if (
		updated.governance.approvalStatus === "approved" &&
		updated.governance.verificationStatus !== "unreviewed" &&
		transition.methodologyEligible === true
	) {
		updated.governance.reportingEligibility = "eligible";
	} else {
		updated.governance.reportingEligibility = "pending";
	}

	return updated;
}

/**
 * Build Section 9 Common Result Contract Envelope
 */
function createAssessmentEnvelope(params = {}) {
	const manifest = params.provenance || createProvenanceManifest(params);
	return {
		schemaVersion: CONTRACT_SCHEMA_VERSION,
		assessmentId: params.assessmentId || `assess_${manifest.inputs.snapshotHash.slice(7, 19)}`,
		status: params.status || (params.errors && params.errors.length > 0 ? "incomplete" : "complete"),
		result: params.result !== undefined ? params.result : null,
		method: manifest.method,
		inputs: manifest.inputs,
		spatialContext: manifest.spatialContext,
		evidenceBasis: manifest.governance.evidenceBasis,
		verificationStatus: manifest.governance.verificationStatus,
		approvalStatus: manifest.governance.approvalStatus,
		reportingEligibility: manifest.governance.reportingEligibility,
		uncertainty: params.uncertainty || {
			status: "not_quantified",
			type: null,
			interval: null,
			method: null,
		},
		assumptions: params.assumptions || manifest.assumptions || [],
		limitations: params.limitations || manifest.limitations || [],
		warnings: params.warnings || [],
		errors: params.errors || [],
	};
}

module.exports = {
	CONTRACT_SCHEMA_VERSION,
	EVIDENCE_BASIS_VALUES,
	VERIFICATION_STATUS_VALUES,
	APPROVAL_STATUS_VALUES,
	REPORTING_ELIGIBILITY_VALUES,
	INTENSITY_UNIT_SPECS,
	normalizeHazardIntensity,
	validateCoordinatePair,
	validateTemporalInterval,
	validateInputContract,
	sanitizeForProvenanceHash,
	computeSnapshotHash,
	createProvenanceManifest,
	transitionGovernanceState,
	createAssessmentEnvelope,
};
