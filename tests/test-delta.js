const assert = require("assert");
const { pushDraftDisasterRecord, fetchExposureFromDelta } = require("../lib/delta");

console.log("Testing DELTA Resilience Two-Way Connector...");

// 1. Push Draft Disaster Record (Mock mode)
const sampleAssessment = {
	name: "Earthquake Impact Assessment",
	hazardAssessment: {
		hazardType: "earthquake",
		hazardIntensity: 0.42,
		intensityUnit: "Peak Ground Acceleration (g)",
	},
	sendaiFrameworkMetrics: {
		targetB_AffectedPeople: {
			totalExposedPopulation: 11495,
			estimatedDisplacedPopulation: 9585,
		},
		targetC_DirectEconomicLoss: {
			totalExposedAssetValueUsd: 111500000,
			estimatedDirectEconomicLossUsd: 49428050,
			aggregateLossRatioPercentage: 44.33,
		},
		targetD_CriticalInfrastructure: {
			totalDamagedFacilities: 3,
		},
	},
	topDamagedAssets: [
		{ name: "Central Hospital", category: "healthcare", meanDamageRatio: 0.52, estimatedEconomicLossUsd: 33000000 },
	],
};

async function test() {
	const pushResult = await pushDraftDisasterRecord(sampleAssessment, { mock: true });
	assert.strictEqual(pushResult.success, true);
	assert.strictEqual(pushResult.record.status, "draft");
	assert.strictEqual(pushResult.record.source, "drr-agent-plugin");
	assert.strictEqual(pushResult.record.sendaiMetrics.estimatedDisplaced, 9585);
	assert.strictEqual(pushResult.record.sendaiMetrics.estimatedDirectLossUsd, 49428050);
	assert.strictEqual(pushResult.record.sendaiMetrics.damagedCriticalFacilities, 3);
	assert(pushResult.record.notes.includes("drr-agent-plugin"));

	// 2. Fetch Exposure / Divisions (Mock mode)
	const exposureResult = await fetchExposureFromDelta("division", {}, { mock: true });
	assert.strictEqual(exposureResult.items.length, 2);
	assert.strictEqual(exposureResult.items[0].id, "div_1");

	console.log("✅ DELTA two-way integration tests passed!");
}

test().catch((err) => {
	console.error(err);
	process.exit(1);
});
