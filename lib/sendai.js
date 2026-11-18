/**
 * UNDRR Sendai Framework Monitor (SFM) Semantic Validator (R-08, C-01, C-02, C-03)
 *
 * Enforces SFM indicator definitions:
 * - Target B: B-1 directly affected people != displacement / simple exposure.
 *   B-2 injured/ill, B-3/B-4 damaged/destroyed dwellings, B-5 disrupted livelihoods.
 *   Prohibits summing overlapping B sub-indicators without deduplication methodology.
 * - Target D: D-2..D-4 physical facility damage/destruction vs. D-6..D-8 service disruption.
 * - Normalization: raw counts cannot be reported as per-100,000 indicators without denominator.
 * - Governance: checks evidenceBasis, verificationStatus, approvalStatus, reportingPeriod, and metadata.
 *
 * Pure Node.js standard library only.
 */

const SENDAI_REFERENCE = {
	id: "undrr-sfm-methodology-2018",
	version: "2018-v1",
	url: "https://www.undrr.org/implementing-sendai-framework/monitoring-sendai-framework/sfm-methodology",
};

const VALID_B_SUBINDICATORS = ["B-1", "B-2", "B-3", "B-4", "B-5"];
const VALID_D_DAMAGE_INDICATORS = ["D-2", "D-3", "D-4"];
const VALID_D_DISRUPTION_INDICATORS = ["D-6", "D-7", "D-8"];

/**
 * Validate a Sendai Framework reporting payload or vulnerability assessment
 * @param {object} payload - Sendai assessment/reporting object
 * @param {object} options - Validation options
 * @returns {object} Detailed Sendai semantic validation report
 */
