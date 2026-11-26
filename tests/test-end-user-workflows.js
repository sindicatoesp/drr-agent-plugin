const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");
const {
	WORKFLOW_CATALOG,
	classifyToolActionTier,
	buildOperationalContext,
	planGoalWorkflow,
} = require("../lib/workflows");

const ROOT = path.join(__dirname, "..");

console.log("Testing End-User Goal-Oriented Workflows, MCP Prompts/Resources & Action Tiers...");

// 1. Action-tier classification
assert.strictEqual(classifyToolActionTier("drr_cap_publish"), "consequential");
assert.strictEqual(classifyToolActionTier("drr_delta_push_draft_record"), "consequential");
assert.strictEqual(classifyToolActionTier("drr_cap_alert_generate_validate"), "reversible");
assert.strictEqual(classifyToolActionTier("drr_adam_fetch"), "read_only");
assert.strictEqual(classifyToolActionTier("drr_workflow_plan"), "read_only");
assert.strictEqual(WORKFLOW_CATALOG.length, 5);

// 2. Goal-to-DAG planning with known location (no redundant clarification)
const floodPlan = planGoalWorkflow({
	goal: "Assess flood risk to critical infrastructure in Hat Yai using latest rainfall and hydrological info",
	context: { country: "Thailand", municipality: "Hat Yai", coordinates: [100.47, 7.0] },
	availableInputs: { latitude: 7.0, longitude: 100.47 },
});
assert.strictEqual(floodPlan.workflowId, "flood_infra_risk_assessment");
assert.strictEqual(floodPlan.clarificationNeeded, false);
assert.strictEqual(floodPlan.humanApprovalRequired, true);
assert(floodPlan.steps.some((s) => s.tool === "drr_openmeteo_forecast" && s.status === "ready"));
assert(floodPlan.steps.some((s) => s.tool === "drr_adam_fetch" && s.actionTier === "read_only"));

// 3. Ambiguous / missing location triggers targeted clarification (and uses known country context)
const ambiguousPlan = planGoalWorkflow({
	goal: "Assess flood risk to critical infrastructure",
	context: { country: "Thailand" },
});
assert.strictEqual(ambiguousPlan.clarificationNeeded, true);
assert.strictEqual(ambiguousPlan.clarificationQuestions.length, 1);
assert(ambiguousPlan.clarificationQuestions[0].question.includes("Thailand"));
assert(ambiguousPlan.steps.some((s) => s.status === "needs_input"));

// 4. Context staleness detection (never silently treats outdated context as current)
const nowMs = Date.parse("2026-11-26T12:00:00Z");
const staleCtx = buildOperationalContext({
	contextTimestamp: "2026-11-24T00:00:00Z",
	stalenessThresholdHours: 24,
	nowMs,
});
assert.strictEqual(staleCtx.stalenessWarning, true);
assert(staleCtx.ageHours > 24);
assert.strictEqual(staleCtx.role, "ANALYST");
assert.strictEqual(staleCtx.canExecuteConsequential, false);

// 5. Live MCP stdio test for prompts/list, prompts/get, resources/list, resources/read, and drr_workflow_plan
async function runMcpIntegration() {
	const child = spawn(process.execPath, [path.join(ROOT, "bin", "mcp-server.js")], {
		stdio: ["pipe", "pipe", "inherit"],
	});

	let buf = "";
	const responses = [];
	child.stdout.on("data", (c) => {
		buf += c.toString();
		const lines = buf.split("\n");
		buf = lines.pop();
		for (const l of lines) {
			if (l.trim()) {
				try {
					responses.push(JSON.parse(l));
				} catch (_) {}
			}
		}
	});

	const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
	const wait = (id) =>
		new Promise((resolve, reject) => {
			const start = Date.now();
			const check = () => {
				const found = responses.find((r) => r.id === id);
				if (found) return resolve(found);
				if (Date.now() - start > 5000) return reject(new Error(`Timeout waiting for id ${id}`));
				setTimeout(check, 15);
			};
			check();
		});

	try {
		send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
		const init = await wait(1);
		assert(init.result.capabilities.prompts);
		assert(init.result.capabilities.resources);

		send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
		const tools = await wait(2);
		const publishTool = tools.result.tools.find((t) => t.name === "drr_cap_publish");
		assert.strictEqual(publishTool.annotations.actionTier, "consequential");
		assert.strictEqual(publishTool.annotations.destructiveHint, true);

		send({ jsonrpc: "2.0", id: 3, method: "prompts/list", params: {} });
		const prompts = await wait(3);
		assert.strictEqual(prompts.result.prompts.length, 5);

		send({
			jsonrpc: "2.0",
			id: 4,
			method: "prompts/get",
			params: { name: "flood_infra_risk_assessment", arguments: { location: "Hat Yai" } },
		});
		const promptGet = await wait(4);
		assert(promptGet.result.messages[0].content.text.includes("Hat Yai"));

		send({ jsonrpc: "2.0", id: 5, method: "resources/list", params: {} });
		const resList = await wait(5);
		assert.strictEqual(resList.result.resources.length, 3);

		send({
			jsonrpc: "2.0",
			id: 6,
			method: "resources/read",
			params: { uri: "drr://context/operational" },
		});
		const resRead = await wait(6);
		const ctxParsed = JSON.parse(resRead.result.contents[0].text);
		assert.strictEqual(ctxParsed.role, "ANALYST");

		send({
			jsonrpc: "2.0",
			id: 7,
			method: "tools/call",
			params: {
				name: "drr_workflow_plan",
				arguments: { goal: "Reconcile conflicting agency SitRep numbers" },
			},
		});
		const wfCall = await wait(7);
		const wfBody = JSON.parse(wfCall.result.content[0].text);
		assert.strictEqual(wfBody.workflowId, "multi_source_sitrep_reconcile");
		assert.strictEqual(wfBody.clarificationNeeded, true);
	} finally {
		child.kill();
	}

	console.log("✅ End-User Goal-Oriented Workflows & MCP Prompts/Resources tests passed!");
}

runMcpIntegration().catch((err) => {
	console.error(err);
	process.exit(1);
});
