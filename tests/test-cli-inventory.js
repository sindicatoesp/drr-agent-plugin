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
assert.strictEqual(TOOLS.length, 31, "MCP server must expose 31 tools");
assert.strictEqual(cliCmds.length, 31, "CLI must register 31 subcommands");

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
assert(Array.isArray(regOut.methods) && regOut.methods.length >= 9);

const replayOut = JSON.parse(runCli(["replay-validate", "--suite", "all"]));
assert.strictEqual(replayOut.valid, true);

const crosswalkOut = JSON.parse(runCli(["hazard-crosswalk", "--query", "EQ", "--source", "GDACS"]));
assert.strictEqual(crosswalkOut.status, "resolved_exact");
assert.strictEqual(crosswalkOut.mapping.code, "GH0001");

const capOut = runCli(["cap-generate", "--headline", "CLI Test Alert"]);
assert(capOut.includes("<status>Draft</status>"), "CLI cap-generate must default to Draft status");

const stOut = JSON.parse(
	runCli([
		"sensorthings",
		"--file",
		"examples/ogc-sensorthings-gauges/sample-datastreams.json",
		"--warning",
		"2.0",
		"--critical",
		"2.5",
		"--unit",
		"m",
	]),
);
assert.strictEqual(stOut.summary.datastreamCount, 3);
assert.strictEqual(stOut.summary.criticalCount, 1);

const stacOut = JSON.parse(
	runCli([
		"stac-hazard",
		"--file",
		"examples/stac-flood-depth/sample-stac-items.json",
	]),
);
assert.strictEqual(stacOut.summary.itemCount, 3);
assert.strictEqual(stacOut.summary.validatedDepthGridCount, 1);

console.log("✅ CLI subcommands & programmatic inventory tests passed!");
