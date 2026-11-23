# Privacy, Data Protection & Humanitarian Do-No-Harm Policy

This document details how **DRR Agent Plugin** (`sindicatoesp/drr-agent-plugin`) complies with **Digital Public Goods (DPG) Standard Indicator 7 (Privacy & Applicable Laws)**, **Indicator 9A (Data Privacy & Security)**, the **September 2025 DPGA Strengthened Privacy and Data Security Framework (6 Mandatory Privacy Requirements)**, and the **DPG Standard Privacy & Data Security Best Practices Annexure**.

---

## 1. Executive Summary: Zero-PII by Design

**`drr-agent-plugin` does NOT collect, require, or transmit individual Personally Identifiable Information (PII) in its core design.**

All core calculations operate exclusively on:
* **Public physical hazard telemetry** (earthquake epicenters/magnitudes, cyclone tracks, precipitation forecasts, river discharge, flood depth grids).
* **Aggregated demographic counts** (e.g., administrative-unit population totals from OCHA HDX HAPI / COD-PS, modeled exposed/displaced counts).
* **Physical asset & infrastructure inventories** (building taxonomies, facility coordinates, replacement values, Sendai Target D sector classifications).

There is **no telemetry, analytics beacon, phone-home tracking, or user account database** embedded in the software.

---

## 2. Compliance with the 6 Mandatory DPGA Privacy Requirements (Sept 2025 Framework)

### Requirement 1: Data Minimisation
> *Question: Is this the minimum amount of PII data required for your solution to function properly?*

* **Yes — zero individual PII is required.** The plugin is architected to function with **no personal data** (no names, dates of birth, biometric identifiers, national IDs, home addresses of individuals, or medical records).
* Where operators configure optional local metadata (such as an institutional CAP `<sender>` email like `eoc@agency.gov` or a webhook URL), those values stay strictly local in operator-controlled `.env` / `alerts-config.json` files and are never sent to the project maintainers.
* As a defense-in-depth safeguard against accidental PII ingestion in external feeds or operator notes, `lib/security.js` provides `detectAndRedactPii()` alongside `redactSensitiveObject()` to detect and redact incidental email addresses, phone numbers, and credential tokens before state persistence.

### Requirement 2: User Consent Mechanisms
> *Question: How does your solution communicate to the user that you are collecting their PII data?*

* Because the core software does **not** collect end-user PII or run background telemetry, no personal data is collected by the plugin from operators or affected citizens.
* All outbound network requests to external public hazard feeds (USGS, GDACS, Open-Meteo, OSM Overpass, OCHA HDX) are strictly **operator-initiated** (explicit CLI/MCP invocation or operator-configured monitor daemon) and can be completely disabled via `DRR_OFFLINE_MODE=true` for air-gapped deployments.
* Downstream deploying organizations that connect `drr-agent-plugin` to local registries or national DELTA instances remain the Data Controllers under applicable national law and must apply their institutional notice and consent procedures for any operator-supplied data.

### Requirement 3: Data Usage Transparency & Data Flow Mapping
> *Questions: (a) Privacy policy outlining consent, purpose, and subject-request handling; (b) Where in the solution is PII data processed or used, and which components allow access?*

#### Data Flow Map (Core Software)

| Component | Input Data | Data Classification | Local Storage / Retention | Outbound Transmission |
| :--- | :--- | :--- | :--- | :--- |
| `lib/usgs.js`, `lib/gdacs.js`, `lib/openmeteo.js`, `lib/sensorthings.js`, `lib/stac.js`, `lib/shakemap.js` | Public hazard/weather/sensor feeds | Non-PII physical telemetry | Optional secret-redacted hash in `lib/state-store.js` | Outbound GET to public/configured endpoints (disabled when `DRR_OFFLINE_MODE=true`) |
| `lib/hdx.js`, `lib/osm-infra.js`, `lib/infra-overlay.js` | Admin-level population counts, critical facilities GeoJSON | Aggregated non-PII; facilities may carry `sensitivity: "restricted"` | In-memory or operator-managed local GeoJSON | Outbound GET to public HDX/OSM/OGC endpoints (optional) |
| `lib/spatial.js`, `lib/fragility.js`, `lib/vulnerability.js`, `lib/severity.js`, `lib/sendai.js`, `lib/uncertainty.js`, `lib/appraisal.js` | Hazard intensity + exposure GeoJSON | Aggregated non-PII | None (pure deterministic computation) | None |
| `lib/cap.js` | Alert parameters (`sender`, `headline`, polygon) | Institutional metadata (optional role email) | Local `alerts/` directory (defaults to `Draft`) | None by default; live publish blocked unless `DRR_ENABLE_PRODUCTION_PUBLISH=true` + signed token |
| `lib/state-store.js` | Run ledgers, event hashes, checkpoints | Secret-redacted operational state (Non-PII) | Local JSON ledger with atomic CAS & retention policy | None |
| `lib/delta.js` | Draft Sendai loss bundles | Aggregated non-PII loss indicators | Local draft payloads | Only to operator-configured national DELTA instance when explicitly enabled |

