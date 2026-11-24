const assert = require("assert");
const { runDualLayerEvaluation, evaluateAgentClaimGrounding } = require("../lib/benchmarks");

(async () => {
	console.log("Testing Dual-Layer Deterministic vs. Agent Evaluation Harness...");

	// 1. Aligned reference dual-layer run
	const aligned = await runDualLayerEvaluation();
	assert.strictEqual(aligned.mode, "reference_dual_layer");
	assert.strictEqual(aligned.deterministicBaseline.allPassed, true);
	assert.strictEqual(aligned.agentEvaluation.allPassed, true);
	assert.strictEqual(aligned.deterministicBaseline.meanAnalyticsScore, 1);
	assert.strictEqual(aligned.agentEvaluation.meanOrchestrationScore, 1);
	assert.strictEqual(aligned.diagnosticFlags.length, 0);

	// 2. Diagnose "good_math_bad_agent" (correct tool output, hallucinated flood depth in narrative)
	const hallucinatingAgent = await runDualLayerEvaluation({
		scenarioId: "geo-01-flood-fba-non-fabrication",
		agentRunner: async (_scenario, refTraj) => ({
			...refTraj,
			agentResponseText:
				"Based on the rainfall forecast, the expected flood depth is 2.4 meters across the downtown basin.",
		}),
	});
	assert.strictEqual(hallucinatingAgent.mode, "live_agent_dual_layer");
	assert.strictEqual(hallucinatingAgent.deterministicBaseline.meanAnalyticsScore, 1);
	assert(hallucinatingAgent.agentEvaluation.meanOrchestrationScore < 1);
	assert.strictEqual(hallucinatingAgent.agentEvaluation.allPassed, false);
	assert.strictEqual(hallucinatingAgent.diagnosticFlags.length, 1);
	assert.strictEqual(hallucinatingAgent.diagnosticFlags[0].type, "good_math_bad_agent");

	// 3. Diagnose "fluent_agent_bad_math" (compliant narrative & tools, missing provenance/corrupted math)
	const badMathAgent = await runDualLayerEvaluation({
		scenarioId: "geo-01-flood-fba-non-fabrication",
		agentRunner: async (_scenario, refTraj) => ({
			toolsCalled: refTraj.toolsCalled,
			output: {
				...refTraj.output,
				provenance: null, // stripped provenance breaks deterministic analytics layer
			},
			agentResponseText:
				"Rainfall screening completed. Flood depth is unavailable without a calibrated inundation grid.",
		}),
	});
	assert(badMathAgent.deterministicBaseline.meanAnalyticsScore < 1);
	assert.strictEqual(badMathAgent.agentEvaluation.meanOrchestrationScore, 1);
	assert.strictEqual(badMathAgent.diagnosticFlags.length, 1);
	assert.strictEqual(badMathAgent.diagnosticFlags[0].type, "fluent_agent_bad_math");

	// 4. Direct claim-grounding check for CAP draft false-publish & Sendai B-1 conflation
	const capCheck = evaluateAgentClaimGrounding(
		{ assertions: { nonGoalRules: ["block_draft_on_production"] } },
		{ publishGate: { published: false } },
		"The emergency alert was published successfully to production channels.",
	);
	assert.strictEqual(capCheck.passed, false);
	assert.strictEqual(capCheck.score, 0);

	const b1Check = evaluateAgentClaimGrounding(
		{ assertions: { nonGoalRules: ["separate_displacement_from_b1"] } },
		{},
		"Confirmed Sendai B-1 directly affected is 42000 persons.",
	);
	assert.strictEqual(b1Check.passed, false);
	assert.strictEqual(b1Check.score, 0);

	console.log("✅ Dual-Layer Deterministic vs. Agent Evaluation Harness tests passed!");
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
