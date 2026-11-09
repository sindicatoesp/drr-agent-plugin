#!/usr/bin/env node
/**
 * Installs Git pre-commit hook into .git/hooks/pre-commit
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const hookDir = path.join(ROOT, ".git", "hooks");
const hookPath = path.join(hookDir, "pre-commit");

if (!fs.existsSync(hookDir)) {
	console.error("❌ .git/hooks directory not found. Is this a Git repository?");
	process.exit(1);
}

const hookScript = `#!/usr/bin/env bash
# DRR Agent Plugin - Automatic Pre-Commit Gate
set -e

echo "=================================================="
echo " 🛡️ DRR PRE-COMMIT HOOK: RUNNING QUALITY GATE"
echo "=================================================="

# 1. Run static linting & syntax checks
node scripts/lint.js

# 2. Run all unit and regression tests
bash tests/run-all-tests.sh

echo "=================================================="
echo " ✓ PRE-COMMIT PASSED: Commit approved!"
echo "=================================================="
`;

fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
console.log("✓ Git pre-commit hook installed successfully at: " + hookPath);
console.log("  Git will now automatically run 'node scripts/lint.js' and all tests before every commit.");
