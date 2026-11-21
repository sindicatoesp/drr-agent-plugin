const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
	parseSemver,
	compareSemver,
	detectBumpLevel,
	computeNextVersion,
} = require("../scripts/next-version");
const { normalizeSemver, syncManifestVersions } = require("../scripts/sync-version");
const pkg = require("../package.json");
const pluginManifest = require("../plugin.json");
const { SERVER_VERSION } = require("../bin/mcp-server");

console.log("Testing Automated Release SemVer Calculator & Manifest Sync...");

// 1. parseSemver & compareSemver
assert.deepStrictEqual(parseSemver("v1.3.2"), { major: 1, minor: 3, patch: 2 });
assert.deepStrictEqual(parseSemver("2.0.0"), { major: 2, minor: 0, patch: 0 });
assert.strictEqual(parseSemver("invalid"), null);
assert(compareSemver(parseSemver("1.4.0"), parseSemver("1.3.2")) > 0);
assert(compareSemver(parseSemver("1.3.2"), parseSemver("1.3.2")) === 0);

// 2. Patch increment (fixes, sec, perf, chore, docs)
const patchRes = computeNextVersion({
	latestTag: "v1.3.2",
	packageVersion: "1.3.2",
	commits: [
		{ subject: "fix(gdacs): switch default GDACS_FEED_URL to events4app", body: "" },
		{ subject: "sec,perf: harden state-store and raster hot paths", body: "" },
	],
});
assert.strictEqual(patchRes.bump, "patch");
assert.strictEqual(patchRes.version, "1.3.3");
assert.strictEqual(patchRes.tag, "v1.3.3");

// 3. Minor increment (Conventional Commit feat:)
const minorRes = computeNextVersion({
	latestTag: "v1.3.2",
	packageVersion: "1.3.2",
	commits: [
		{ subject: "fix(gdacs): normalize alertlevel", body: "" },
		{ subject: "feat(monitor): add GloFAS river discharge alerting", body: "" },
	],
});
assert.strictEqual(minorRes.bump, "minor");
assert.strictEqual(minorRes.version, "1.4.0");
assert.strictEqual(minorRes.tag, "v1.4.0");

// 4. Major increment (breaking indicator `!:`)
const majorBangRes = computeNextVersion({
	latestTag: "v1.3.2",
	packageVersion: "1.3.2",
	commits: [
		{ subject: "feat(cap)!: require signed approval token for all CAP exports", body: "" },
	],
});
assert.strictEqual(majorBangRes.bump, "major");
assert.strictEqual(majorBangRes.version, "2.0.0");
assert.strictEqual(majorBangRes.tag, "v2.0.0");

// 5. Major increment (BREAKING CHANGE footer)
const majorFooterRes = computeNextVersion({
	latestTag: "v1.3.2",
	packageVersion: "1.3.2",
	commits: [
		{
			subject: "refactor(delta): remove legacy flat record format",
			body: "Cleanup legacy schema.\n\nBREAKING CHANGE: flat record payload is no longer accepted.",
		},
	],
});
assert.strictEqual(majorFooterRes.bump, "major");
assert.strictEqual(majorFooterRes.version, "2.0.0");

// 6. PR Label overrides (`major`, `minor`)
assert.strictEqual(detectBumpLevel({ prLabels: ["breaking"] }).bump, "major");
assert.strictEqual(detectBumpLevel({ prLabels: ["feature"] }).bump, "minor");
assert.strictEqual(detectBumpLevel({ override: "minor", commits: [] }).bump, "minor");

// 7. Honors manually pre-bumped package.json without double-bumping
const preBumped = computeNextVersion({
	latestTag: "v1.3.2",
	packageVersion: "1.4.0",
	commits: [{ subject: "fix: minor tweak", body: "" }],
});
assert.strictEqual(preBumped.version, "1.4.0");
assert.strictEqual(preBumped.tag, "v1.4.0");

// 8. Manifest version synchronization & single-source-of-truth invariant
assert.strictEqual(pkg.version, pluginManifest.version, "package.json and plugin.json versions must match");
assert.strictEqual(SERVER_VERSION, pkg.version, "MCP SERVER_VERSION must match package.json version");
assert.strictEqual(normalizeSemver("v1.5.0"), "1.5.0");
assert.throws(() => normalizeSemver("not-a-version"), /Invalid SemVer/);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drr-sync-ver-"));
try {
	fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "t", version: "1.3.2" }, null, 2));
	fs.writeFileSync(path.join(tmpDir, "plugin.json"), JSON.stringify({ name: "t", version: "1.3.2" }, null, 2));
	const syncRes = syncManifestVersions(tmpDir, "v1.5.0");
	assert.strictEqual(syncRes.version, "1.5.0");
	assert.deepStrictEqual(syncRes.changedFiles, ["package.json", "plugin.json"]);
	assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf8")).version, "1.5.0");
	assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmpDir, "plugin.json"), "utf8")).version, "1.5.0");
	// Idempotent second call
	const syncRes2 = syncManifestVersions(tmpDir, "1.5.0");
	assert.deepStrictEqual(syncRes2.changedFiles, []);
} finally {
	fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("✅ Automated release SemVer calculator & manifest sync tests passed!");
