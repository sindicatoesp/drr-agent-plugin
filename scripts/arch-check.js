#!/usr/bin/env node
/**
 * Zero-Dependency Architectural Governance & Boundary Checker
 *
 * Enforces:
 * 1. Dependency direction: lib/*.js must not require bin/, scripts/, or tests/.
 * 2. MCP <-> CLI parity: TOOLS count === CLI subcommand count, and every tool has a switch case.
 * 3. Inventory freshness: skills-manifest.json and docs/tool-inventory.md match generated output.
 * 4. Tool schema quality: every MCP tool has a non-empty description and object inputSchema.
 */

const fs = require("fs");
const path = require("path");
const { TOOLS } = require("../bin/mcp-server");
const {
	generateInventoryMarkdown,
	generateSkillsManifest,
	extractCliCommands,
} = require("./generate-inventory");

const ROOT = path.join(__dirname, "..");
const errors = [];

function fail(msg) {
	errors.push(msg);
	console.error(`  ✗ ${msg}`);
}

function pass(msg) {
	console.log(`  ✓ ${msg}`);
}

console.log("====================================================");
console.log(" 🏛️  DRR AGENT PLUGIN: ARCHITECTURAL GOVERNANCE CHECK");
console.log("====================================================");

// 1. Dependency direction: lib/ must not import bin/, scripts/, or tests/
const libDir = path.join(ROOT, "lib");
const libFiles = fs.readdirSync(libDir).filter((f) => f.endsWith(".js"));
let boundaryViolations = 0;
for (const file of libFiles) {
	const content = fs.readFileSync(path.join(libDir, file), "utf8");
	const forbiddenRe = /require\s*\(\s*["']\.\.\/(?:bin|scripts|tests)\//g;
	if (forbiddenRe.test(content)) {
		boundaryViolations++;
		fail(`Boundary violation in lib/${file}: must not require bin/, scripts/, or tests/`);
	}
}
if (boundaryViolations === 0) {
	pass(`Dependency direction clean across ${libFiles.length} lib/ modules`);
}

// 2. MCP <-> CLI parity & switch handler completeness
const cliCmds = extractCliCommands();
if (TOOLS.length !== cliCmds.length) {
	fail(`MCP/CLI count mismatch: ${TOOLS.length} MCP tools vs ${cliCmds.length} CLI subcommands`);
} else {
	pass(`MCP/CLI 1:1 parity verified (${TOOLS.length} tools === ${cliCmds.length} CLI commands)`);
}

const mcpServerSrc = fs.readFileSync(path.join(ROOT, "bin", "mcp-server.js"), "utf8");
let missingHandlers = 0;
let schemaIssues = 0;
for (const tool of TOOLS) {
	if (!mcpServerSrc.includes(`case "${tool.name}":`)) {
		missingHandlers++;
		fail(`Missing handleToolCall case for MCP tool "${tool.name}"`);
	}
	if (!tool.description || typeof tool.description !== "string" || tool.description.trim().length < 10) {
		schemaIssues++;
		fail(`MCP tool "${tool.name}" has missing or too-short description`);
	}
	if (!tool.inputSchema || tool.inputSchema.type !== "object") {
		schemaIssues++;
		fail(`MCP tool "${tool.name}" must define an object inputSchema`);
	}
}
if (missingHandlers === 0) pass(`All ${TOOLS.length} MCP tools have matching switch handlers`);
if (schemaIssues === 0) pass(`All ${TOOLS.length} MCP tools have valid descriptions and object schemas`);

// 3. Inventory & skills-manifest freshness
const expectedInv = generateInventoryMarkdown();
const actualInv = fs.existsSync(path.join(ROOT, "docs", "tool-inventory.md"))
	? fs.readFileSync(path.join(ROOT, "docs", "tool-inventory.md"), "utf8")
	: "";
if (expectedInv !== actualInv) {
	fail("docs/tool-inventory.md is stale; run `npm run generate:inventory`");
} else {
	pass("docs/tool-inventory.md is synchronized with executable sources");
}

const expectedManifest = generateSkillsManifest();
if (!expectedManifest.valid) {
	fail(`skills-manifest validation failed: ${expectedManifest.validationErrors.join("; ")}`);
} else {
	const actualManifest = fs.existsSync(path.join(ROOT, "skills-manifest.json"))
		? JSON.parse(fs.readFileSync(path.join(ROOT, "skills-manifest.json"), "utf8"))
		: null;
	if (!actualManifest || actualManifest.registeredToolCount !== expectedManifest.registeredToolCount || actualManifest.skillCount !== expectedManifest.skillCount) {
		fail("skills-manifest.json is stale; run `npm run generate:inventory`");
	} else {
		pass(`skills-manifest.json is valid and synchronized (${expectedManifest.skillCount} skills, ${expectedManifest.registeredToolCount} tools)`);
	}
}

// 4. AGENTS.md presence check
if (!fs.existsSync(path.join(ROOT, "AGENTS.md"))) {
	fail("AGENTS.md is missing from repository root");
} else {
	pass("AGENTS.md engineering instructions present");
}

console.log("====================================================");
if (errors.length > 0) {
	console.error(`❌ ARCH CHECK FAILED (${errors.length} error(s))`);
	process.exit(1);
}
console.log(" 🎉 ARCH CHECK PASSED: 0 architectural violations!");
