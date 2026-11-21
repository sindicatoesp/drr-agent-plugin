#!/usr/bin/env node
/**
 * Semantic Version (SemVer) Calculator for Automated Releases (dev -> main)
 *
 * Follows Conventional Commits & SemVer 2.0.0 best practices:
 * - MAJOR (X+1.0.0): PR label `major`/`breaking`/`breaking-change`, Conventional Commit
 *                    breaking syntax (`type!:` or `type(scope)!:`), or `BREAKING CHANGE:` / `BREAKING-CHANGE:`
 * - MINOR (X.Y+1.0): PR label `minor`/`feature`/`enhancement`, or `feat:` / `feat(scope):`
 * - PATCH (X.Y.Z+1): All other changes (`fix:`, `sec:`, `perf:`, `docs:`, `ci:`, `chore:`, etc.)
 *
 * If `package.json` was already manually bumped above the latest git tag, honors the
 * higher version instead of double-bumping.
 *
 * Pure Node.js standard library only.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const BREAKING_SUBJECT_RE = /^[a-z][a-z0-9,_-]*(?:\([^)]+\))?!:/i;
const BREAKING_BODY_RE = /(?:^|\n)\s*BREAKING[ -]CHANGE\s*:/;
const FEAT_SUBJECT_RE = /^feat(?:\([^)]+\))?:/i;

function parseSemver(versionStr) {
	const match = String(versionStr || "").trim().match(SEMVER_RE);
	if (!match) return null;
	return {
		major: parseInt(match[1], 10),
		minor: parseInt(match[2], 10),
		patch: parseInt(match[3], 10),
	};
}

function formatVersion(v) {
	return `${v.major}.${v.minor}.${v.patch}`;
}

function compareSemver(a, b) {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	return a.patch - b.patch;
}

/**
 * Determine SemVer bump level ("major" | "minor" | "patch") from commits, PR metadata, or explicit override.
 * @param {object} params
 * @param {Array<{subject?: string, body?: string}>} params.commits
 * @param {string} [params.prTitle]
 * @param {string} [params.prBody]
 * @param {string[]} [params.prLabels]
 * @param {string} [params.override] - "auto" | "major" | "minor" | "patch"
 * @returns {{ bump: "major"|"minor"|"patch", reason: string }}
 */
function detectBumpLevel(params = {}) {
	const override = String(params.override || "auto").trim().toLowerCase();
	if (override === "major" || override === "minor" || override === "patch") {
		return { bump: override, reason: `Explicit bump override: ${override}` };
	}

	const labels = (Array.isArray(params.prLabels) ? params.prLabels : []).map((l) =>
		String(l).trim().toLowerCase(),
	);

	// 1. Check PR labels first (highest explicit maintainer intent)
	if (labels.some((l) => l === "major" || l === "breaking" || l === "breaking-change")) {
		return { bump: "major", reason: "PR label indicates breaking/major change" };
	}

	const commits = Array.isArray(params.commits) ? params.commits : [];
	const textsToCheck = [
		{ subject: String(params.prTitle || "").trim(), body: String(params.prBody || "") },
		...commits.map((c) => ({
			subject: String(c?.subject || "").trim(),
			body: String(c?.body || ""),
		})),
	];

	// 2. Check for breaking changes in PR title/body or commit subjects/bodies
	for (const item of textsToCheck) {
		if (BREAKING_SUBJECT_RE.test(item.subject)) {
			return {
				bump: "major",
				reason: `Breaking change indicator ('!:') found in '${item.subject.slice(0, 80)}'`,
			};
		}
		if (BREAKING_BODY_RE.test(item.body)) {
			return {
				bump: "major",
				reason: "BREAKING CHANGE footer found in commit or PR description",
			};
		}
	}

	// 3. Check for minor/feature PR labels
	if (labels.some((l) => l === "minor" || l === "feature" || l === "enhancement")) {
		return { bump: "minor", reason: "PR label indicates minor/feature addition" };
	}

	// 4. Check for Conventional Commit `feat:` / `feat(scope):`
	for (const item of textsToCheck) {
		if (FEAT_SUBJECT_RE.test(item.subject)) {
			return {
				bump: "minor",
				reason: `Feature commit/PR ('feat:') found: '${item.subject.slice(0, 80)}'`,
			};
		}
	}

	// 5. Default to patch for fixes, security hardening, perf, docs, chores
	return {
		bump: "patch",
		reason: "Maintenance, bugfix, security, or performance changes (patch increment)",
	};
}

/**
 * Compute the next SemVer version & tag given current latest tag, package.json version, and commit history.
 */
