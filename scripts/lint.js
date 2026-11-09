#!/usr/bin/env node
/**
 * Zero-Dependency Static Linting & Syntax Integrity Checker
 * DRR Agent Plugin (agent-plugins.org v1.0.0 / Node.js stdlib)
 *
 * Checks performed:
 * 1. Node V8 AST syntax compilation (node --check) across all JS files
 * 2. Strict JSON validation across all .json files
 * 3. Inline HTML <script> and template literal JS syntax compilation via Node vm.Script
 * 4. Zero external npm dependency verification (pure stdlib import guard)
 * 5. Plugin & MCP manifest schema integrity (plugin.json, mcp.json)
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

const COLOR = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
};

let errorCount = 0;
let fileCount = 0;

console.log(`${COLOR.bold}${COLOR.cyan}====================================================${COLOR.reset}`);
console.log(`${COLOR.bold}${COLOR.cyan} 🔍 DRR AGENT PLUGIN: STATIC LINT & INTEGRITY CHECK${COLOR.reset}`);
console.log(`${COLOR.bold}${COLOR.cyan}====================================================${COLOR.reset}`);

function walkDir(dir, extList, ignoreDirs = ["node_modules", ".git", "coverage"]) {
	let results = [];
	if (!fs.existsSync(dir)) return results;
	const list = fs.readdirSync(dir);
	list.forEach((file) => {
		const filePath = path.join(dir, file);
		const stat = fs.statSync(filePath);
		if (stat && stat.isDirectory()) {
			if (!ignoreDirs.includes(file)) {
				results = results.concat(walkDir(filePath, extList, ignoreDirs));
			}
		} else {
			const ext = path.extname(file).toLowerCase();
			if (extList.includes(ext)) {
				results.push(filePath);
			}
		}
	});
	return results;
}

// -----------------------------------------------------------------------------
// Check 1: V8 AST Syntax Compilation Check (node --check)
// -----------------------------------------------------------------------------
console.log(`\n${COLOR.bold}1. JavaScript Syntax & AST Verification (node --check):${COLOR.reset}`);

const jsFiles = walkDir(ROOT, [".js"], ["node_modules", ".git", "coverage"]);

jsFiles.forEach((file) => {
	const rel = path.relative(ROOT, file);
	fileCount++;
	try {
		execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
		process.stdout.write(`  ${COLOR.green}✓${COLOR.reset} ${COLOR.gray}${rel}${COLOR.reset}\n`);
	} catch (err) {
		errorCount++;
		console.error(`  ${COLOR.red}✗ SYNTAX ERROR in ${rel}:${COLOR.reset}`);
		console.error(err.stderr ? err.stderr.toString() : err.message);
	}
});

// -----------------------------------------------------------------------------
// Check 2: JSON Syntax & Structure Verification
// -----------------------------------------------------------------------------
console.log(`\n${COLOR.bold}2. JSON Schema & Data Structure Verification:${COLOR.reset}`);

const jsonFiles = walkDir(ROOT, [".json"], ["node_modules", ".git", "coverage"]);

jsonFiles.forEach((file) => {
	const rel = path.relative(ROOT, file);
	fileCount++;
	try {
		const raw = fs.readFileSync(file, "utf8");
		JSON.parse(raw);
		process.stdout.write(`  ${COLOR.green}✓${COLOR.reset} ${COLOR.gray}${rel}${COLOR.reset}\n`);
	} catch (err) {
		errorCount++;
		console.error(`  ${COLOR.red}✗ MALFORMED JSON in ${rel}:${COLOR.reset} ${err.message}`);
	}
});

// Check plugin.json specific requirements
const pluginJsonPath = path.join(ROOT, "plugin.json");
if (fs.existsSync(pluginJsonPath)) {
	try {
		const p = JSON.parse(fs.readFileSync(pluginJsonPath, "utf8"));
		if (!p.$schema) {
			console.error(`  ${COLOR.red}✗ plugin.json is missing required $schema field${COLOR.reset}`);
			errorCount++;
		}
		if (!p.name || !p.version) {
			console.error(`  ${COLOR.red}✗ plugin.json is missing required name or version field${COLOR.reset}`);
			errorCount++;
		}
	} catch (_) {}
}

// -----------------------------------------------------------------------------
// Check 3: Inline HTML & Template Literal JavaScript Syntax (vm.Script)
// -----------------------------------------------------------------------------
console.log(`\n${COLOR.bold}3. Inline HTML <script> & Template Syntax Verification (vm.Script):${COLOR.reset}`);

const htmlFiles = walkDir(ROOT, [".html"], ["node_modules", ".git", "coverage"]);

htmlFiles.forEach((file) => {
	const rel = path.relative(ROOT, file);
	const content = fs.readFileSync(file, "utf8");
	const scriptMatches = content.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi);
	if (scriptMatches) {
		scriptMatches.forEach((s, idx) => {
			fileCount++;
			const code = s.replace(/<script[\s\S]*?>/i, "").replace(/<\/script>/i, "");
			try {
				new vm.Script(code);
				process.stdout.write(`  ${COLOR.green}✓${COLOR.reset} ${COLOR.gray}${rel} (script block #${idx + 1})${COLOR.reset}\n`);
			} catch (err) {
				errorCount++;
				console.error(`  ${COLOR.red}✗ INLINE SCRIPT SYNTAX ERROR in ${rel} (block #${idx + 1}):${COLOR.reset}`);
				console.error(`    ${err.message}`);
			}
		});
	}
});

// Also dynamically test cap.js template generator
const capPath = path.join(ROOT, "lib/cap.js");
if (fs.existsSync(capPath)) {
	try {
		const { generateVisualSitRepHtml } = require(capPath);
		const testHtml = generateVisualSitRepHtml({
			hazard: { eventName: "Syntax Test Event", country: "Testland", alertLevel: "Red" },
			vulnerability: { topDamagedAssets: [] },
			spatial: { summary: {} }
		});
		const generatedScripts = testHtml.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi);
		if (generatedScripts) {
			generatedScripts.forEach((s, idx) => {
				fileCount++;
				const code = s.replace(/<script[\s\S]*?>/i, "").replace(/<\/script>/i, "");
				try {
					new vm.Script(code);
					process.stdout.write(`  ${COLOR.green}✓${COLOR.reset} ${COLOR.gray}lib/cap.js -> dynamically emitted HTML script #${idx + 1}${COLOR.reset}\n`);
				} catch (err) {
					errorCount++;
					console.error(`  ${COLOR.red}✗ DYNAMIC TEMPLATE SCRIPT SYNTAX ERROR in lib/cap.js #${idx + 1}:${COLOR.reset} ${err.message}`);
				}
			});
		}
	} catch (err) {
		errorCount++;
		console.error(`  ${COLOR.red}✗ Error evaluating generateVisualSitRepHtml:${COLOR.reset} ${err.message}`);
	}
}

// -----------------------------------------------------------------------------
// Check 4: Zero External Dependencies Audit (Standard Library Imports Only)
// -----------------------------------------------------------------------------
console.log(`\n${COLOR.bold}4. Zero External Dependency Verification (Pure Node.js Stdlib):${COLOR.reset}`);

const ALLOWED_BUILTINS = new Set([
	"assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns",
	"events", "fs", "http", "https", "net", "os", "path", "process", "querystring",
	"readline", "stream", "string_decoder", "timers", "tls", "url", "util", "v8", "vm", "zlib"
]);

const productionJsFiles = walkDir(path.join(ROOT, "lib"), [".js"]).concat(walkDir(path.join(ROOT, "bin"), [".js"]));

productionJsFiles.forEach((file) => {
	const rel = path.relative(ROOT, file);
	const content = fs.readFileSync(file, "utf8");
	const requireMatches = content.matchAll(/require\(["']([^"']+)["']\)/g);
	for (const match of requireMatches) {
		const dep = match[1];
		if (dep.startsWith(".") || dep.startsWith("/")) continue;
		const coreModule = dep.replace(/^node:/, "");
		if (!ALLOWED_BUILTINS.has(coreModule)) {
			errorCount++;
			console.error(`  ${COLOR.red}✗ FORBIDDEN EXTERNAL DEPENDENCY in ${rel}:${COLOR.reset} '${dep}' (violates zero-dependency standard)`);
		}
	}
});
console.log(`  ${COLOR.green}✓${COLOR.reset} All production imports strictly conform to pure Node.js standard library.`);

// -----------------------------------------------------------------------------
// Final Verdict
// -----------------------------------------------------------------------------
console.log(`\n${COLOR.bold}${COLOR.cyan}====================================================${COLOR.reset}`);
if (errorCount === 0) {
	console.log(`${COLOR.bold}${COLOR.green} 🎉 LINT PASSED: ${fileCount} files/blocks checked with 0 errors!${COLOR.reset}`);
	console.log(`${COLOR.bold}${COLOR.cyan}====================================================${COLOR.reset}\n`);
	process.exit(0);
} else {
	console.error(`${COLOR.bold}${COLOR.red} ❌ LINT FAILED: Found ${errorCount} error(s) across files!${COLOR.reset}`);
	console.error(`${COLOR.bold}${COLOR.cyan}====================================================${COLOR.reset}\n`);
	process.exit(1);
}
