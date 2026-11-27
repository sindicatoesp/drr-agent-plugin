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
	drr_stac_hazard_fetch: "tests/test-stac.js, tests/test-mcp-server.js",
	drr_fdsn_shakemap_fetch: "tests/test-shakemap.js, tests/test-mcp-server.js",
	drr_critical_infra_overlay: "tests/test-infra-overlay.js, tests/test-mcp-server.js",
	drr_osm_critical_infra_fetch: "tests/test-osm-infra.js, tests/test-mcp-server.js",
	drr_hdx_hapi_fetch: "tests/test-hdx-cod.js, tests/test-mcp-server.js",
	drr_hdx_catalog_search: "tests/test-hdx-cod.js, tests/test-mcp-server.js",
	drr_cod_boundary_validate: "tests/test-hdx-cod.js, tests/test-mcp-server.js",
	drr_hdx_polygon_population_estimate: "tests/test-hdx-cod.js, tests/test-mcp-server.js",
	drr_humanitarian_severity_assess: "tests/test-severity.js, tests/test-mcp-server.js",
	drr_benchmark_run: "tests/test-benchmarks.js, tests/test-agent-eval-harness.js, tests/test-mcp-server.js",
	drr_sitrep_reconcile: "tests/test-reconcile.js, tests/test-mcp-server.js",
	drr_gemini_analyze: "tests/test-gemini.js, tests/test-mcp-server.js",
};

const WRITE_GATED_TOOLS = new Set(["drr_cap_publish", "drr_delta_push_draft_record"]);
const NETWORK_READ_TOOLS = new Set([
	"drr_gdacs_fetch",
	"drr_usgs_earthquake_fetch",
	"drr_openmeteo_forecast",
	"drr_monitor_check",
	"drr_delta_fetch_exposure",
	"drr_delta_docs",
	"drr_sensorthings_fetch",
	"drr_stac_hazard_fetch",
	"drr_fdsn_shakemap_fetch",
	"drr_critical_infra_overlay",
	"drr_osm_critical_infra_fetch",
	"drr_hdx_hapi_fetch",
	"drr_hdx_catalog_search",
	"drr_hdx_polygon_population_estimate",
	"drr_gemini_analyze",
]);

function parseSkillMarkdown(relPath, content, registeredToolSet) {
	const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const frontmatter = {};
	if (fmMatch) {
		for (const line of fmMatch[1].split(/\r?\n/)) {
			const idx = line.indexOf(":");
			if (idx > 0) {
				const key = line.slice(0, idx).trim();
				const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
				frontmatter[key] = val;
			}
		}
	}

	const getSection = (heading) => {
		const re = new RegExp(`##\\s+${heading}\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s+|$)`, "i");
		const m = content.match(re);
		return m ? m[1] : "";
	};

	const allowedSection = getSection("Allowed Executable Tools");
	const allowedTools = [];
	const toolMatches = allowedSection.matchAll(/`([a-z0-9_]+)`/g);
	for (const m of toolMatches) {
		if (m[1].startsWith("drr_") && !allowedTools.includes(m[1])) {
			allowedTools.push(m[1]);
		}
	}

	const countBullets = (sec) =>
		sec
			.split(/\r?\n/)
			.filter((l) => /^\s*[-*]\s+/.test(l))
			.length;

	const unknownTools = allowedTools.filter((t) => !registeredToolSet.has(t));
	let safetyTier = "read_only_analytics";
	if (allowedTools.some((t) => WRITE_GATED_TOOLS.has(t))) {
		safetyTier = "governance_write_gated";
	} else if (allowedTools.some((t) => NETWORK_READ_TOOLS.has(t))) {
		safetyTier = "external_network_read";
	}

	return {
		name: frontmatter.name || path.basename(path.dirname(relPath)),
		description: frontmatter.description || "",
		path: relPath,
		safetyTier,
		allowedTools,
		unknownTools,
		hasNonGoals: countBullets(getSection("Non-Goals")) > 0,
		nonGoalCount: countBullets(getSection("Non-Goals")),
		triggerCount: countBullets(getSection("Triggers")),
		escalationCount: countBullets(getSection("Escalation Conditions")),
	};
}

