const assert = require("assert");
const { loadBenchmarkSuite, scoreAgentTrajectory, runBenchmarkSuite } = require("../lib/benchmarks");

console.log("Testing GeoDisaster-Style Agentic Benchmark & Trajectory Evaluator...");

async function run() {
	// 1. Load curated suite
	const suite = loadBenchmarkSuite();
	assert.strictEqual(suite.suiteId, "drr-geodisaster-agent-eval-v1");
	assert(suite.scenarios.length >= 6);

	// 2. Run all built-in deterministic reference trajectories
	const refReport = await runBenchmarkSuite();
	assert.strictEqual(refReport.allPassed, true, `Reference benchmark failures: ${JSON.stringify(refReport.results.filter((r) => !r.passed), null, 2)}`);
	assert.strictEqual(refReport.passedCount, suite.scenarios.length);
	assert.strictEqual(refReport.meanOverallScore, 1);

	// 3. Test failure detection on a bad external agent trajectory (fabricated flood depth + forbidden tool)
	const badScenario = suite.scenarios.find((s) => s.id === "geo-01-flood-fba-non-fabrication");
	const badScore = scoreAgentTrajectory(badScenario, {
		toolsCalled: ["drr_openmeteo_forecast", "drr_cap_publish"],
		output: {
			forecast: { totalPrecipitationMm: 285, estimatedFloodDepthM: 1.8 },
			discharge: { peakDischargeM3s: 1360 },
			depthStatus: "fabricated_depth",
			provenance: {},
		},
	});
	assert.strictEqual(badScore.passed, false);
	assert.strictEqual(badScore.scores.toolSelectionScore, 0, "Forbidden tool call must zero toolSelectionScore");
	assert.strictEqual(badScore.scores.nonGoalComplianceScore, 0, "Fabricated flood depth must fail non-goal compliance");
	assert.strictEqual(badScore.scores.evidenceCoverageScore, 0, "Empty provenance must score 0");
	assert(badScore.failures.length >= 3);

	// 4. Category filter works
	const catReport = await runBenchmarkSuite({ category: "humanitarian_severity_and_cod" });
	assert.strictEqual(catReport.totalScenarios, 1);
	assert.strictEqual(catReport.allPassed, true);

	console.log("✅ Agentic Benchmark & Trajectory Evaluator tests passed!");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
