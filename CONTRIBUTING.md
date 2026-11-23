# Contributing to DRR Agent Plugin

Thank you for contributing to **DRR Agent Plugin**! This project is built as a **Digital Public Good** for Disaster Risk Reduction (DRR), and we welcome contributions from software engineers, GIS analysts, seismologists, hydrologists, humanitarian data specialists, and EOC practitioners.

---

## 1. Code of Conduct

All contributors and maintainers are expected to uphold our [Code of Conduct](./CODE_OF_CONDUCT.md) (Contributor Covenant v2.1).

---

## 2. Core Engineering & Scientific Invariants

Before submitting a pull request, please ensure your changes respect these non-negotiable project invariants:

1. **Zero External Dependencies**: Production code in `bin/`, `lib/`, and `scripts/` must use **pure Node.js standard library only** (enforced automatically by `node scripts/lint.js`).
2. **Deterministic Calculations**: Hazard/exposure/fragility/Sendai math must be deterministic, unit-checked (`lib/contracts.js`), and provenance-tracked—never delegated to probabilistic LLM guessing.
3. **Fail-Closed Safety & Governance**:
   * OASIS CAP v1.2 alerts must default to `status: "Draft"` (`DRR_ENABLE_PRODUCTION_PUBLISH` remains `false` by default).
   * Sendai Target B displacement must stay separated from `B-1` directly affected people; Target D physical damage (`D-2..D-4`) must stay separated from service disruption (`D-6..D-8`).
   * Missing numeric data must remain `null` (`unknown ≠ 0`).
   * Rainfall totals must never fabricate flood inundation depth (`depthStatus: "depth_unavailable"`).
4. **Privacy-by-Design**: Never introduce telemetry beacons, analytics trackers, or individual PII collection into core modules.
5. **Open Licensing**: All code contributions are submitted under **Apache-2.0** (Section 5 inbound = outbound) and documentation/skills/reference data under **CC-BY-4.0** (see [LICENSE](./LICENSE), [NOTICE](./NOTICE), and [GOVERNANCE.md](./GOVERNANCE.md)).

---

## 3. Local Development & Verification Workflow

### Prerequisites
* **Node.js >= 18.0.0** (no `npm install` needed).

### Setup & Testing
```bash
# 1. Clone the repository
git clone https://github.com/sindicatoesp/drr-agent-plugin.git
cd drr-agent-plugin

# 2. Branch from dev (all feature/fix PRs target dev)
git checkout dev
git checkout -b feat/my-improvement

# 3. Run full static lint, zero-dep check & all test suites
npm run check

# 4. Run DPG Standard compliance audit
npm run dpg:audit

# 5. If you modified MCP tools, CLI commands, or skills, regenerate inventory
npm run generate:inventory
```

---

## 4. High-Impact Ways to Contribute

* **L3 Historical Hindcast Fixtures**: Add well-documented historical disaster events with authoritative observed outcome bands (USGS ShakeMap/PAGER, Copernicus EMS, EM-DAT, DesInventar, DDPM) to `tests/validation/historical-hindcasts.json`.
* **L4 Scientific Peer Review**: Open an issue reviewing equations, applicability domains, or parameter registries in `docs/methodology.md` and `lib/registry.js`.
* **Open Standards Adapters**: Extend support for OGC APIs, WMO CAP profiles, STAC catalogs, or national open-data feeds using pure Node.js stdlib.
* **Translations & Accessibility**: Improve localization and WCAG 2.1 accessibility of Situation Reports (`lib/cap.js`) and documentation.

---

## 5. Pull Request Checklist

* Target the `dev` branch (releases merge `dev` → `main`).
* Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(...)`, `fix(...)`, `docs(...)`, `test(...)`).
* Include unit/regression tests in `tests/` and register new test files in `tests/run-all-tests.sh`.
* Ensure `npm run check` and `npm run dpg:audit` exit with code `0`.
