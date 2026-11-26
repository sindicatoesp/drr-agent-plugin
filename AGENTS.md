# AGENTS.md — AI Software Engineering Instructions

This file is the single source of truth for **generic** software engineering rules applicable to all AI coding agents working in `@sindicatoesp/drr-agent-plugin`. Agent-specific instructions or platform-only behaviors belong in their dedicated files (for example, `.github/copilot-instructions.md` for GitHub Copilot).

## 1. Architecture & Repository Map

- **Runtime**: Pure **Node.js >= 18.0.0 standard library only** (`0` external npm dependencies).
- **`lib/`** (34 modules + `hips-data.json`): Core deterministic analytics, governance, security, and feed adapters (`contracts.js`, `registry.js`, `security.js`, `spatial.js`, `fragility.js`, `vulnerability.js`, `cap.js`, `events.js`, `sendai.js`, `delta.js`, `monitor.js`, `state-store.js`, `reconcile.js`, `benchmarks.js`, `gdacs.js`, `adam.js`, `usgs.js`, `shakemap.js`, `openmeteo.js`, `hydro.js`, `sensorthings.js`, `stac.js`, `infra-overlay.js`, `osm-infra.js`, `hdx.js`).
- **`bin/`**:
  - `bin/mcp-server.js`: JSON-RPC 2.0 stdio MCP server (`TOOLS` array + `handleToolCall`).
  - `bin/cli.js`: Direct CLI (`drr-tool <command>`).
  - `bin/serve.js`: Static preview server.
- **`skills/`**: 19 domain skills (`skills/<name>/SKILL.md`) for end-user DRR agents, indexed in `skills-manifest.json`.
- **`scripts/`**: `lint.js`, `arch-check.js`, `dpg-audit.js`, `generate-inventory.js`, `dpg-data-portability.js`, `build-static-infra.js`.
- **`tests/`**: Unit, integration, replay, and evaluation suites orchestrated by `tests/run-all-tests.sh`.

## 2. Non-Negotiable Engineering & Scientific Invariants

1. **Zero External Dependencies**: Production code in `bin/`, `lib/`, and `scripts/` MUST use Node.js standard library only (enforced by `npm run lint`).
2. **MCP ↔ CLI 1:1 Parity**: Every MCP tool in `bin/mcp-server.js` (`TOOLS`) MUST have a corresponding CLI subcommand in `bin/cli.js`, and vice versa. Whenever tools, CLI commands, or skills change, run `npm run generate:inventory` and update tool counts in `README.md`, `docs/api-reference.md`, `docs/skills-guide.md`, `tests/test-cli-inventory.js`, and `tests/test-mcp-server.js`.
3. **Dependency Direction**: `lib/` modules MUST NOT `require` from `bin/`, `scripts/`, or `tests/`.
4. **Scientific & Missing-Data Integrity**:
   - Missing numeric data MUST remain `null` (`unknown ≠ 0`).
   - Rainfall totals MUST NOT fabricate flood inundation depth (`depthStatus: "depth_unavailable"`).
   - Sendai Target B displacement (`B-2`..`B-5`) MUST stay separate from `B-1` directly affected; Target D physical damage (`D-2`..`D-4`) MUST stay separate from service disruption (`D-6`..`D-8`).
5. **Fail-Closed Safety & Secret Hygiene**:
   - OASIS CAP v1.2 alerts default to `status: "Draft"` (`DRR_ENABLE_PRODUCTION_PUBLISH` defaults to `false`).
   - External feed text MUST pass through `sanitizeUntrustedFeedText` (`lib/security.js`).
   - External URLs/errors MUST pass through `redactUrlSecrets` (`lib/config.js`) / `redactSensitiveObject` (`lib/security.js`).
6. **Git Branching**: Feature and fix PRs MUST target `dev` (not `main`), using [Conventional Commits](https://www.conventionalcommits.org/).

## 3. Standard Development Workflow

Follow this 8-stage workflow with explicit exit criteria:

1. **DISCOVER**: Inspect target modules, tests, and `docs/adr/` before editing. Never assume docs match code without reading the code.
2. **UNDERSTAND**: Identify invariants, unit/contract requirements (`lib/contracts.js`, `lib/registry.js`), and cross-module impact.
3. **PLAN**: Break changes into small, independently verifiable increments; list affected files and acceptance criteria.
4. **IMPLEMENT**: Reuse existing `lib/` abstractions (`fetchJsonWithConfig`, `sanitizeUntrustedFeedText`, `redactUrlSecrets`, `computeSnapshotHash`).
5. **TEST**: Add/update unit tests in `tests/`, register new test files in `tests/run-all-tests.sh`, and test offline (`DRR_OFFLINE_MODE=true`).
6. **REVIEW**: Check diff for unintended side effects, secret leaks, and backward compatibility.
7. **VALIDATE**: Run all required verification gates (below) and confirm exit code `0`. Never claim code works without running validation.
8. **DOCUMENT**: Update `docs/api-reference.md`, `docs/configuration.md`, `README.md`, `examples/`, and `docs/adr/` (for architectural changes), then run `npm run generate:inventory`.

## 4. Mandatory Verification Commands

Before committing or opening a PR:

```bash
npm run generate:inventory   # If tools, CLI commands, or skills changed
npm run check                # Runs lint.js, arch-check.js, and all test suites
npm run dpg:audit            # Runs 9-indicator DPG Standard compliance audit
```
