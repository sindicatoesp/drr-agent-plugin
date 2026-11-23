# Project Governance & Ownership

This document defines the ownership, legal stewardship, maintainer structure, and decision-making model for **DRR Agent Plugin** (`sindicatoesp/drr-agent-plugin`), in alignment with **Digital Public Goods (DPG) Standard Indicator 3 (Clear Ownership)** and **Indicator 8 (Standards & Best Practices)**.

---

## 1. Clear Ownership & Copyright Stewardship

* **Repository & Project Steward**: The `drr-agent-plugin` project is publicly hosted and maintained at [https://github.com/sindicatoesp/drr-agent-plugin](https://github.com/sindicatoesp/drr-agent-plugin) under the stewardship of the **DRR Agent Plugin Maintainers (`sindicatoesp`)**.
* **Copyright**: Copyright in the software, documentation, and bundled reference datasets belongs to the respective contributors (`Copyright 2026 DRR Agent Plugin Contributors`), with full commit-level authorship recorded transparently in the public Git history.
* **Multi-Asset Open Licensing**:
  * **Software source code** (`bin/`, `lib/`, `scripts/`, `tests/`, packaging): **Apache License 2.0** (`SPDX: Apache-2.0`), full text in [LICENSE](./LICENSE).
  * **Documentation, domain skills, and educational content** (`docs/`, `skills/`, `README.md`, `index.html`): **Creative Commons Attribution 4.0 International** (`SPDX: CC-BY-4.0`, also distributable under `Apache-2.0` as part of the package).
  * **Bundled reference & benchmark datasets** (`lib/hips-data.json`, `examples/`, `tests/validation/`, `tests/benchmarks/`): **CC-BY-4.0** with upstream open-data attributions preserved in [NOTICE](./NOTICE) and [CREDITS.md](./CREDITS.md).
* **Trademarks & Institutional Affiliation Disclaimer**:
  * `drr-agent-plugin` is an independent, community-maintained open-source project engineered for interoperability with the **UNDRR Sendai Framework Monitor**, **UNDRR DELTA Resilience**, **OASIS CAP v1.2**, **OCHA HDX**, **USGS**, **GDACS**, and **Open-Meteo**.
  * References to UNDRR, DELTA Resilience, UN OCHA, WMO, FEMA HAZUS, GEM, or national disaster management agencies describe technical interoperability and open standards alignment only; they do not imply formal institutional endorsement, certification, or legal agency authority unless explicitly published by those bodies.
  * Per Section 6 of the Apache License 2.0, no trademark rights of third-party organizations are granted by this license.

---

## 2. Maintainer Roles & Decision-Making

| Role | Responsibilities |
| :--- | :--- |
| **Core Maintainers** | Review and merge pull requests, maintain CI/lint/validation suites (`npm run check`, `npm run dpg:audit`), manage SemVer releases (`dev` → `main`), and respond to security/privacy reports. |
| **Domain Reviewers** | Review scientific methodology updates (`docs/methodology.md`), L2 reference model checks, L3 historical hindcast fixtures (`tests/validation/historical-hindcasts.json`), and domain skills (`skills/*/SKILL.md`). |
| **Contributors** | Submit issues, bug fixes, new open-standard adapters, translations, or hindcast fixtures via public Pull Requests targeting `dev`. |

### Consensus & Change Management
1. **Default Branch Workflow**: All feature, fix, documentation, and validation pull requests target `dev`. Automated CI (`.github/workflows/ci.yml`) must pass across Node.js 18.x, 20.x, and 22.x before merge.
2. **Release Governance**: Releases are promoted from `dev` to `main` using automated SemVer calculation (`scripts/next-version.js`) and manifest synchronization (`scripts/sync-version.js`).
3. **Zero-Dependency Invariant**: Production runtime modules (`bin/`, `lib/`, `scripts/`) must remain pure Node.js standard library (`0` external npm dependencies), enforced automatically by `scripts/lint.js`.
4. **Fail-Closed Safety Invariant**: Any change affecting CAP alert publication (`lib/cap.js`), security policies (`lib/security.js`), Sendai semantic separation (`lib/sendai.js`), or privacy/data retention (`lib/state-store.js`) requires explicit automated regression tests.

---

## 3. Contribution Licensing (Inbound = Outbound)

Under **Section 5 of the Apache License 2.0**, any contribution intentionally submitted via Pull Request or issue is licensed under the same terms (`Apache-2.0` for code; `CC-BY-4.0` for documentation/content/data) with no Contributor License Agreement (CLA) barrier or proprietary relicensing rights.

---

## 4. Contact & Public Channels

* **Issues & Feature Requests**: [https://github.com/sindicatoesp/drr-agent-plugin/issues](https://github.com/sindicatoesp/drr-agent-plugin/issues)
* **Security & Privacy Disclosures**: See [SECURITY.md](./SECURITY.md) and [PRIVACY.md](./PRIVACY.md)
* **Code of Conduct Reports**: See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
