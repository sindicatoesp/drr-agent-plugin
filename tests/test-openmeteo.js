const assert = require("assert");
const { analyzeFloodRisk, checkForecastPersistence } = require("../lib/openmeteo");

console.log("Testing Open-Meteo Weather Forecast & Anticipatory Rainfall Screening...");

// 1. Extreme rainfall screening scenario (> 200mm cumulative precip) WITHOUT validated flood depth
const extremePayload = {
	daily: {
		time: ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"],
		precipitation_sum: [45.2, 115.0, 78.5, 30.1, 12.0],
		wind_speed_10m_max: [45.0, 68.0, 55.0, 32.0, 20.0],
	},
	forecastMetadata: {
		issueTime: "2026-08-09T12:00:00Z",
		modelRun: "ecmwf_ifs_12z",
		ensembleMembers: 51,
	},
};

const extremeResult = analyzeFloodRisk(extremePayload);
assert.strictEqual(extremeResult.assessmentKind, "meteorological_rainfall_screening");
assert.strictEqual(extremeResult.anticipatoryAction.alertColor, "Red");
assert.strictEqual(extremeResult.anticipatoryAction.triggerThresholdMet, true);
assert.strictEqual(extremeResult.anticipatoryAction.triggerActivated, false, "Should NOT activate trigger without approved triggerPolicy");
assert.strictEqual(extremeResult.anticipatoryAction.triggerStatus, "screening_only_requires_local_policy");
assert(extremeResult.totalForecastPrecipitationMm > 250);
// C-05: Must NOT fabricate inundation depth from rainfall alone
assert.strictEqual(extremeResult.anticipatoryAction.depthStatus, "depth_unavailable");
assert.strictEqual(extremeResult.anticipatoryAction.estimatedInundationDepthMeters, null);
assert.strictEqual(extremeResult.peakPrecipitationDate, "2026-08-11");
assert.strictEqual(extremeResult.forecastMetadata.leadTimeHours, 12);

// 2. Approved local triggerPolicy + persistence across distinct runs -> triggerActivated: true
const approvedWithPersistence = analyzeFloodRisk(extremePayload, {
	triggerPolicy: {
		policyId: "fbf-bangladesh-jamuna-2026",
		approved: true,
		requirePersistence: true,
		requiredConsecutiveRuns: 2,
		redTotalPrecipMm: 200,
	},
	previousRuns: [
		{ issueTime: "2026-08-09T00:00:00Z", modelRun: "ecmwf_ifs_00z", exceedance: true },
	],
});
assert.strictEqual(approvedWithPersistence.anticipatoryAction.triggerActivated, true);
assert.strictEqual(approvedWithPersistence.anticipatoryAction.triggerStatus, "policy_trigger_activated");
assert.strictEqual(approvedWithPersistence.persistenceCheck.persistent, true);
assert.strictEqual(approvedWithPersistence.persistenceCheck.evaluatedRuns, 2);

// Duplicate identical run timestamps must NOT satisfy persistence
const duplicateRunCheck = checkForecastPersistence(
	[
		{ issueTime: "2026-08-09T00:00:00Z", modelRun: "ecmwf_ifs_00z", exceedance: true },
		{ issueTime: "2026-08-09T00:00:00Z", modelRun: "ecmwf_ifs_00z", exceedance: true },
	],
	{ requiredConsecutiveRuns: 2 },
);
assert.strictEqual(duplicateRunCheck.evaluatedRuns, 1);
assert.strictEqual(duplicateRunCheck.persistent, false);

// 3. Low precipitation scenario (< 30mm)
const lowPayload = {
	daily: {
		time: ["2026-08-10", "2026-08-11"],
		precipitation_sum: [5.0, 8.0],
		wind_speed_10m_max: [15.0, 18.0],
	},
};

const lowResult = analyzeFloodRisk(lowPayload);
assert.strictEqual(lowResult.anticipatoryAction.alertColor, "Green");
assert.strictEqual(lowResult.anticipatoryAction.triggerThresholdMet, false);
assert.strictEqual(lowResult.anticipatoryAction.depthStatus, "depth_unavailable");
assert.strictEqual(lowResult.anticipatoryAction.estimatedInundationDepthMeters, null);

console.log("✅ Open-Meteo tests passed!");