function generateSkillsManifest() {
	const registeredToolSet = new Set(TOOLS.map((t) => t.name));
	const skillDirs = listFilesSorted("skills", (_name, full) => fs.statSync(full).isDirectory());
	const skills = [];
	const validationErrors = [];

	for (const dir of skillDirs) {
		const relPath = `skills/${dir}/SKILL.md`;
		const fullPath = path.join(ROOT, relPath);
		if (!fs.existsSync(fullPath)) {
			validationErrors.push(`Missing SKILL.md in skills/${dir}`);
			continue;
		}
		const content = fs.readFileSync(fullPath, "utf8");
		const parsed = parseSkillMarkdown(relPath, content, registeredToolSet);
		if (!parsed.description) {
			validationErrors.push(`Skill '${parsed.name}' is missing frontmatter description.`);
		}
		if (parsed.unknownTools.length > 0) {
			validationErrors.push(`Skill '${parsed.name}' references unregistered MCP tools: ${parsed.unknownTools.join(", ")}`);
		}
		skills.push({
			name: parsed.name,
			description: parsed.description,
			path: parsed.path,
			safetyTier: parsed.safetyTier,
			allowedTools: parsed.allowedTools,
			nonGoalCount: parsed.nonGoalCount,
			triggerCount: parsed.triggerCount,
			escalationCount: parsed.escalationCount,
		});
	}

	return {
		schemaVersion: "1.0.0",
		pluginName: pluginManifest.name,
		pluginVersion: pkg.version,
		mcpServer: SERVER_NAME,
		mcpProtocolVersion: PROTOCOL_VERSION,
		registeredToolCount: TOOLS.length,
		skillCount: skills.length,
		safetyTiers: {
			read_only_analytics: "Pure local deterministic computation, spatial validation, or benchmark verification.",
			external_network_read: "Reads external hazard/humanitarian APIs with SSRF guards and prompt-injection sanitization.",
			governance_write_gated: "Includes state-mutating or publication tools gated by Draft-default, approval tokens, or explicit production flags.",
		},
		valid: validationErrors.length === 0,
		validationErrors,
		skills,
	};
}

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
	lines.push(`- **Skills Manifest**: \`skills-manifest.json\``);
	lines.push(`- **Test Suites (\`tests/test-*.js\`)**: ${testFiles.length}`);
	lines.push("");
	lines.push("### Documentation Reconciliation Note");
	lines.push(`- **Historical 10-vs-11 discrepancy (\`origin/dev\`)**: \`bin/mcp-server.js\` registered 11 tools (including \`drr_delta_docs\`), whereas \`docs/api-reference.md\` documented 10 tools and omitted \`drr_delta_docs\`. Both \`docs/api-reference.md\` and \`README.md\` are now reconciled with the expanded registration baseline of **${TOOLS.length} MCP tools**.`);
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

	const manifestPath = path.join(ROOT, "skills-manifest.json");
	const manifest = generateSkillsManifest();
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

	console.log(`✅ Generated ${path.relative(ROOT, outPath)} (${TOOLS.length} MCP tools, ${extractCliCommands().length} CLI commands)`);
	console.log(`✅ Generated ${path.relative(ROOT, manifestPath)} (${manifest.skillCount} skills, valid=${manifest.valid})`);
	if (!manifest.valid) {
		console.error(`❌ Skills manifest validation errors:\n- ${manifest.validationErrors.join("\n- ")}`);
		process.exit(1);
	}
}

module.exports = {
	generateInventoryMarkdown,
	generateSkillsManifest,
	extractCliCommands,
	TOOLS,
};
