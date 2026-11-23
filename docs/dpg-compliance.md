# Digital Public Goods (DPG) Standard Compliance Matrix

This dossier maps **DRR Agent Plugin** (`sindicatoesp/drr-agent-plugin`) against all **9 indicators** of the [Digital Public Goods Standard](https://www.digitalpublicgoods.net/standard), including the **September 2025 DPGA Strengthened Privacy and Data Security Framework** (6 mandatory privacy requirements and Best Practices Annexure).

Automated compliance checks can be run locally or in CI at any time via:
```bash
npm run dpg:audit
```

---

## Summary Scorecard (All 9 DPG Standard Indicators)

| Indicator | Requirement | Status | Primary Evidence |
| :--- | :--- | :---: | :--- |
| **1. SDG Relevance** | Relevance to UN Sustainable Development Goals | ✅ Aligned | SDGs **1, 9, 11, 13, 17** (Targets `1.5`, `9.1`, `11.5`, `11.b`, `13.1`, `13.3`, `17.6`, `17.18`) — Section 1 below |
| **2. Open Licensing** | Approved open licenses for software, content & data | ✅ Aligned | Full OSI **Apache-2.0** ([LICENSE](../LICENSE)), **CC-BY-4.0** for docs/skills/data ([NOTICE](../NOTICE)), upstream attributions ([CREDITS.md](../CREDITS.md)) |
| **3. Clear Ownership** | Ownership clearly defined & documented | ✅ Aligned | [GOVERNANCE.md](../GOVERNANCE.md), [LICENSE](../LICENSE), [NOTICE](../NOTICE), public Git commit history |
| **4. Platform Independence** | Zero mandatory proprietary/closed dependencies | ✅ Aligned | **0 external npm dependencies** (`scripts/lint.js`), pure Node.js stdlib, Linux/macOS/Windows, Docker Alpine, `DRR_OFFLINE_MODE=true` |
| **5. Documentation** | Source code, use cases, architecture & contributor docs | ✅ Aligned | [README.md](../README.md), [api-reference.md](./api-reference.md), [methodology.md](./methodology.md), [operational-playbook.md](./operational-playbook.md), [skills-guide.md](./skills-guide.md), [CONTRIBUTING.md](../CONTRIBUTING.md) |
| **6. Mechanism for Extracting Data** | Extract/import non-PII data in non-proprietary formats | ✅ Aligned | Open JSON/GeoJSON/CSV/XML/Markdown outputs + `exportLedgerState` (`lib/state-store.js`) & `npm run data:export` (`scripts/dpg-data-portability.js`) |
| **7. Privacy & Applicable Laws** | Privacy-by-design + Sept 2025 6 mandatory requirements | ✅ Aligned | Zero individual PII by design, [PRIVACY.md](../PRIVACY.md), `detectAndRedactPii` (`lib/security.js`), `APPROVED_RETENTION_POLICIES` & `purgeLedgerState` (`lib/state-store.js`) |
| **8. Standards & Best Practices** | Open standards, Principles for Digital Development, CI | ✅ Aligned | 12+ open standards (CAP 1.2, GeoJSON, OGC, STAC, FDSN, UNDRR HIPs, Sendai, MCP), Principles for Digital Development (Section 3 below), CI on Node 18/20/22 |
| **9A. Data Privacy & Security** | Protect data privacy & security; vulnerability disclosure | ✅ Aligned | [SECURITY.md](../SECURITY.md), [PRIVACY.md](../PRIVACY.md), XXE/SSRF/XSS/prompt-injection guards, `audience: "public"` redaction, HMAC tokens |
| **9B. Inappropriate & Illegal Content** | Prevent illegal/harmful content & alert spoofing | ✅ Aligned | No public UGC hosting, untrusted feed sanitization (`sanitizeUntrustedFeedText`), fail-closed `Draft` CAP alerting (`DRR_ENABLE_PRODUCTION_PUBLISH=false`) |
| **9C. Protection from Harassment** | Community protection & harassment enforcement | ✅ Aligned | [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) (Contributor Covenant v2.1) with private reporting & enforcement ladder |

---

## 1. Indicator 1 — UN Sustainable Development Goals (SDG) Relevance

| SDG | Specific Targets & Indicators | How `drr-agent-plugin` Advances the Target |
| :--- | :--- | :--- |
| **SDG 11 — Sustainable Cities & Communities** | **Target 11.5** *(reduce deaths, affected people & direct economic loss from disasters)*; **Target 11.b** *(implement holistic DRR in line with the Sendai Framework)* | Deterministic spatial exposure joins (`lib/spatial.js`), GEM/HAZUS fragility screening (`lib/fragility.js`), Sendai Target B/C/D semantic accounting (`lib/sendai.js`), and UNDRR DELTA Resilience draft interoperability (`lib/delta.js`). |
| **SDG 13 — Climate Action** | **Target 13.1** *(strengthen resilience and adaptive capacity to climate-related hazards)*; **Target 13.3** *(improve early warning and institutional capacity)* | Multi-source climate/hydro-met telemetry (`lib/openmeteo.js`, `lib/hydro.js`, `lib/gdacs.js`, `lib/sensorthings.js`, `lib/stac.js`), configurable FbF threshold verification, and OASIS CAP v1.2 Draft alert generation (`lib/cap.js`). |
| **SDG 1 — No Poverty** | **Target 1.5** *(build resilience of the poor and vulnerable to climate-related extreme events and economic/environmental shocks)* | Supports anticipatory action (Forecast-based Financing) trigger verification, JIAF 2.0 / INFORM humanitarian rapid severity screening (`lib/severity.js`), and mitigation Cost-Benefit Analysis (`lib/appraisal.js`). |
| **SDG 9 — Industry, Innovation & Infrastructure** | **Target 9.1** *(develop quality, reliable, sustainable, and resilient infrastructure)* | Sendai Target D 9-sector critical infrastructure overlay (`lib/infra-overlay.js`), OpenStreetMap interim fallback (`lib/osm-infra.js`), static infrastructure pack builder (`scripts/build-static-infra.js`), and separate physical-damage vs. service-disruption tracking. |
| **SDG 17 — Partnerships for the Goals** | **Target 17.6** *(open technology cooperation)*; **Target 17.18** *(disaggregated national statistical capacity)* | Zero-dependency open-source distribution (`Apache-2.0`), open standards interoperability (MCP, Agent Plugins v1.0.0, OCHA HDX COD-AB/HAPI, OGC, CAP), and air-gapped sovereignty for Global South EOCs. |

---

## 2. Indicator 4 — Platform Independence & Zero-Lock-In Audit

* **Zero External Runtime Dependencies**: `package.json` contains no `dependencies` or `devDependencies`. `scripts/lint.js` statically verifies that every `require()` across `bin/`, `lib/`, and `scripts/` resolves exclusively to built-in Node.js modules or relative local files.
* **Cross-Platform Execution**: Runs natively on Linux, macOS, and Windows (`Makefile` + `make.bat`), as well as in an ~130 MB Alpine Linux Docker container (`Dockerfile`, `docker-compose.yml`).
* **Air-Gapped & Offline Sovereignty**: Setting `DRR_OFFLINE_MODE=true` disables all external network calls; all deterministic calculation tools, static critical infrastructure packs (`scripts/build-static-infra.js`), and L0–L3 validation suites operate 100% offline.
* **No Vendor Lock-In**: Exposes identical capabilities via standard CLI (`bin/cli.js`), vendor-neutral MCP JSON-RPC 2.0 stdio (`bin/mcp-server.js` — compatible with Antigravity, Claude Code, Cursor, GitHub Copilot, OpenCode, or any MCP client), and direct Node.js module imports (`lib/index.js`).

---

## 3. Indicator 8 — Alignment with Principles for Digital Development

| Principle | Implementation in `drr-agent-plugin` |
| :--- | :--- |
| **1. Design with the User** | 19 domain skills (`skills/*/SKILL.md`), operational persona workflows (`docs/operational-playbook.md`), and interactive HTML Situation Reports tailored for EOC watchstanders and DRR analysts. |
| **2. Understand the Existing Ecosystem** | Integrates directly with existing humanitarian/DRR infrastructure (UNDRR DELTA, OCHA HDX, GDACS, USGS, FDSN, OGC SensorThings, STAC, OASIS CAP) rather than creating parallel silos. |
| **3. Design for Scale** | Stateless deterministic modules, transactional CAS state persistence with lease fencing (`lib/state-store.js`), and global/regional static infrastructure packs. |
| **4. Build for Sustainability** | Zero external npm dependencies eliminates dependency rot and supply-chain breakage; pure stdlib Node.js >= 18 LTS ensures long-term maintainability. |
| **5. Be Data Driven** | Provenance manifests (`lib/contracts.js`), deterministic L2 reference model verification, L3 multi-event historical hindcasts (`tests/validation/historical-hindcasts.json`), and explicit uncertainty propagation (`lib/uncertainty.js`). |
| **6. Use Open Standards, Open Data, Open Source & Open Innovation** | `Apache-2.0` + `CC-BY-4.0`, OASIS CAP v1.2, GeoJSON RFC 7946, OGC SensorThings v1.1, OGC API – Features, STAC v1.0.0, FDSN-WS, UNDRR-ISC HIPs, Sendai Framework, MCP, and Agent Plugins v1.0.0. |
| **7. Reuse and Improve** | Built to extend and interoperate with UNDRR DELTA Resilience, OpenStreetMap, OCHA HDX, GEM/HAZUS, and JIAF/INFORM frameworks with full attribution in [CREDITS.md](../CREDITS.md). |
| **8. Address Privacy & Security** | Zero-PII by design ([PRIVACY.md](../PRIVACY.md)), comprehensive security hardening ([SECURITY.md](../SECURITY.md)), public-audience critical infrastructure redaction, and retention/purge controls. |
| **9. Be Collaborative** | Open governance ([GOVERNANCE.md](../GOVERNANCE.md)), [CONTRIBUTING.md](../CONTRIBUTING.md), [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md), and transparent L0–L6 validation status reporting. |

---

## 4. Machine-Readable Readiness Manifest

See [`dpg-assessment.json`](../dpg-assessment.json) for the structured JSON version of this compliance matrix, validated automatically by `npm run dpg:audit` and `tests/test-dpg-compliance.js`.
