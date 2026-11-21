#!/usr/bin/env node
/**
 * Release Manifest Version Synchronizer
 *
 * Keeps package.json and plugin.json strictly aligned with the SemVer release tag
 * computed by scripts/next-version.js (and optionally regenerates docs/tool-inventory.md).
 * Pure Node.js standard library only.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SEMVER_RE = /^v?(\d+\.\d+\.\d+)$/;

/**
 * Normalize and validate a SemVer version string (strips optional leading 'v').
 * @param {string} rawVersion
 * @returns {string} Clean X.Y.Z version
 */
function normalizeSemver(rawVersion) {
	const match = String(rawVersion || "").trim().match(SEMVER_RE);
	if (!match) {
		throw new Error(`Invalid SemVer version "${rawVersion}". Expected X.Y.Z or vX.Y.Z.`);
	}
	return match[1];
}

/**
 * Synchronize version fields in package.json and plugin.json under rootDir.
 * @param {string} rootDir
 * @param {string} nextVersion
 * @returns {{ version: string, changedFiles: string[] }}
 */
function syncManifestVersions(rootDir, nextVersion) {
	const version = normalizeSemver(nextVersion);
	const targets = ["package.json", "plugin.json"];
	const changedFiles = [];

	for (const relPath of targets) {
		const fullPath = path.join(rootDir, relPath);
		if (!fs.existsSync(fullPath)) continue;
		const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
		if (parsed.version !== version) {
			parsed.version = version;
			fs.writeFileSync(fullPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
			changedFiles.push(relPath);
		}
	}

	return { version, changedFiles };
}

function main() {
	const args = process.argv.slice(2);
	let versionArg = null;
	let runInventory = false;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--version" && args[i + 1]) {
			versionArg = args[i + 1];
			i++;
		} else if (args[i] === "--inventory") {
			runInventory = true;
		}
	}

	if (!versionArg) {
		console.error("Usage: node scripts/sync-version.js --version <X.Y.Z> [--inventory]");
		process.exit(1);
	}

	const rootDir = path.resolve(__dirname, "..");
	const result = syncManifestVersions(rootDir, versionArg);

	if (runInventory) {
		const invScript = path.join(rootDir, "scripts", "generate-inventory.js");
		if (fs.existsSync(invScript)) {
			execFileSync(process.execPath, [invScript], { cwd: rootDir, stdio: "inherit" });
		}
	}

	console.log(
		JSON.stringify({
			version: result.version,
			changedFiles: result.changedFiles,
			inventoryRegenerated: runInventory,
		}),
	);
}

if (require.main === module) {
	main();
}

module.exports = {
	normalizeSemver,
	syncManifestVersions,
};
