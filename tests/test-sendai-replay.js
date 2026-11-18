const assert = require("assert");
const { runReplayValidation } = require("../lib/replay");
const { validateSendaiSubmission } = require("../lib/sendai");

console.log("Testing Sendai Semantic Validation & Deterministic Replay Harness (R-05, R-08, C-01..C-03)...");

// --- R-05: Replay Harness Execution ---
const replayAll = runReplayValidation({ suite: "all" });
assert.strictEqual(replayAll.valid, true, `Replay suite failed: ${JSON.stringify(replayAll.cases.filter((c) => !c.passed))}`);
assert(replayAll.totalCases >= 7, "Expected >= 7 replay reference cases");
assert(replayAll.cases.some((c) => c.classification === "synthetic_reference"));
assert(replayAll.cases.some((c) => c.classification === "hindcast_benchmark"));

const synthOnly = runReplayValidation({ suite: "synthetic_reference" });
assert.strictEqual(synthOnly.valid, true);
assert(synthOnly.cases.every((c) => c.classification === "synthetic_reference"));

// --- R-08 & C-01: Sendai Target B (Displacement != B-1, No Overlapping Sums) ---
const dispAsB1 = validateSendaiSubmission({
	reportingPeriod: { startDate: "2026-11-01", endDate: "2026-11-10" },
	nationalMetadata: { countryCode: "THA", focalPointAgency: "DDPM" },
	targetB: {
		estimatedDisplacedPopulation: 1500,
		b1DirectlyAffected: 1500,
		b1DerivedFromDisplacementOnly: true,
	},
});
assert.strictEqual(dispAsB1.valid, false);
assert.strictEqual(dispAsB1.reportingEligibility, "ineligible");
assert.strictEqual(dispAsB1.semanticChecks.displacementSeparatedFromB1, false);

const overlapSum = validateSendaiSubmission({
	targetB: {
		summedSubIndicators: true,
		b2InjuredOrIll: 120,
		b3DamagedDwellingsPeople: 800,
	},
});
assert.strictEqual(overlapSum.valid, false);
assert(overlapSum.errors.some((e) => e.code === "OVERLAPPING_POPULATION_SUM"));

// --- R-08 & C-02: Target D Physical Damage (D-2..D-4) != Service Disruption (D-6..D-8) ---
const conflatedTargetD = validateSendaiSubmission({
	targetD: {
		totalDamagedFacilities: 5,
		conflateDamageAndDisruption: true,
	},
});
assert.strictEqual(conflatedTargetD.valid, false);
assert.strictEqual(conflatedTargetD.semanticChecks.damageSeparatedFromDisruption, false);

// --- R-08: Per-100,000 Denominator & Raw Count Guard ---
const missingDenom = validateSendaiSubmission({
	indicators: [{ code: "B-1", unit: "per 100,000", isNormalizedPer100k: true, value: 450 }],
});
assert.strictEqual(missingDenom.valid, false);
assert(missingDenom.errors.some((e) => e.code === "MISSING_NORMALIZATION_DENOMINATOR"));

const rawAsRate = validateSendaiSubmission({
	indicators: [
		{
			code: "A-2",
			unit: "per 100,000",
			isNormalizedPer100k: true,
			denominator: 65000000,
			numerator: 120,
			rawCount: 120,
			value: 120,
		},
	],
});
assert.strictEqual(rawAsRate.valid, false);
assert(rawAsRate.errors.some((e) => e.code === "RAW_COUNT_LABELLED_PER_100K"));

// --- R-08 & C-03: Modelled Unreviewed Pending vs Validated National Eligibility ---
const unreviewedModelled = validateSendaiSubmission({
	evidenceBasis: "modelled",
	verificationStatus: "unreviewed",
	approvalStatus: "draft",
	reportingPeriod: { startDate: "2026-11-01", endDate: "2026-11-10" },
	nationalMetadata: { countryCode: "THA", focalPointAgency: "DDPM" },
	targetB: { estimatedDisplacedPopulation: 200 },
	targetD: { physicalDamage: { hospitalsDamaged: 1 }, serviceDisruption: { outages: 2 } },
});
assert.strictEqual(unreviewedModelled.valid, true);
assert.strictEqual(unreviewedModelled.reportingEligibility, "pending", "Unreviewed modelled statistics must stay pending");

const eligibleReviewed = validateSendaiSubmission({
	evidenceBasis: "modelled",
	verificationStatus: "peer_reviewed",
	approvalStatus: "approved",
	methodologyValidated: true,
	reportingPeriod: { startDate: "2026-11-01", endDate: "2026-11-10" },
	nationalMetadata: { countryCode: "THA", focalPointAgency: "DDPM" },
	targetB: { b2InjuredOrIll: 40, b3DamagedDwellingsPeople: 400 },
	targetD: { physicalDamage: { d2HealthDamaged: 1 }, serviceDisruption: { d6HealthDisruptedHours: 12 } },
	indicators: [{ code: "B-1", value: 0.67, unit: "per 100,000", denominator: 66000000, normalizedValue: 0.67 }],
});
assert.strictEqual(eligibleReviewed.valid, true);
assert.strictEqual(eligibleReviewed.reportingEligibility, "eligible");
assert.strictEqual(eligibleReviewed.evidenceBasis, "modelled", "C-03: reviewed modelled evidence stays labelled modelled");

console.log("✅ Sendai semantic validation & replay harness tests passed!");