* **Subject Requests**: Because `drr-agent-plugin` runs locally/self-hosted and maintainers hold zero user data, any data-subject inquiry regarding a local deployment is handled directly by the deploying organization (Data Controller) using the built-in export and deletion mechanisms below.

### Requirement 4: Adherence to Privacy-by-Design Principles & Deletion Mechanisms
> *Question: Which mechanisms does your solution provide to delete PII data?*

* **Automated Retention Pruning**: `lib/state-store.js` automatically prunes expired raw snapshots on state commits according to the active `APPROVED_RETENTION_POLICIES` schedule (`minimal-7d`, `standard-30d`, `audit-90d`).
* **On-Demand State Purge & Erasure**: Operators can deterministically purge expired records or completely erase local state stores at any time via:
  * Programmatic API: `purgeLedgerState(storageDir, { mode: "expired" | "all", scopeId })` in `lib/state-store.js`.
  * CLI Utility: `npm run data:purge -- --dir <stateDir> --mode all --confirm` (`scripts/dpg-data-portability.js`).
* **Incidental PII Redaction**: `detectAndRedactPii()` in `lib/security.js` strips incidental personal emails, phone numbers, and tokens from free-text payloads before archival or sharing.
* **Stateless & Offline Execution**: Operators can run all 40 tools in zero-persistence stateless mode or `DRR_OFFLINE_MODE=true`.

### Requirement 5: Transparency Around Data Retention & Disposal
`lib/state-store.js` enforces explicit, auditable retention policies (`APPROVED_RETENTION_POLICIES`):

| Policy ID | Ledger State Retention | Raw Snapshot Retention | Public Summary Retention | Inline Raw Payloads |
| :--- | :---: | :---: | :---: | :---: |
| `minimal-7d` | 90 days | 7 days | 30 days | Disabled (`false`) |
| `standard-30d` *(default)* | 365 days | 30 days | 90 days | Disabled (`false`) |
| `audit-90d` | 730 days | 90 days | 180 days | Enabled (secret-redacted) |

Expired raw snapshots are automatically purged during state commits, and full disposal is available via `purgeLedgerState`.

### Requirement 6: Data Governance, Access Controls & Group-Data (Non-PII) Do-No-Harm Safeguards
> *Aligned with the DPGA Best Practices Annexure & ICRC Handbook on Data Protection in Humanitarian Action.*

Even without individual PII, **group data and critical infrastructure locations** can create harm in disaster or conflict settings (e.g., exposing vulnerable displacement shelters or sensitive power/telecom/hospital nodes). `drr-agent-plugin` enforces technical safeguards for non-PII humanitarian sensitivity:
* **Public-Audience Redaction**: `lib/infra-overlay.js` tags features with `sensitivity` (`public` | `eoc_internal` | `restricted`) and `redistributionAllowed`. When `audience: "public"` is requested, restricted or non-redistributable assets are automatically stripped and `redactedForPublicCount` is audited.
* **Tenant & Country Data Isolation**: `enforceTenantIsolation` (`lib/security.js`), `TARGET_COUNTRIES`, and `DELTA_COUNTRY_STRICT` enforce strict jurisdictional boundaries and data localization.
* **Cryptographic Publication Controls**: Consequential actions (such as CAP production publish) require HMAC-SHA256 signed `approvalToken` verification (`lib/security.js`).
* **Local-First Sovereignty**: Deploying agencies retain 100% control over storage, encryption-at-rest (OS/volume level), TLS-in-transit, and RBAC/MFA on their own infrastructure.

---

## 3. Alignment with International Privacy & Humanitarian Frameworks

* **EU GDPR (Regulation 2016/679)**: Data minimisation (Art. 5(1)(c)), storage limitation (Art. 5(1)(e)), privacy by design and default (Art. 25), data portability (Art. 20 via `npm run data:export`), and right to erasure support (Art. 17 via `npm run data:purge`).
* **UN Personal Data Protection and Privacy Principles (2018)**: Fair and legitimate processing, purpose specification, proportionality/minimisation, retention, and security.
* **ICRC & Brussels Privacy Hub — *Handbook on Data Protection in Humanitarian Action***: Do-no-harm protections for vulnerable groups and sensitive humanitarian infrastructure metadata.
