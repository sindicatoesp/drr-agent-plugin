const assert = require("assert");
const { analyzeFloodRisk } = require("../lib/openmeteo");

console.log("Testing Open-Meteo Weather Forecast & Anticipatory Action Triggers...");

// 1. Extreme flood risk scenario (> 200mm cumulative precip)
const extremePayload = {
	daily: {
		time: ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"],
		precipitation_sum: [45.2, 115.0, 78.5, 30.1, 12.0],
		wind_speed_10m_max: [45.0, 68.0, 55.0, 32.0, 20.0],
	},
};

const extremeResult = analyzeFloodRisk(extremePayload);
assert.strictEqual(extremeResult.anticipatoryAction.alertColor, "Red");
assert.strictEqual(extremeResult.anticipatoryAction.triggerThresholdMet, true);
assert(extremeResult.totalForecastPrecipitationMm > 250);
assert(extremeResult.anticipatoryAction.estimatedInundationDepthMeters >= 1.5);
assert.strictEqual(extremeResult.peakPrecipitationDate, "2026-08-11");

// 2. Low precipitation scenario (< 30mm)
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

console.log("✅ Open-Meteo tests passed!");
