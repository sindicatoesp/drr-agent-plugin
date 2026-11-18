const assert = require("assert");
const { validateDeltaSchema, pushDraftDisasterRecord } = require("../lib/delta");
const { propagateUncertainty, createSeededRng } = require("../lib/uncertainty");
const { calculateExpectedAnnualLoss, evaluateMitigationCostBenefit } = require("../lib/appraisal");

console.log("Testing DELTA Schema Contract, Uncertainty Propagation & Investment Appraisal (R-13, R-14, R-15)...");

async function run() {
	// --- R-13: DELTA Schema Validation, Governance Metadata & Write Gates ---
	const validAssessment = {
		eventId: "usgs_schema_001",
		name: "Test Seismic Assessment",
		notes: "Schema validation check",
		country: "Indonesia",
		startDate: "2026-11-10",
		hazardAssessment: {
			hazardType: "earthquake",
			hazardIntensity: 0.4,
			intensityUnit: "g",
		},
		sendaiFrameworkMetrics: {
			targetB_AffectedPeople: { totalExposedPopulation: 3200, estimatedDisplacedPopulation: 600 },
			targetC_DirectEconomicLoss: { estimatedDirectEconomicLossUsd: 1200000 },
		},
		topDamagedAssets: [
			{ name: "Regional Hospital", category: "healthcare", estimatedLossUsd: 800000 },
		],
	};

	const schemaRes = validateDeltaSchema(validAssessment);
	assert.strictEqual(schemaRes.valid, true, `Schema errors: ${JSON.stringify(schemaRes.errors)}`);
	assert.strictEqual(schemaRes.wireSafe, true, "Sanitized wire payload must strip forbidden name & notes fields");

	// Detect inverted temporal dates in schema validation
	const badDates = validateDeltaSchema({
		...validAssessment,
		startDate: "2026-11-15",
		endDate: "2026-11-01",
	});
	assert.strictEqual(badDates.valid, false);
	assert(badDates.errors.some((e) => e.code === "INVALID_TEMPORAL_INTERVAL"));

	// Live non-mock production push blocked by default
	const prodBlocked = await pushDraftDisasterRecord(validAssessment, {
		mock: false,
		channelType: "production",
		tenantContext: { actorTenant: "IDN", targetTenant: "IDN" },
	});
	assert.strictEqual(prodBlocked.success, false);
	assert.strictEqual(prodBlocked.blocked, true);

	// Mock push succeeds with C-03 governance metadata
	const mockPush = await pushDraftDisasterRecord(validAssessment, {
		mock: true,
		tenantContext: { actorTenant: "IDN", targetTenant: "IDN" },
	});
	assert.strictEqual(mockPush.success, true);
	assert.strictEqual(mockPush.record.status, "draft");
	assert.strictEqual(mockPush.record.source, "drr-agent-plugin");

	// --- R-14 & C-08: Deterministic Bounds, OAT Ranking & Seeded Monte Carlo ---
	const detUncertainty = propagateUncertainty({
		mode: "deterministic_bounds",
		hazardType: "earthquake",
		intensity: 0.35,
		exposedValueUsd: 10000000,
		taxonomy: "URM",
	});
	assert(detUncertainty.deterministicBounds.lowLossUsd <= detUncertainty.centralEstimate.lossUsd);
	assert(detUncertainty.centralEstimate.lossUsd <= detUncertainty.deterministicBounds.highLossUsd);
	assert.strictEqual(detUncertainty.sensitivityRanking.length, 3);
	assert(detUncertainty.sensitivityRanking[0].swingUsd >= detUncertainty.sensitivityRanking[1].swingUsd);

	// Reject Monte Carlo without distributions unless allowIllustrativeDistributions: true
	assert.throws(
		() => propagateUncertainty({ mode: "monte_carlo", hazardType: "earthquake", intensity: 0.35, exposedValueUsd: 5000000 }),
		/UNSOURCED_DISTRIBUTIONS/,
	);

	// Seeded PRNG reproducibility
	const r1 = createSeededRng(12345);
	const r2 = createSeededRng(12345);
	assert.strictEqual(r1(), r2());

	const mcA = propagateUncertainty({
		mode: "monte_carlo",
		hazardType: "earthquake",
		intensity: 0.35,
		exposedValueUsd: 10000000,
		taxonomy: "URM",
		seed: 99,
		iterations: 600,
		allowIllustrativeDistributions: true,
	});
	const mcB = propagateUncertainty({
		mode: "monte_carlo",
		hazardType: "earthquake",
		intensity: 0.35,
		exposedValueUsd: 10000000,
		taxonomy: "URM",
		seed: 99,
		iterations: 600,
		allowIllustrativeDistributions: true,
	});
	assert.strictEqual(mcA.monteCarlo.meanLossUsd, mcB.monteCarlo.meanLossUsd, "Seeded Monte Carlo must be bitwise reproducible");
	assert(mcA.monteCarlo.percentilesUsd.p5 <= mcA.monteCarlo.percentilesUsd.p50);
	assert(mcA.monteCarlo.percentilesUsd.p50 <= mcA.monteCarlo.percentilesUsd.p95);
	assert.strictEqual(mcA.monteCarlo.convergenceCheck.converged, true);
	assert(mcA.warnings.some((w) => w.code === "INDEPENDENCE_ASSUMED"));

	// --- R-15: Expected Annual Loss (EAL) & Mitigation CBA ---
	// Single-event scenario must NEVER produce EAL
	assert.throws(
		() => calculateExpectedAnnualLoss({ points: [{ returnPeriodYears: 50, loss: 10000000 }], currency: "USD", valuationYear: 2026 }),
		/SINGLE_EVENT_CANNOT_ESTABLISH_EAL/,
	);

	// Non-monotonic losses must throw
	assert.throws(
		() => calculateExpectedAnnualLoss({
			points: [
				{ returnPeriodYears: 10, loss: 5000000 },
				{ returnPeriodYears: 100, loss: 2000000 },
			],
			currency: "USD",
			valuationYear: 2026,
		}),
		/NON_MONOTONIC_LOSS_CURVE/,
	);

	const ealRes = calculateExpectedAnnualLoss({
		points: [
			{ returnPeriodYears: 10, loss: 1000000 },
			{ returnPeriodYears: 50, loss: 5000000 },
			{ returnPeriodYears: 100, loss: 10000000 },
		],
		currency: "USD",
		valuationYear: 2026,
		tailHandling: "flat_extrapolation",
	});
	assert.strictEqual(ealRes.valid, true);
	// Interior: 0.5*(1M+5M)*(0.1-0.02) + 0.5*(5M+10M)*(0.02-0.01) = 3M*0.08 + 7.5M*0.01 = 240k + 75k = 315k
	// Tail: 10M * 0.01 = 100k; Total = 415k
	assert.strictEqual(ealRes.interiorCurveEal, 315000);
	assert.strictEqual(ealRes.tailContributionEal, 100000);
	assert.strictEqual(ealRes.expectedAnnualLoss, 415000);

	const cbaRes = evaluateMitigationCostBenefit({
		optionName: "Urban Retention Basin & Embankment",
		baselineEal: 415000,
		mitigatedEal: 115000,
		capex: 2500000,
		annualOpex: 20000,
		annualCoBenefits: 15000,
		discountRate: 0.05,
		horizonYears: 20,
		currency: "USD",
		valuationYear: 2026,
	});
	assert.strictEqual(cbaRes.valid, true);
	assert.strictEqual(cbaRes.quantitativeMetrics.residualRiskEal, 115000);
	assert.strictEqual(cbaRes.quantitativeMetrics.annualAvoidedLoss, 300000);
	assert(cbaRes.quantitativeMetrics.netPresentValue > 0);
	assert(cbaRes.quantitativeMetrics.benefitCostRatio > 1);
	assert(cbaRes.sensitivityMatrix.lowerDiscountRate.npv > cbaRes.sensitivityMatrix.higherDiscountRate.npv);
	assert(cbaRes.policyJudgements.equityAndDistributionalConsiderations);
	assert(cbaRes.policyJudgements.residualRiskManagement);

	console.log("✅ DELTA schema, uncertainty propagation & investment appraisal tests passed!");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
