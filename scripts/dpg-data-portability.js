#!/usr/bin/env node
/**
 * DPG Non-Proprietary Data Portability & Privacy-by-Design Erasure Utility
 * (DPG Standard Indicators 6, 7 & 9A — Pure Node.js Stdlib)
 *
 * Usage:
 *   node scripts/dpg-data-portability.js export --dir .drr-state --scope global --format json|geojson|csv [--out file]
 *   node scripts/dpg-data-portability.js purge  --dir .drr-state --scope global --mode expired|all [--confirm]
 */

const fs = require("fs");
const path = require("path");
const { exportLedgerState, purgeLedgerState, createEmptyLedgerState } = require("../lib/state-store");

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];
		if (tok.startsWith("--")) {
			const key = tok.slice(2);
			const next = argv[i + 1];
			if (!next || next.startsWith("--")) {
				args[key] = true;
			} else {
				args[key] = next;
				i++;
			}
		} else {
			args._.push(tok);
		}
	}
	return args;
}

function loadActiveLedger(storageDir, scopeId) {
	const safeScope = String(scopeId || "global").replace(/[^a-zA-Z0-9._-]/g, "_");
	const pointerPath = path.join(storageDir, `pointer-${safeScope}.json`);
	if (!fs.existsSync(pointerPath)) {
		return createEmptyLedgerState(safeScope);
	}
	const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
	const ledgerFile = pointer.ledgerFile ? path.join(storageDir, path.basename(pointer.ledgerFile)) : null;
	if (!ledgerFile || !fs.existsSync(ledgerFile)) {
		return createEmptyLedgerState(safeScope);
	}
	return JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const action = args._[0];

	if (!action || args.help || args.h) {
		console.log(`DRR Agent Plugin — DPG Data Portability & Erasure Utility (Indicators 6, 7, 9A)

Usage:
  node scripts/dpg-data-portability.js export --dir <stateDir> [--scope global] [--format json|geojson|csv] [--out <file>]
  node scripts/dpg-data-portability.js purge  --dir <stateDir> [--scope global] [--mode expired|all] [--confirm]
`);
		process.exit(0);
	}

	const storageDir = path.resolve(args.dir || ".drr-state");
	const scopeId = args.scope || "global";

	if (action === "export") {
		const format = args.format || "json";
		const state = loadActiveLedger(storageDir, scopeId);
		const exported = exportLedgerState(state, { format, scopeId });
		if (args.out) {
			const outPath = path.resolve(args.out);
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.writeFileSync(outPath, exported.content, "utf8");
			console.log(JSON.stringify({ exported: true, outPath, ...exported.summary }, null, 2));
		} else {
			process.stdout.write(exported.content);
		}
		return;
	}

	if (action === "purge") {
		const mode = args.mode || "expired";
		const confirm = args.confirm === true || args.confirm === "true";
		const receipt = purgeLedgerState(storageDir, { mode, scopeId, confirm });
		console.log(JSON.stringify(receipt, null, 2));
		return;
	}

	console.error(`Unknown action '${action}'. Use 'export' or 'purge'.`);
	process.exit(1);
}

if (require.main === module) {
	try {
		main();
	} catch (err) {
		console.error(`ERROR: ${err.message}`);
		process.exit(1);
	}
}

module.exports = { loadActiveLedger };
