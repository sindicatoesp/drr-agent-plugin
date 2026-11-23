const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { runDpgAudit } = require("../scripts/dpg-audit");
const { detectAndRedactPii } = require("../lib/security");
const {
	FileCasStateStore,
	exportLedgerState,
	purgeLedgerState,
	createEmptyLedgerState,
} = require("../lib/state-store");

console.log("Testing Digital Public Goods (DPG) Standard Compliance, PII Redaction & Data Portability...");

// 1. Automated 9-indicator DPG Standard audit
const audit = runDpgAudit();
assert.strictEqual(
	audit.valid,
	true,
	`DPG audit failed: ${JSON.stringify(audit.checks.filter((c) => !c.passed), null, 2)}`,
);
assert.strictEqual(audit.totalChecks, 11, "Expected 11 DPG indicator checks (1..8, 9A, 9B, 9C)");
assert.strictEqual(audit.passedCount, 11);

// 2. Indicator 7 & 9A: Incidental PII detection and redaction (preserving institutional emails)
const piiInput = {
	note: "Contact citizen jane.doe@gmail.com or +1 (555) 234-5678, ID 123-45-6789; official desk eoc@ndma.gov",
	nested: {
		personal: "user@example.com",
		agency: "alerts@undrr.org",
	},
};
const piiRes = detectAndRedactPii(piiInput);
assert.strictEqual(piiRes.piiDetectedCount, 4, `Expected 4 PII redactions, got ${piiRes.piiDetectedCount}`);
assert(piiRes.sanitized.note.includes("[REDACTED_EMAIL]"));
assert(piiRes.sanitized.note.includes("[REDACTED_PHONE]"));
assert(piiRes.sanitized.note.includes("[REDACTED_ID]"));
assert(piiRes.sanitized.note.includes("eoc@ndma.gov"), "Institutional .gov email should be preserved by default");
assert(piiRes.sanitized.nested.agency === "alerts@undrr.org", "Institutional .org email should be preserved by default");
assert(piiRes.sanitized.nested.personal === "[REDACTED_EMAIL]");

// Strict mode redacts all emails including institutional ones
const strictPii = detectAndRedactPii("eoc@ndma.gov", { preserveInstitutionalEmails: false });
assert.strictEqual(strictPii.sanitized, "[REDACTED_EMAIL]");
assert.strictEqual(strictPii.piiDetectedCount, 1);

// 3. Indicator 6: Non-proprietary state export (JSON, GeoJSON, CSV) with secret & PII redaction
const sampleState = createEmptyLedgerState("test-dpg");
sampleState.events["usgs::us12345"] = {
	sourceId: "usgs",
	externalEventId: "us12345",
	hazardType: "earthquake",
	alertLevel: "Orange",
	magnitude: 6.4,
	country: "Nepal",
	lat: 27.7,
	lon: 85.3,
	apiKey: "super-secret-token-xyz",
	operatorNote: "Reported by witness john.smith@yahoo.com",
	updatedAt: "2026-11-23T00:00:00+00:00",
};

const jsonExp = exportLedgerState(sampleState, { format: "json", scopeId: "test-dpg" });
assert.strictEqual(jsonExp.mimeType, "application/json");
const parsedJson = JSON.parse(jsonExp.content);
assert.strictEqual(parsedJson.dpgExportManifest.piiExcluded, true);
assert.strictEqual(parsedJson.dpgExportManifest.counts.events, 1);
assert(!jsonExp.content.includes("super-secret-token-xyz"), "Export must redact secrets");
assert(!jsonExp.content.includes("john.smith@yahoo.com"), "Export must redact incidental personal emails");

const geoExp = exportLedgerState(sampleState, { format: "geojson", scopeId: "test-dpg" });
assert.strictEqual(geoExp.mimeType, "application/geo+json");
const parsedGeo = JSON.parse(geoExp.content);
assert.strictEqual(parsedGeo.type, "FeatureCollection");
assert.strictEqual(parsedGeo.features.length, 1);
assert.deepStrictEqual(parsedGeo.features[0].geometry, { type: "Point", coordinates: [85.3, 27.7] });

