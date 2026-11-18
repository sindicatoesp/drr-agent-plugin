const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");
const { TOOLS } = require("../bin/mcp-server");
const { generateInventoryMarkdown, extractCliCommands } = require("../scripts/generate-inventory");

console.log("Testing CLI Subcommands & Programmatic Inventory Generator (R-01)...");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "bin", "cli.js");

function runCli(args, expectFailure = false) {
	try {
		const out = execFileSync(process.execPath, [CLI, ...args], {
			cwd: ROOT,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		if (expectFailure) {
			throw new Error(`Expected CLI failure for args: ${args.join(" ")}`);
		}
		return out;
	} catch (err) {
		if (expectFailure) return err;
		throw err;
	}
}

// 1. Help & Inventory synchronization checks
const helpOut = runCli(["--help"]);
assert(helpOut.includes("replay-validate"), "CLI --help must list new commands");
assert(helpOut.includes("sendai-validate"), "CLI --help must list sendai-validate");

const cliCmds = extractCliCommands();
assert.strictEqual(TOOLS.length, 29, "MCP server must expose 29 tools");
assert.strictEqual(cliCmds.length, 29, "CLI must register 29 subcommands");

const invMd = generateInventoryMarkdown();
for (const tool of TOOLS) {
	assert(invMd.includes(`\`${tool.name}\``), `Inventory markdown missing MCP tool ${tool.name}`);
}
for (const cmd of cliCmds) {
	assert(invMd.includes(`\`drr-tool ${cmd}\``), `Inventory markdown missing CLI command ${cmd}`);
}

// 2. CLI computational & validation commands
const fragOut = JSON.parse(runCli(["fragility", "--hazard", "earthquake", "--intensity", "0.35", "--taxonomy", "URM"]));
assert(fragOut.meanDamageRatio > 0);
assert.strictEqual(fragOut.method.productionStatus, "illustrative_baseline");

// Silent intensity default removed -> must exit non-zero
runCli(["fragility", "--hazard", "earthquake"], true);

const regOut = JSON.parse(runCli(["registry"]));
assert(Array.isArray(regOut.methods) && regOut.methods.length >= 7);

const replayOut = JSON.parse(runCli(["replay-validate", "--suite", "all"]));
assert.strictEqual(replayOut.valid, true);

const crosswalkOut = JSON.parse(runCli(["hazard-crosswalk", "--query", "EQ", "--source", "GDACS"]));
assert.strictEqual(crosswalkOut.status, "resolved_exact");
assert.strictEqual(crosswalkOut.mapping.code, "GH0001");

const capOut = runCli(["cap-generate", "--headline", "CLI Test Alert"]);
assert(capOut.includes("<status>Draft</status>"), "CLI cap-generate must default to Draft status");

console.log("✅ CLI subcommands & programmatic inventory tests passed!");
