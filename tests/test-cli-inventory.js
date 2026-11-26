const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { TOOLS } = require("../bin/mcp-server");
const { generateInventoryMarkdown, generateSkillsManifest, extractCliCommands } = require("../scripts/generate-inventory");

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
assert(helpOut.includes("osm-infra"), "CLI --help must list osm-infra");
assert(helpOut.includes("hdx-hapi"), "CLI --help must list hdx-hapi");
assert(helpOut.includes("hdx-search"), "CLI --help must list hdx-search");
assert(helpOut.includes("cod-validate"), "CLI --help must list cod-validate");
assert(helpOut.includes("hdx-polygon-pop"), "CLI --help must list hdx-polygon-pop");
assert(helpOut.includes("severity-assess"), "CLI --help must list severity-assess");
assert(helpOut.includes("sitrep-reconcile"), "CLI --help must list sitrep-reconcile");
assert(helpOut.includes("benchmark"), "CLI --help must list benchmark");

const cliCmds = extractCliCommands();
assert.strictEqual(TOOLS.length, 43, "MCP server must expose 43 tools");
assert.strictEqual(cliCmds.length, 43, "CLI must register 43 subcommands");

const invMd = generateInventoryMarkdown();
for (const tool of TOOLS) {
	assert(invMd.includes(`\`${tool.name}\``), `Inventory markdown missing MCP tool ${tool.name}`);
}
for (const cmd of cliCmds) {
	assert(invMd.includes(`\`drr-tool ${cmd}\``), `Inventory markdown missing CLI command ${cmd}`);
}

const manifest = generateSkillsManifest();
assert.strictEqual(manifest.valid, true, `Skills manifest invalid: ${manifest.validationErrors.join("; ")}`);
assert.strictEqual(manifest.skillCount, 19, "Skills manifest must index 19 skills");
assert.strictEqual(manifest.registeredToolCount, 43);
const manifestOnDisk = JSON.parse(fs.readFileSync(path.join(ROOT, "skills-manifest.json"), "utf8"));
assert.strictEqual(manifestOnDisk.skillCount, manifest.skillCount, "skills-manifest.json on disk must stay synced");
assert.strictEqual(manifestOnDisk.valid, true);

// Prevent documentation count drift between code and primary docs
const readmeText = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const skillsGuideText = fs.readFileSync(path.join(ROOT, "docs", "skills-guide.md"), "utf8");
const apiRefText = fs.readFileSync(path.join(ROOT, "docs", "api-reference.md"), "utf8");
assert(readmeText.includes(`${TOOLS.length} MCP tools`), `README.md must reference ${TOOLS.length} MCP tools`);
assert(skillsGuideText.includes(`${TOOLS.length}`), `docs/skills-guide.md must reference ${TOOLS.length} tools`);
assert(apiRefText.includes(`${TOOLS.length} Tools`), `docs/api-reference.md must reference ${TOOLS.length} Tools`);

// 2. CLI computational & validation commands
const fragOut = JSON.parse(runCli(["fragility", "--hazard", "earthquake", "--intensity", "0.35", "--taxonomy", "URM"]));
assert(fragOut.meanDamageRatio > 0);
assert.strictEqual(fragOut.method.productionStatus, "illustrative_baseline");

// Silent intensity default removed -> must exit non-zero
runCli(["fragility", "--hazard", "earthquake"], true);

const regOut = JSON.parse(runCli(["registry"]));
assert(Array.isArray(regOut.methods) && regOut.methods.length >= 11);

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

const shakeOut = JSON.parse(
	runCli([
		"fdsn-shakemap",
		"--file",
		"examples/fdsn-shakemap-seismic/sample-shakemap-bundle.json",
	]),
);
assert.strictEqual(shakeOut.replacesWald99Gmice, true);
assert.strictEqual(shakeOut.summary.peakObservedPgaG, 0.528);

const infraOut = JSON.parse(
	runCli([
		"infra-overlay",
		"--file",
		"examples/critical-infra-overlay/sample-sendai-infra.json",
		"--hazard",
		"examples/thailand-flood-scenario/input-hazard.json",
	]),
);
assert.strictEqual(infraOut.summary.totalFacilities, 10);
assert.strictEqual(infraOut.summary.cascadingServiceRiskCount, 2);

const osmOut = JSON.parse(
	runCli(["osm-infra", "--file", "examples/critical-infra-overlay/sample-osm-overpass.json"]),
);
assert.strictEqual(osmOut.interimFallback, true);
assert.strictEqual(osmOut.summary.totalFacilities, 5);

const hapiOut = JSON.parse(
	runCli(["hdx-hapi", "--file", "examples/hdx-hapi-cod/sample-hapi-population.json", "--iso3", "THA"]),
);
assert.strictEqual(hapiOut.summary.recordCount, 2);
assert.strictEqual(hapiOut.summary.totalIndicatorValue, 282000);

const codOut = JSON.parse(
	runCli(["cod-validate", "--file", "examples/hdx-hapi-cod/sample-cod-ab.geojson", "--iso3", "THA", "--admin-level", "2"]),
);
assert.strictEqual(codOut.valid, true);
assert.strictEqual(codOut.summary.uniquePcodeCount, 2);

const polyPopOut = JSON.parse(
	runCli([
		"hdx-polygon-pop",
		"--cod",
		"examples/hdx-hapi-cod/sample-cod-ab.geojson",
		"--hapi-file",
		"examples/hdx-hapi-cod/sample-hapi-population.json",
		"--epicenter",
		"100.45,7.0",
		"--buffer-km",
		"15",
		"--iso3",
		"THA",
	]),
);
assert(polyPopOut.summary.overlappingAdminUnits >= 1);
assert(polyPopOut.summary.totalAreaWeightedExposedPopulation > 0);

const ckanOut = JSON.parse(
	runCli([
		"hdx-search",
		"--file",
		"examples/hdx-hapi-cod/sample-ckan-search.json",
		"--iso3",
		"THA",
		"--query",
		"population",
	]),
);
assert.strictEqual(ckanOut.summary.returnedDatasets, 3);
assert.strictEqual(ckanOut.provenance.requiresApiKey, false);

const sevOut = JSON.parse(
	runCli([
		"severity-assess",
		"--pcode",
		"TH9001",
		"--hazard",
		"flood",
		"--hazard-intensity",
		"7.5",
		"--affected-pop",
		"42000",
		"--total-pop",
		"160000",
		"--vulnerability",
		"6.2",
		"--coping-deficit",
		"5.8",
	]),
);
assert.strictEqual(sevOut.dataConfidence, "high");
assert(sevOut.severityPhase >= 3);

const benchOut = JSON.parse(runCli(["benchmark"]));
assert.strictEqual(benchOut.allPassed, true);
assert(benchOut.totalScenarios >= 6);

console.log("✅ CLI subcommands & programmatic inventory tests passed!");