const csvExp = exportLedgerState(sampleState, { format: "csv", scopeId: "test-dpg" });
assert.strictEqual(csvExp.mimeType, "text/csv");
assert(csvExp.content.includes("eventKey,sourceId,externalEventId"));
assert(csvExp.content.includes("usgs::us12345,usgs,us12345,earthquake,Orange,6.4,Nepal,27.7,85.3"));

// Reject unsupported proprietary formats
assert.throws(() => exportLedgerState(sampleState, { format: "xlsx" }), /UNSUPPORTED_EXPORT_FORMAT/);

// 4. Indicator 7 & 9A: Privacy-by-Design Retention Pruning & Full Erasure (purgeLedgerState + CLI)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drr-dpg-test-"));
try {
	const store = new FileCasStateStore({ storageDir: tmpDir, scopeId: "dpg-scope", retentionPolicy: "minimal-7d" });
	const ledgerFile = "ledger-dpg-scope-v1.json";
	const stateWithExpired = createEmptyLedgerState("dpg-scope");
	stateWithExpired.events["gdacs::FL-1"] = {
		sourceId: "gdacs",
		externalEventId: "FL-1",
		hazardType: "flood",
		alertLevel: "Red",
		lat: 7.0,
		lon: 100.45,
	};
	stateWithExpired.rawSnapshots["snap-old"] = {
		snapshotId: "snap-old",
		expiresAt: "2020-01-01T00:00:00+00:00",
	};
	stateWithExpired.rawSnapshots["snap-fresh"] = {
		snapshotId: "snap-fresh",
		expiresAt: "2099-01-01T00:00:00+00:00",
	};
	fs.writeFileSync(path.join(tmpDir, ledgerFile), JSON.stringify(stateWithExpired, null, 2), "utf8");
	fs.writeFileSync(
		path.join(tmpDir, "pointer-dpg-scope.json"),
		JSON.stringify({ scopeId: "dpg-scope", ledgerFile, stateVersion: 1 }, null, 2),
		"utf8",
	);
	assert(store.scopeId === "dpg-scope");

	// CLI export test
	const cliPath = path.join(__dirname, "..", "scripts", "dpg-data-portability.js");
	const cliGeoJson = execFileSync(
		process.execPath,
		[cliPath, "export", "--dir", tmpDir, "--scope", "dpg-scope", "--format", "geojson"],
		{ encoding: "utf8" },
	);
	const cliParsed = JSON.parse(cliGeoJson);
	assert.strictEqual(cliParsed.type, "FeatureCollection");
	assert.strictEqual(cliParsed.features.length, 1);

	// Expired snapshot pruning
	const pruneRes = purgeLedgerState(tmpDir, { mode: "expired", scopeId: "dpg-scope" });
	assert.strictEqual(pruneRes.purged, true);
	assert.strictEqual(pruneRes.prunedSnapshots, 1, "Expected 1 expired snapshot pruned");
	const afterPrune = JSON.parse(fs.readFileSync(path.join(tmpDir, ledgerFile), "utf8"));
	assert.strictEqual(afterPrune.rawSnapshots["snap-old"], undefined);
	assert(afterPrune.rawSnapshots["snap-fresh"], "Non-expired snapshot must be preserved");

	// Full erasure must fail without confirm: true
	assert.throws(() => purgeLedgerState(tmpDir, { mode: "all", scopeId: "dpg-scope" }), /CONFIRMATION_REQUIRED/);

	// Confirmed full erasure via CLI
	const cliPurge = execFileSync(
		process.execPath,
		[cliPath, "purge", "--dir", tmpDir, "--scope", "dpg-scope", "--mode", "all", "--confirm"],
		{ encoding: "utf8" },
	);
	const purgeParsed = JSON.parse(cliPurge);
	assert.strictEqual(purgeParsed.purged, true);
	assert(purgeParsed.removedFiles.length >= 2, "Expected ledger and pointer files to be erased");
	assert.strictEqual(fs.existsSync(path.join(tmpDir, "pointer-dpg-scope.json")), false);
} finally {
	fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("✅ Digital Public Goods (DPG) Standard compliance, PII redaction & data portability tests passed!");