function computeNextVersion(params = {}) {
	const baseFromTag = parseSemver(params.latestTag);
	const baseFromPkg = parseSemver(params.packageVersion);
	const base = baseFromTag || baseFromPkg || { major: 0, minor: 0, patch: 0 };

	const { bump, reason } = detectBumpLevel({
		commits: params.commits,
		prTitle: params.prTitle,
		prBody: params.prBody,
		prLabels: params.prLabels,
		override: params.override,
	});

	let candidate;
	if (bump === "major") {
		candidate = { major: base.major + 1, minor: 0, patch: 0 };
	} else if (bump === "minor") {
		candidate = { major: base.major, minor: base.minor + 1, patch: 0 };
	} else {
		candidate = { major: base.major, minor: base.minor, patch: base.patch + 1 };
	}

	// If package.json was already manually bumped higher than the latest tag, respect it
	// unless an explicit higher bump was computed.
	let finalVer = candidate;
	let finalReason = reason;
	if (baseFromTag && baseFromPkg && compareSemver(baseFromPkg, baseFromTag) > 0) {
		if (compareSemver(baseFromPkg, candidate) >= 0) {
			finalVer = baseFromPkg;
			finalReason = `Honoring pre-bumped package.json version (${formatVersion(baseFromPkg)})`;
		}
	}

	const version = formatVersion(finalVer);
	return {
		previousTag: baseFromTag ? `v${formatVersion(baseFromTag)}` : null,
		previousVersion: formatVersion(base),
		bump,
		version,
		tag: `v${version}`,
		reason: finalReason,
	};
}

function getLatestSemverTag(cwd) {
	try {
		const raw = execFileSync("git", ["tag", "-l", "v*", "--sort=-v:refname"], {
			cwd,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const tags = raw
			.split(/\r?\n/)
			.map((t) => t.trim())
			.filter((t) => SEMVER_RE.test(t));
		return tags[0] || null;
	} catch (_) {
		return null;
	}
}

function getCommitsSinceTag(cwd, latestTag) {
	try {
		const range = latestTag ? `${latestTag}..HEAD` : "HEAD";
		const SEP_COMMIT = "---DRR-COMMIT-SEP---";
		const SEP_FIELD = "---DRR-FIELD-SEP---";
		const raw = execFileSync(
			"git",
			["log", range, "--no-merges", `--format=%s${SEP_FIELD}%b${SEP_COMMIT}`],
			{ cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
		);
		return raw
			.split(SEP_COMMIT)
			.map((entry) => entry.trim())
			.filter(Boolean)
			.map((entry) => {
				const [subject = "", body = ""] = entry.split(SEP_FIELD);
				return { subject: subject.trim(), body: body.trim() };
			});
	} catch (_) {
		return [];
	}
}

function main() {
	const args = process.argv.slice(2);
	const opts = {};
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			const key = args[i].slice(2);
			const next = args[i + 1];
			if (next && !next.startsWith("--")) {
				opts[key] = next;
				i++;
			} else {
				opts[key] = true;
			}
		}
	}

	const repoRoot = path.resolve(__dirname, "..");
	const pkgPath = path.join(repoRoot, "package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

	const latestTag = opts["latest-tag"] || getLatestSemverTag(repoRoot);
	const commits = getCommitsSinceTag(repoRoot, latestTag);
	const prLabels = opts["pr-labels"]
		? String(opts["pr-labels"])
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: [];

	const result = computeNextVersion({
		latestTag,
		packageVersion: pkg.version,
		commits,
		prTitle: opts["pr-title"] || process.env.PR_TITLE || "",
		prBody: opts["pr-body"] || process.env.PR_BODY || "",
		prLabels,
		override: opts.override || process.env.RELEASE_BUMP_OVERRIDE || "auto",
	});

	const payload = {
		...result,
		commitsAnalyzed: commits.length,
	};

	if (opts["github-output"] && process.env.GITHUB_OUTPUT) {
		const lines = [
			`previous_tag=${payload.previousTag || ""}`,
			`bump=${payload.bump}`,
			`version=${payload.version}`,
			`tag=${payload.tag}`,
			`commits_analyzed=${payload.commitsAnalyzed}`,
			`reason=${payload.reason.replace(/[\r\n]+/g, " ")}`,
		];
		fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n", "utf8");
	}

	console.log(JSON.stringify(payload, null, 2));
}

if (require.main === module) {
	main();
}

module.exports = {
	parseSemver,
	formatVersion,
	compareSemver,
	detectBumpLevel,
	computeNextVersion,
};
