#!/usr/bin/env node
/**
 * Programmatic Tool, CLI, Module, Skill & Test Inventory Generator (R-01)
 * Derives docs/tool-inventory.md directly from executable registration sources.
 * Pure Node.js standard library.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { TOOLS, SERVER_NAME, SERVER_VERSION, PROTOCOL_VERSION } = require("../bin/mcp-server");
const pkg = require("../package.json");
const pluginManifest = require("../plugin.json");
const libIndex = require("../lib/index");

const ROOT = path.join(__dirname, "..");

function safeGit(args) {
	try {
		return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch (_) {
		return "unknown";
	}
}

function extractCliCommands() {
	const cliSource = fs.readFileSync(path.join(ROOT, "bin", "cli.js"), "utf8");
	const matches = [...cliSource.matchAll(/^\s*case\s+"([^"]+)":\s*\{?/gm)];
	return matches.map((m) => m[1]);
}

function listFilesSorted(relDir, filterFn) {
	const dirPath = path.join(ROOT, relDir);
	if (!fs.existsSync(dirPath)) return [];
	return fs
		.readdirSync(dirPath)
		.filter((name) => filterFn(name, path.join(dirPath, name)))
		.sort();
}

const TEST_MAPPING = {
	drr_gdacs_fetch: "tests/test-monitor.js, tests/test-security-cap.js, tests/test-mcp-server.js",
	drr_usgs_earthquake_fetch: "tests/test-usgs.js, tests/test-mcp-server.js",
	drr_openmeteo_forecast: "tests/test-openmeteo.js, tests/test-mcp-server.js",
	drr_spatial_exposure_join: "tests/test-spatial.js, tests/test-spatial-hydro.js",
	drr_fragility_eval: "tests/test-fragility.js, tests/test-contracts-registry.js, tests/test-mcp-server.js",
	drr_vulnerability_matrix_calc: "tests/test-vulnerability.js, tests/test-hindcast-regression.js",
	drr_cap_alert_generate_validate: "tests/test-cap.js, tests/test-security-cap.js, tests/test-mcp-server.js",
	drr_cap_publish: "tests/test-security-cap.js, tests/test-mcp-server.js",
	drr_delta_push_draft_record: "tests/test-delta.js, tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js",
	drr_delta_fetch_exposure: "tests/test-delta.js",
	drr_delta_docs: "tests/test-delta.js, tests/test-mcp-server.js",
	drr_delta_schema_validate: "tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js",
	drr_monitor_check: "tests/test-monitor.js, tests/test-scheduled-monitoring.js, tests/test-mcp-server.js",
	drr_input_contract_validate: "tests/test-contracts-registry.js, tests/test-mcp-server.js",
	drr_source_provenance_manifest: "tests/test-contracts-registry.js, tests/test-mcp-server.js",
	drr_model_registry_list: "tests/test-contracts-registry.js, tests/test-mcp-server.js",
	drr_assessment_replay_validate: "tests/test-sendai-replay.js, tests/test-mcp-server.js",
	drr_sendai_validate: "tests/test-sendai-replay.js, tests/test-mcp-server.js",
	drr_hazard_crosswalk: "tests/test-events-crosswalk.js, tests/test-mcp-server.js",
	drr_event_match_deduplicate: "tests/test-events-crosswalk.js, tests/test-mcp-server.js",
	drr_geojson_validate: "tests/test-spatial-hydro.js, tests/test-mcp-server.js",
	drr_geometry_repair: "tests/test-spatial-hydro.js, tests/test-mcp-server.js",
	drr_crs_transform: "tests/test-spatial-hydro.js, tests/test-mcp-server.js",
	drr_raster_zonal_stats: "tests/test-spatial-hydro.js, tests/test-mcp-server.js",
	drr_basin_rainfall_aggregate: "tests/test-spatial-hydro.js, tests/test-mcp-server.js",
	drr_river_discharge_screen: "tests/test-spatial-hydro.js, tests/test-mcp-server.js",
	drr_uncertainty_propagate: "tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js",
	drr_expected_annual_loss: "tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js",
	drr_mitigation_cost_benefit: "tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js",
	drr_sensorthings_fetch: "tests/test-sensorthings.js, tests/test-mcp-server.js",
};

function generateInventoryMarkdown() {
	const headSha = safeGit(["rev-parse", "HEAD"]);
	const devSha = safeGit(["rev-parse", "origin/dev"]);
	const branch = safeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
	const cliCommands = extractCliCommands();
	const libModules = listFilesSorted("lib", (name) => name.endsWith(".js"));
	const skillDirs = listFilesSorted("skills", (_name, full) => fs.statSync(full).isDirectory());
	const testFiles = listFilesSorted("tests", (name) => name.startsWith("test-") && name.endsWith(".js"));
	const exportedSymbols = Object.keys(libIndex).sort();

	const lines = [];
	lines.push("# DRR Agent Plugin — Authoritative Tool & Capability Inventory");
	lines.push("");
	lines.push("> Generated directly from executable registration sources by `scripts/generate-inventory.js` (R-01).");
	lines.push("");
	lines.push("## Baseline & Manifest Reconciliation");
	lines.push("");
	lines.push(`- **Package**: \`${pkg.name}\` v${pkg.version}`);
	lines.push(`- **Plugin Manifest**: \`${pluginManifest.name}\` v${pluginManifest.version}`);
	lines.push(`- **MCP Server**: \`${SERVER_NAME}\` v${SERVER_VERSION} (protocol \`${PROTOCOL_VERSION}\`)`);
	lines.push(`- **Git Branch**: \`${branch}\``);
	lines.push(`- **Reference Baseline Commit (\`origin/dev\`)**: \`${devSha}\``);
	lines.push(`- **Current HEAD Commit**: \`${headSha}\``);
	lines.push(`- **Registered MCP Tools**: ${TOOLS.length}`);
	lines.push(`- **Registered CLI Subcommands**: ${cliCommands.length}`);
	lines.push(`- **Library Modules (\`lib/*.js\`)**: ${libModules.length}`);
	lines.push(`- **Public Exports (\`lib/index.js\`)**: ${exportedSymbols.length}`);
	lines.push(`- **Skills (\`skills/*/SKILL.md\`)**: ${skillDirs.length}`);
	lines.push(`- **Test Suites (\`tests/test-*.js\`)**: ${testFiles.length}`);
	lines.push("");
	lines.push("### Documentation Reconciliation Note");
	lines.push("- **Historical 10-vs-11 discrepancy (`origin/dev`)**: `bin/mcp-server.js` registered 11 tools (including `drr_delta_docs`), whereas `docs/api-reference.md` documented 10 tools and omitted `drr_delta_docs`. Both `docs/api-reference.md` and `README.md` are now reconciled with the expanded registration baseline of **29 MCP tools**.");
	lines.push("");
	lines.push(`## Registered MCP Tools (${TOOLS.length})`);
	lines.push("");
	lines.push("| # | Tool Name | Required Args | Optional Args | Test Mapping | Description |");
	lines.push("| :---: | :--- | :--- | :--- | :--- | :--- |");

	TOOLS.forEach((tool, idx) => {
		const schema = tool.inputSchema || {};
		const required = Array.isArray(schema.required) ? schema.required : [];
		const allProps = Object.keys(schema.properties || {});
		const optional = allProps.filter((p) => !required.includes(p));
		const reqStr = required.length ? required.map((r) => `\`${r}\``).join(", ") : "—";
		const optStr = optional.length ? optional.map((o) => `\`${o}\``).join(", ") : "—";
		const tests = TEST_MAPPING[tool.name] || "tests/test-mcp-server.js";
		const desc = String(tool.description || "").replace(/\|/g, "\\|");
		lines.push(`| ${idx + 1} | \`${tool.name}\` | ${reqStr} | ${optStr} | \`${tests}\` | ${desc} |`);
	});

	lines.push("");
	lines.push(`## Registered CLI Subcommands (${cliCommands.length})`);
	lines.push("");
	lines.push(cliCommands.map((c) => `- \`drr-tool ${c}\``).join("\n"));
	lines.push("");
	lines.push(`## Library Modules (${libModules.length})`);
	lines.push("");
	lines.push(libModules.map((m) => `- \`lib/${m}\``).join("\n"));
	lines.push("");
	lines.push(`## Knowledge Skills (${skillDirs.length})`);
	lines.push("");
	lines.push(skillDirs.map((s) => `- \`skills/${s}/SKILL.md\``).join("\n"));
	lines.push("");
	lines.push(`## Automated Test Suites (${testFiles.length})`);
	lines.push("");
	lines.push(testFiles.map((t) => `- \`tests/${t}\``).join("\n"));
	lines.push("");
	lines.push(`## Public Exports from \`lib/index.js\` (${exportedSymbols.length})`);
	lines.push("");
	lines.push("`" + exportedSymbols.join("`, `") + "`");
	lines.push("");

	return lines.join("\n");
}

if (require.main === module) {
	const outPath = path.join(ROOT, "docs", "tool-inventory.md");
	const content = generateInventoryMarkdown();
	fs.writeFileSync(outPath, content, "utf8");
	console.log(`✅ Generated ${path.relative(ROOT, outPath)} (${TOOLS.length} MCP tools, ${extractCliCommands().length} CLI commands)`);
}

module.exports = {
	generateInventoryMarkdown,
	extractCliCommands,
	TOOLS,
};
