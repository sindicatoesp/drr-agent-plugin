const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");

console.log("Testing Engineering Harness & End-User Agentic Interface Hardening...");

// 1. Engineering Harness: AGENTS.md, ADRs, and arch-check.js
assert(fs.existsSync(path.join(ROOT, "AGENTS.md")), "AGENTS.md must exist");
assert(fs.existsSync(path.join(ROOT, ".github", "copilot-instructions.md")), ".github/copilot-instructions.md must exist");
assert(fs.existsSync(path.join(ROOT, "docs", "adr", "0001-zero-dependency-stdlib-and-mcp-parity.md")), "ADR 0001 must exist");
assert(fs.existsSync(path.join(ROOT, "docs", "adr", "0002-fail-closed-governance-and-dual-layer-eval.md")), "ADR 0002 must exist");

const archOut = execFileSync(process.execPath, [path.join(ROOT, "scripts", "arch-check.js")], {
	cwd: ROOT,
	encoding: "utf8",
});
assert(archOut.includes("ARCH CHECK PASSED"), "arch-check.js must pass with 0 violations");

// 2. End-User Agentic Interface: MCP isError: true recovery, schema pre-validation, compact mode, fail-closed CAP
async function runMcpHardeningChecks() {
	const serverPath = path.join(ROOT, "bin", "mcp-server.js");
	const child = spawn(process.execPath, [serverPath], {
		env: { ...process.env, DRR_OFFLINE_MODE: "true" },
		stdio: ["pipe", "pipe", "inherit"],
	});

	let buffer = "";
	const responses = [];
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop();
		for (const line of lines) {
			if (line.trim()) {
				try {
					responses.push(JSON.parse(line));
				} catch (_) {}
			}
		}
	});

	const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
	const waitFor = (id, timeoutMs = 5000) =>
		new Promise((resolve, reject) => {
			const start = Date.now();
			const tick = () => {
				const found = responses.find((r) => r.id === id);
				if (found) return resolve(found);
				if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for id ${id}`));
				setTimeout(tick, 15);
			};
			tick();
		});

	try {
		// A. Schema pre-validation: invalid enum returns isError: true with remediation
		send({
			jsonrpc: "2.0",
			id: 101,
			method: "tools/call",
			params: {
				name: "drr_adam_fetch",
				arguments: { collection: "nonexistent_collection" },
			},
		});
		const enumErr = await waitFor(101);
		assert(enumErr.result && enumErr.result.isError === true, "Invalid enum must return MCP isError: true");
		const enumPayload = JSON.parse(enumErr.result.content[0].text);
		assert.strictEqual(enumPayload.errorCode, "INVALID_ENUM_ARGUMENT");
		assert.strictEqual(enumPayload.retryable, true);
		assert(enumPayload.remediation.includes("eq"));

		// B. Offline mode block returns structured OFFLINE_MODE_BLOCKED remediation
		send({
			jsonrpc: "2.0",
			id: 102,
			method: "tools/call",
			params: {
				name: "drr_adam_fetch",
				arguments: { collection: "eq" },
			},
		});
		const offlineErr = await waitFor(102);
		assert(offlineErr.result && offlineErr.result.isError === true);
		const offlinePayload = JSON.parse(offlineErr.result.content[0].text);
		assert.strictEqual(offlinePayload.errorCode, "OFFLINE_MODE_BLOCKED");
		assert(offlinePayload.remediation.includes("samplePayload"));

		// C. Compact mode strips rawProperties from drr_adam_fetch
		const sampleEq = JSON.parse(
			fs.readFileSync(path.join(ROOT, "examples", "wfp-adam-ogc", "sample-adam-eq.json"), "utf8"),
		);
		send({
			jsonrpc: "2.0",
			id: 103,
			method: "tools/call",
			params: {
				name: "drr_adam_fetch",
				arguments: { collection: "eq", compact: true, samplePayload: sampleEq },
			},
		});
		const compactRes = await waitFor(103);
		assert(compactRes.result && !compactRes.result.isError);
		const compactBody = JSON.parse(compactRes.result.content[0].text);
		assert.strictEqual(compactBody.features.length, 2);
		assert.strictEqual(compactBody.features[0].rawProperties, undefined, "compact: true must omit rawProperties");

		// D. Unknown tool still returns JSON-RPC -32602 protocol error
		send({
			jsonrpc: "2.0",
			id: 104,
			method: "tools/call",
			params: { name: "drr_does_not_exist", arguments: {} },
		});
		const unknownRes = await waitFor(104);
		assert(unknownRes.error && unknownRes.error.code === -32602);
	} finally {
		child.kill();
	}

	console.log("✅ Engineering Harness & End-User Agentic Interface Hardening tests passed!");
}

runMcpHardeningChecks().catch((err) => {
	console.error(err);
	process.exit(1);
});