function validateSendaiSubmission(payload = {}, options = {}) {
	const errors = [];
	const warnings = [];
	const reasons = [];

	const evidenceBasis = payload.evidenceBasis || "modelled";
	const verificationStatus = payload.verificationStatus || "unreviewed";
	const approvalStatus = payload.approvalStatus || "draft";

	// 1. Reporting period & national metadata
	const reportingPeriod = payload.reportingPeriod || null;
	if (!reportingPeriod || !reportingPeriod.startDate || !reportingPeriod.endDate) {
		reasons.push("Missing reportingPeriod (startDate and endDate).");
		warnings.push({
			code: "MISSING_REPORTING_PERIOD",
			field: "reportingPeriod",
			message: "Sendai reporting requires an explicit reportingPeriod (startDate, endDate).",
		});
	} else {
		const s = Date.parse(reportingPeriod.startDate);
		const e = Date.parse(reportingPeriod.endDate);
		if (Number.isNaN(s) || Number.isNaN(e) || e < s) {
			errors.push({
				code: "INVALID_REPORTING_PERIOD",
				field: "reportingPeriod",
				message: "reportingPeriod startDate/endDate are invalid or inverted.",
			});
		}
	}

	const nationalMetadata = payload.nationalMetadata || null;
	if (!nationalMetadata || !nationalMetadata.countryCode || !nationalMetadata.focalPointAgency) {
		reasons.push("Missing nationalMetadata (countryCode, focalPointAgency).");
		warnings.push({
			code: "MISSING_NATIONAL_METADATA",
			field: "nationalMetadata",
			message: "National reporting requires countryCode and focalPointAgency metadata.",
		});
	}

	// 2. Target B semantics (C-01)
	const targetB = payload.targetB || payload.sendaiFrameworkMetrics?.targetB_AffectedPeople || {};
	const displacedCount = targetB.estimatedDisplacedPopulation ?? targetB.displacedPopulation ?? null;
	const b1Claimed = targetB.b1DirectlyAffected ?? targetB.B1 ?? null;

	if (displacedCount !== null && b1Claimed !== null && targetB.b1DerivedFromDisplacementOnly === true) {
		errors.push({
			code: "INVALID_DISPLACEMENT_TO_B1_MAPPING",
			field: "targetB.b1DirectlyAffected",
			message: "Displacement is not a standalone Sendai Target B indicator and cannot be automatically mapped to B-1 without satisfying B-1 evidence definitions.",
		});
		reasons.push("Displacement was mapped directly to B-1 without B-1 sub-indicator evidence.");
	}

	// Check if someone passed raw exposure/displacement claiming it is B-1
	if (
		targetB.claimOfficialB1 === true &&
		!targetB.b2InjuredOrIll &&
		!targetB.b3DamagedDwellingsPeople &&
		!targetB.b4DestroyedDwellingsPeople &&
		!targetB.b5DisruptedLivelihoodsPeople
	) {
		errors.push({
			code: "UNSUPPORTED_B1_CLAIM",
			field: "targetB",
			message: "B-1 (directly affected people) requires evidenced B-2/B-3/B-4/B-5 components or explicit national B-1 survey methodology; exposure or modelled displacement alone is insufficient.",
		});
		reasons.push("B-1 claimed without underlying B-2..B-5 evidence.");
	}

	// Overlapping population summation check (C-01)
	if (
		targetB.summedSubIndicators === true &&
		!targetB.deduplicationMethodology
	) {
		errors.push({
			code: "OVERLAPPING_POPULATION_SUM",
			field: "targetB.deduplicationMethodology",
			message: "Overlapping Target B sub-populations (e.g. injured + damaged dwellings + disrupted livelihoods) cannot be summed into B-1 without a documented deduplicationMethodology.",
		});
		reasons.push("Target B sub-indicators summed without deduplication methodology.");
	}

	// 3. Per-100,000 Normalization check (R-08)
	const indicators = Array.isArray(payload.indicators) ? payload.indicators : [];
	for (let i = 0; i < indicators.length; i++) {
		const ind = indicators[i];
		if (!ind || !ind.code) {
			errors.push({
				code: "INVALID_INDICATOR_ENTRY",
				field: `indicators[${i}]`,
				message: "Indicator entry must specify a valid Sendai indicator code.",
			});
			continue;
		}
		if (ind.isNormalizedPer100k === true || String(ind.unit || "").includes("100,000")) {
			if (!ind.denominator || !Number.isFinite(Number(ind.denominator)) || Number(ind.denominator) <= 0) {
				errors.push({
					code: "MISSING_NORMALIZATION_DENOMINATOR",
					field: `indicators[${i}].denominator`,
					message: `Indicator '${ind.code}' claims per-100,000 normalization without a positive population denominator.`,
				});
				reasons.push(`Indicator ${ind.code} lacks reference population denominator for per-100,000 normalization.`);
			}
			if (ind.numerator !== undefined && ind.rawCount === ind.value && !ind.normalizedValue) {
				errors.push({
					code: "RAW_COUNT_LABELLED_PER_100K",
					field: `indicators[${i}].value`,
					message: `Indicator '${ind.code}' treats a raw count as an already-normalized per-100,000 rate.`,
				});
			}
		}
	}

	// 4. Target D semantics: physical damage vs service disruption (C-02)
	const targetD = payload.targetD || payload.sendaiFrameworkMetrics?.targetD_CriticalInfrastructure || {};
	const physicalDamage = targetD.physicalDamage || null;
	const serviceDisruption = targetD.serviceDisruption || null;

	if (targetD.conflateDamageAndDisruption === true) {
		errors.push({
			code: "CONFLATED_DAMAGE_AND_DISRUPTION",
			field: "targetD",
			message: "Physical facility damage (D-2..D-4) and basic service disruption (D-6..D-8) must be stored and reported separately.",
		});
		reasons.push("Physical facility damage and service disruption were conflated.");
	}

	if (targetD.totalDamagedFacilities !== undefined && !serviceDisruption && !targetD.disruptionStatus) {
		warnings.push({
			code: "SERVICE_DISRUPTION_NOT_ASSESSED",
			field: "targetD.serviceDisruption",
			message: "Physical facility damage count provided without separate service disruption status (D-6..D-8). Undamaged facilities may still be non-operational.",
		});
	}

	// 5. Evidence basis vs verification & approval (C-03)
	if (evidenceBasis === "modelled" && verificationStatus === "unreviewed") {
		reasons.push("Evidence basis is 'modelled' with verificationStatus 'unreviewed'; modelled estimates cannot automatically become official Sendai statistics.");
	}
	if (approvalStatus !== "approved") {
		reasons.push(`Approval status is '${approvalStatus}'; authorized national review/approval is required before official reporting.`);
	}
	if (options.requireCalibratedMethodology && payload.methodologyValidated !== true) {
		reasons.push("Applicable national methodology has not been verified for this modelled indicator set.");
	}

	// Determine reportingEligibility
	let reportingEligibility = "pending";
	if (errors.length > 0 || approvalStatus === "rejected") {
		reportingEligibility = "ineligible";
	} else if (
		approvalStatus === "approved" &&
		verificationStatus !== "unreviewed" &&
		reportingPeriod?.startDate &&
		reportingPeriod?.endDate &&
		nationalMetadata?.countryCode &&
		nationalMetadata?.focalPointAgency &&
		(evidenceBasis !== "modelled" || payload.methodologyValidated === true)
	) {
		reportingEligibility = "eligible";
	} else {
		reportingEligibility = "pending";
	}

	return {
		valid: errors.length === 0,
		reportingEligibility,
		evidenceBasis,
		verificationStatus,
		approvalStatus,
		semanticChecks: {
			displacementSeparatedFromB1: !errors.some((e) =>
				e.code === "INVALID_DISPLACEMENT_TO_B1_MAPPING" || e.code === "UNSUPPORTED_B1_CLAIM",
			),
			damageSeparatedFromDisruption: !errors.some((e) => e.code === "CONFLATED_DAMAGE_AND_DISRUPTION"),
			normalizationVerified: !errors.some(
				(e) => e.code === "MISSING_NORMALIZATION_DENOMINATOR" || e.code === "RAW_COUNT_LABELLED_PER_100K",
			),
			physicalDamageRecorded: Boolean(physicalDamage || targetD.totalDamagedFacilities !== undefined),
			serviceDisruptionRecorded: Boolean(serviceDisruption),
		},
		reference: SENDAI_REFERENCE,
		reasons,
		warnings,
		errors,
	};
}

module.exports = {
	SENDAI_REFERENCE,
	VALID_B_SUBINDICATORS,
	VALID_D_DAMAGE_INDICATORS,
	VALID_D_DISRUPTION_INDICATORS,
	validateSendaiSubmission,
};
