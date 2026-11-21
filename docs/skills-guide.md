# DRR Agent Plugin — End-User Skills & Prompting Guide

This guide explains how end users—**EOC Duty Officers, Anticipatory Action Leads, UN OCHA Analysts, National Sendai/DELTA Focal Points, and Resilience Engineers**—can prompt AI assistants (Google Antigravity, Claude Code/Desktop, Cursor, GitHub Copilot, OpenCode) to invoke each of the **13 DRR Domain Skills** using realistic, specific disaster risk reduction use cases.

---

## How Skills Work When You Prompt an AI Assistant

Each skill in `skills/<skill-name>/SKILL.md` provides your AI assistant with:
1. **Domain Methodology & Guardrails** (what is scientifically valid and what is strictly forbidden, such as fabricating flood depths from rainfall or auto-publishing live CAP sirens).
2. **Exact Tool Orchestration** (which of the **29 deterministic MCP tools** to call instead of letting the LLM guess numbers).
3. **Escalation & Governance Rules** (when the assistant must stop and ask a human Duty Officer, Hydrologist, or National Focal Point for review or approval).

### Tips for Effective Prompts
* **Trigger implicitly by describing your task** (e.g., *"Screen the 5-day rainfall forecast for Dhaka against our approved FbF policy"*) — the agent automatically selects the matching skill.
* **Trigger explicitly by naming the skill** (e.g., *"Using the `sendai-indicator-accounting` skill, audit this flood loss report..."*) when you want strict enforcement of a specific governance checklist.
* **Include concrete inputs** whenever available: coordinates (`[lon, lat]` or `lat`/`lon`), hazard intensity **with units** (`0.40 g`, `2.2 m`, `210 km/h`), file paths to GeoJSON exposure layers, ISO-4217 currency + valuation year, or `mock: true` / offline fixtures.
* **Chain multiple skills** in a single prompt for end-to-end operational workflows (see [Multi-Skill Workflows](#multi-skill-end-to-end-prompt-chains)).

---

## Quick Reference: All 13 DRR Skills

| # | Skill Name | Primary Persona | Specific Use Case Example Below | Core MCP Tools |
| :---: | :--- | :--- | :--- | :--- |
| 1 | [`early-warning-telemetry`](#1-early-warning-telemetry) | EOC Watchstander | Mindanao M6.9 earthquake rapid PGA screening & Dhaka monsoon screening | `drr_usgs_earthquake_fetch`, `drr_gdacs_fetch`, `drr_openmeteo_forecast`, `drr_river_discharge_screen`, `drr_event_match_deduplicate` |
| 2 | [`gdacs-feed-ingestion`](#2-gdacs-feed-ingestion) | UN OCHA / Regional Analyst | South Pacific (Vanuatu) Category 4 cyclone alert triage & sanitization | `drr_gdacs_fetch`, `drr_hazard_crosswalk`, `drr_event_match_deduplicate`, `drr_spatial_exposure_join` |
| 3 | [`forecast-based-action-trigger-design`](#3-forecast-based-action-trigger-design) | Anticipatory Action / FbF Lead | Bangladesh Jamuna/Chao Phraya 72h flood financing trigger verification | `drr_openmeteo_forecast`, `drr_basin_rainfall_aggregate`, `drr_river_discharge_screen`, `drr_spatial_exposure_join` |
| 4 | [`hazard-exposure-modeling`](#4-hazard-exposure-modeling) | GIS / Structural Engineer | Fiji antimeridian cyclone exposure join, GeoJSON repair & seismic fragility | `drr_geojson_validate`, `drr_geometry_repair`, `drr_crs_transform`, `drr_raster_zonal_stats`, `drr_spatial_exposure_join`, `drr_model_registry_list`, `drr_fragility_eval` |
| 5 | [`vulnerability-matrix`](#5-vulnerability-matrix) | Rapid PDNA Analyst | Southern Thailand (Yala) 2.2m flood composite loss & facility damage | `drr_input_contract_validate`, `drr_vulnerability_matrix_calc`, `drr_sendai_validate`, `drr_uncertainty_propagate` |
| 6 | [`oasis-cap-alerting`](#6-oasis-cap-alerting) | EOC Alerting Officer | Sulawesi M7.2 earthquake Draft CAP v1.2 XML & 24h situation brief | `drr_cap_alert_generate_validate`, `drr_cap_publish` |
| 7 | [`cap-governance-and-approval`](#7-cap-governance-and-approval) | EOC Duty Officer & Security Lead | Sandbox vs. production CAP broadcast gating with HMAC approval token | `drr_cap_alert_generate_validate`, `drr_cap_publish` |
| 8 | [`sendai-indicator-accounting`](#8-sendai-indicator-accounting) | National Sendai Focal Point | Annual Sendai Targets B/C/D audit for provincial flood reporting | `drr_sendai_validate`, `drr_vulnerability_matrix_calc`, `drr_delta_schema_validate` |
| 9 | [`delta-disaster-recording`](#9-delta-disaster-recording) | National DELTA Data Manager | Submitting a schema-validated draft flood record to Thailand's DELTA instance | `drr_delta_docs`, `drr_delta_fetch_exposure`, `drr_delta_schema_validate`, `drr_delta_push_draft_record` |
| 10 | [`undrr-hip-hazard-classification`](#10-undrr-hip-hazard-classification) | Disaster Catalog / Taxonomy Lead | Mapping GDACS/USGS codes & free-text reports to UNDRR-ISC HIP (2020/2025) | `drr_hazard_crosswalk`, `drr_delta_fetch_exposure` |
| 11 | [`event-identity-and-linkage`](#11-event-identity-and-linkage) | Multi-Feed Watchstander | Deduplicating overlapping USGS + GDACS events & separating tsunami cascades | `drr_event_match_deduplicate`, `drr_monitor_check` |
| 12 | [`drr-data-quality-and-provenance`](#12-drr-data-quality-and-provenance) | DRR Data Steward / Auditor | Pre-flight validation, SHA-256 provenance manifest & replay verification | `drr_input_contract_validate`, `drr_source_provenance_manifest`, `drr_model_registry_list`, `drr_assessment_replay_validate`, `drr_uncertainty_propagate` |
| 13 | [`risk-reduction-options-appraisal`](#13-risk-reduction-options-appraisal) | Municipal Economist / Planner | Coastal flood levee vs. drainage Expected Annual Loss (EAL) & CBA appraisal | `drr_expected_annual_loss`, `drr_mitigation_cost_benefit`, `drr_uncertainty_propagate` |

---

## Per-Skill Prompt Examples & Specific Use Cases

---

### 1. `early-warning-telemetry`
**Skill file:** [`skills/early-warning-telemetry/SKILL.md`](../skills/early-warning-telemetry/SKILL.md)

**Specific Use Case — Mindanao M6.9 Earthquake Rapid Screening (Philippines EOC):**
A strong earthquake is reported offshore Mindanao. The EOC watchstander needs live USGS telemetry, Wald et al. (1999) GMICE estimated PGA, and extrapolation warnings within minutes.

#### Prompt Example A (Live Seismic Screening)
```text
Using the early-warning-telemetry skill, query the USGS earthquake feed for any M6.0+
earthquakes (limit 10). For the strongest event, report its hypocenter, MMI, and estimated
PGA (in g) using Wald et al. (1999) GMICE. Explicitly flag whether the MMI falls outside
the calibrated MMI V–VIII empirical range and note that this is a GMICE, not a GMPE.
```

#### Prompt Example B (Offline / Air-Gapped EOC Fixture Screening)
```text
We are in offline mode. Screen the USGS payload in examples/earthquake-hazus-scenario/input-hazard.json
and also check a 5-day Open-Meteo rainfall forecast for Dhaka (lat 23.8, lon 90.4) using an
unapproved default trigger policy. Confirm that no flood depth is fabricated from rainfall alone.
```

**Expected Behavior & Guardrails:**
* Calls `drr_usgs_earthquake_fetch` and/or `drr_openmeteo_forecast`.
* Flags `extrapolated: true` if MMI < 5 or MMI > 8.
* Returns `depthStatus: "depth_unavailable"` and `estimatedInundationDepthMeters: null` for Open-Meteo rainfall screening.

---

### 2. `gdacs-feed-ingestion`
**Skill file:** [`skills/gdacs-feed-ingestion/SKILL.md`](../skills/gdacs-feed-ingestion/SKILL.md)

**Specific Use Case — South Pacific Tropical Cyclone Triage (UN OCHA Regional Office):**
A Category 4 cyclone approaches Vanuatu and Fiji. The regional analyst needs active Orange/Red GDACS alerts sanitized against prompt injection, mapped to UNDRR HIP codes, and intersected with health facilities.

#### Prompt Example A (Active Regional Cyclone Triage)
```text
Use the gdacs-feed-ingestion skill to fetch all active GDACS Orange and Red Tropical Cyclone (TC)
alerts. Report each event's alertLevel, sourceIssuedAt, payloadHash, and whether
promptInjectionFlagged was triggered on any feed narrative. Crosswalk the GDACS "TC" code
to its UNDRR-ISC HIP triad.
```

#### Prompt Example B (Offline Flood Fixture + Facility Exposure Screening)
```text
Using the gdacs-feed-ingestion skill, ingest the offline GDACS flood sample at
examples/flood-gdacs-exposure/sample-gdacs-flood.json. Verify sanitization metadata, then
run a spatial exposure join against examples/flood-gdacs-exposure/critical-facilities.geojson
to identify exposed clinics and substations. Do not assume seismic PGA values for non-earthquake alerts.
```

**Expected Behavior & Guardrails:**
* Calls `drr_gdacs_fetch`, `drr_hazard_crosswalk`, and `drr_spatial_exposure_join`.
* Treats feed `title`/`description` as untrusted data and surfaces `promptInjectionFlagged`.

---

### 3. `forecast-based-action-trigger-design`
**Skill file:** [`skills/forecast-based-action-trigger-design/SKILL.md`](../skills/forecast-based-action-trigger-design/SKILL.md)

**Specific Use Case — 72-Hour Forecast-Based Financing (FbF) Flood Trigger (Red Cross / WFP Bangladesh):**
Monsoon rains are intensifying over the Brahmaputra/Jamuna basin. The Anticipatory Action Lead must verify whether both rainfall persistence and GloFAS river discharge exceed approved national FbF thresholds before releasing pre-positioned cash assistance.

#### Prompt Example A (Approved Trigger Policy & Multi-Run Persistence Check)
```text
Apply the forecast-based-action-trigger-design skill for Dhaka (lat 23.8, lon 90.4, 5-day forecast).
Evaluate the rainfall forecast against our approved triggerPolicy:
{ "policyId": "bgd-fbf-monsoon-2026", "approved": true, "requirePersistence": true }
using two prior forecast runs that both exceeded 150 mm. Report whether the trigger activates
and confirm that inundation depth remains depth_unavailable without a hydraulic model.
```

#### Prompt Example B (GloFAS River Discharge & River-Cell Suitability Screening)
```text
Using forecast-based-action-trigger-design, screen daily GloFAS river discharge values
[480, 920, 1340, 1490] m3/s for dates 2026-07-10 through 2026-07-13 against local return-period
thresholds { q2: 600, q5: 1000, q10: 1250, q20: 1500 }. The catchment has gridResolutionKm: 5,
upstreamDrainageAreaSqKm: 180, and isRiverCell: true. Check whether the 5 km GloFAS cell is
suitable for this headwater catchment and escalate if suitability fails.
```

**Expected Behavior & Guardrails:**
* Calls `drr_openmeteo_forecast`, `drr_basin_rainfall_aggregate`, and `drr_river_discharge_screen`.
* Flags coarse-grid suitability warnings for small headwater basins (`upstreamDrainageAreaSqKm` small vs. 5 km grid) and never labels discharge ($\text{m}^3/\text{s}$) as water depth (m).

---

### 4. `hazard-exposure-modeling`
**Skill file:** [`skills/hazard-exposure-modeling/SKILL.md`](../skills/hazard-exposure-modeling/SKILL.md)

**Specific Use Case — Municipal Seismic Exposure & Building Fragility (Urban Resilience Engineer):**
Before running a seismic loss assessment on a municipal GIS dataset, the engineer needs to validate GeoJSON topology, opt-in repair any unclosed polygon rings without losing the original geometry, reproject coordinates to UTM, and evaluate GEM/HAZUS fragility curves.

#### Prompt Example A (GeoJSON Validation, Opt-In Repair & Spatial Exposure Join)
```text
Using the hazard-exposure-modeling skill, first validate the GeoJSON topology of
examples/earthquake-hazus-scenario/input-hazard.json. If any polygon ring is unclosed or has
invalid RFC 7946 winding, perform an auditable repair (repairRequested: true) while preserving
originalGeometry and reporting areaSqKmDelta. Then run a deterministic spatial exposure join
against examples/earthquake-hazus-scenario/input-exposure.json.
```

#### Prompt Example B (Illustrative Fragility Evaluation & Production Gate Check)
```text
Apply hazard-exposure-modeling to evaluate earthquake fragility at 0.40 g PGA for URM
(Unreinforced Masonry) and C1_PRE_CODE (Pre-Code Concrete Frame) in exploratory mode, and compare
with flood depth-damage at 1.8 m for residential_1story vs. commercial buildings. Also check
what happens if we request mode: "production" on these embedded curves.
```

#### Prompt Example C (Raster Population Zonal Statistics)
```text
Using hazard-exposure-modeling, compute raster zonal statistics for a population density grid
(quantityType: "density_per_sqkm", EPSG:4326) inside our municipal ward polygon. Ensure nodata
cells are excluded and density is area-integrated rather than summed as raw counts.
```

**Expected Behavior & Guardrails:**
* Calls `drr_geojson_validate`, `drr_geometry_repair`, `drr_spatial_exposure_join`, `drr_fragility_eval`, `drr_raster_zonal_stats`.
* Blocks `mode: "production"` on `illustrative_baseline` curves until locally calibrated curves are registered.

---

### 5. `vulnerability-matrix`
**Skill file:** [`skills/vulnerability-matrix/SKILL.md`](../skills/vulnerability-matrix/SKILL.md)

**Specific Use Case — Rapid Post-Disaster Flood Impact Matrix (Southern Thailand Hindcast):**
Following a 2.2 m fluvial flood in Yala Province, the PDNA analyst needs composite damage estimates across hospitals, substations, and housing—strictly preserving unknown asset values as `null` and keeping modelled displacement separate from Sendai `B-1`.

#### Prompt Example A (Composite Flood Vulnerability Matrix)
```text
Use the vulnerability-matrix skill on examples/thailand-flood-scenario/spatial-report.json
for hazardType "flood" at intensity 2.2 meters (currency: "USD", valuationYear: 2026).
Report direct economic replacement losses (Target C), modelled shelter displacement, and
damaged critical infrastructure. Confirm that b1DirectlyAffected stays null unless direct
field evidence is supplied, and that physical damage (D-2..D-4) is separated from service
disruption (D-6..D-8).
```

#### Prompt Example B (Missing-Data & Uncertainty Sensitivity Check)
```text
Using the vulnerability-matrix skill, validate our exposure input contract where two rural
clinics have unknown replacement value (valueUsd: null). Ensure those unknowns are preserved
as null (never coerced to 0) and run a deterministic min/central/max uncertainty propagation
on the total loss estimate.
```

**Expected Behavior & Guardrails:**
* Calls `drr_input_contract_validate`, `drr_vulnerability_matrix_calc`, `drr_uncertainty_propagate`.
* Refuses silent defaults if `intensity` is omitted (`MISSING_REQUIRED_INPUT`).

---

### 6. `oasis-cap-alerting`
**Skill file:** [`skills/oasis-cap-alerting/SKILL.md`](../skills/oasis-cap-alerting/SKILL.md)

**Specific Use Case — Earthquake Warning Draft & 24h EOC Situation Brief (National Civil Defense):**
Minutes after an M7.2 earthquake near Palu, Indonesia, the alerting officer needs a schema-valid OASIS CAP v1.2 Draft XML alert for review and a Markdown situation brief for EOC leadership.

#### Prompt Example A (Generate & Validate Draft CAP v1.2 XML)
```text
Using the oasis-cap-alerting skill, generate an OASIS CAP v1.2 XML alert for a Mw 7.2
earthquake in Central Sulawesi with severity "Extreme", urgency "Immediate", certainty "Observed",
and areaDesc "Palu Bay and Donggala Coastal Wards". Keep the default Draft status and UTC +00:00
timestamp, validate the resulting XML, and show the separated C-07 governance states.
```

#### Prompt Example B (Validate an External CAP Update Message & Check XXE Safety)
```text
Apply the oasis-cap-alerting skill to validate the CAP XML file at
examples/earthquake-hazus-scenario/output-cap-alert.xml. Verify XXE/DOCTYPE safety,
confirm whether <references> is present if msgType is Update/Cancel, and synthesize a
concise Markdown emergency situation brief from the vulnerability report.
```

**Expected Behavior & Guardrails:**
* Calls `drr_cap_alert_generate_validate` (`generate_xml`, `validate_xml`, `generate_brief`).
* Defaults to `status: "Draft"` and reports `authenticityVerified: false`, `publicationApproved: false`, `deliveryStatus: "not_sent"` even when `schemaValid: true`.

---

### 7. `cap-governance-and-approval`
**Skill file:** [`skills/cap-governance-and-approval/SKILL.md`](../skills/cap-governance-and-approval/SKILL.md)

**Specific Use Case — Controlled CAP Broadcast Gate & Security Audit (EOC Duty Officer + Security Lead):**
Before dispatching a CAP warning to a national cell-broadcast gateway, the operations team must test sandbox delivery, confirm that Draft/Test alerts cannot leak into production, and verify cryptographic `approvalToken` binding.

#### Prompt Example A (Sandbox Publication Dry-Run)
```text
Using the cap-governance-and-approval skill, test publishing our validated Draft CAP XML
(examples/earthquake-hazus-scenario/output-cap-alert.xml) to channelType "sandbox" at
destination "https://sandbox.cap.example.org/ingest" with permissionScope "publish_cap" and
idempotencyKey "cap-drill-2026-001". Report the authorization and delivery audit result.
```

#### Prompt Example B (Verify Fail-Closed Production Guardrails)
```text
Using cap-governance-and-approval, verify that attempting to publish a Draft CAP XML to
channelType "production" — or passing a self-asserted { approved: true } object without a
cryptographically signed HMAC approvalToken bound to the payload hash and destination — is
deterministically rejected.
```

**Expected Behavior & Guardrails:**
* Calls `drr_cap_publish`.
* Blocks `Draft`/`Test`/`Exercise` on `production`, blocks unverified approval objects, and blocks live production dispatch unless `DRR_ENABLE_PRODUCTION_PUBLISH=true`.

---

### 8. `sendai-indicator-accounting`
**Skill file:** [`skills/sendai-indicator-accounting/SKILL.md`](../skills/sendai-indicator-accounting/SKILL.md)

**Specific Use Case — Annual UN Sendai Framework Monitor (SFM) Audit (Ministry Disaster Loss Focal Point):**
A national ministry is preparing its annual Sendai Targets B, C, and D submission after seasonal floods. The focal point must verify that modelled estimates are not mistakenly submitted as official observed statistics and that per-100,000 rates have valid population denominators.

#### Prompt Example A (Audit a Draft Sendai Submission Payload)
```text
Using the sendai-indicator-accounting skill, validate our provincial flood loss payload
(examples/thailand-flood-scenario/vulnerability-report.json) for Sendai Framework Monitor
eligibility. Check:
1. Whether modelled displacement is improperly mapped to B-1 directly affected people,
2. Whether Target B sub-populations are summed without a populationDeduplicationMethod,
3. Whether physical damage (D-2..D-4) is cleanly separated from service disruption (D-6..D-8),
4. Whether per-100,000 metrics include an explicit non-zero populationDenominator.
```

#### Prompt Example B (Verify Official Reporting Eligibility Gate)
```text
Apply sendai-indicator-accounting with requireCalibratedMethodology: true to check whether
an unreviewed modelled assessment (evidenceBasis: "modelled", verificationStatus: "unreviewed")
is eligible for official national Sendai reporting, and list the exact escalation steps required
for the National Focal Point.
```

**Expected Behavior & Guardrails:**
* Calls `drr_sendai_validate`.
* Returns `reportingEligibility: "pending"` or `"ineligible"` with structured reason codes whenever unreviewed modelled data, missing denominators, or C-01/C-02 conflations are detected.

---

### 9. `delta-disaster-recording`
**Skill file:** [`skills/delta-disaster-recording/SKILL.md`](../skills/delta-disaster-recording/SKILL.md)

**Specific Use Case — Draft Record Ingestion into National DELTA Resilience Instance (Thailand DDPM):**
After validating the Southern Thailand flood assessment, the national data manager wants to inspect DELTA's DTS schema, validate the relational bundle (including PostGIS SRID 4326 footprint and HIP triad), and dry-run pushing a `status: "draft"` record under tenant `THA`.

#### Prompt Example A (Schema Validation & Sandbox Draft Push)
```text
Using the delta-disaster-recording skill, fetch the DELTA DTS documentation (mock: true),
validate examples/thailand-flood-scenario/vulnerability-report.json against the DELTA schema
(HIP triad completeness, SRID 4326 footprint, wire sanitization), and perform a dry-run
(mock: true) draft push with tenantContext { actorTenant: "THA", targetTenant: "THA" },
name "Southern Thailand Monsoon Flood 2026", and notes "Rapid PDNA draft for DDPM review".
```

#### Prompt Example B (Tenant Isolation & Country Scoping Check)
```text
Using delta-disaster-recording, fetch baseline administrative divisions from DELTA (mock: true)
and verify what happens if a record for tenant "IDN" is pushed by actorTenant "THA" or while
DRR_ENABLE_PRODUCTION_PUBLISH is not enabled.
```

**Expected Behavior & Guardrails:**
* Calls `drr_delta_docs`, `drr_delta_fetch_exposure`, `drr_delta_schema_validate`, `drr_delta_push_draft_record`.
* Enforces `status: "draft"`, `source: "drr-agent-plugin"`, tenant isolation, and preserves C-03 governance metadata without mutating `evidenceBasis: "modelled"`.

---

### 10. `undrr-hip-hazard-classification`
**Skill file:** [`skills/undrr-hip-hazard-classification/SKILL.md`](../skills/undrr-hip-hazard-classification/SKILL.md)

**Specific Use Case — Multi-Agency Hazard Taxonomy Harmonization (National Disaster Catalog Team):**
A national disaster database merges records from GDACS (`EQ`, `FL`, `TC`), USGS, and provincial free-text field reports (`"flash mudslide after heavy rain"`). The catalog team must standardize everything to the UNDRR-ISC HIP triad and flag any codes affected by the 2025 HIP revision.

#### Prompt Example A (Exact Telemetry Code Crosswalk)
```text
Using the undrr-hip-hazard-classification skill, crosswalk the GDACS codes "EQ", "TC", and "FL"
(sourceSystem: "GDACS") to their official UNDRR-ISC HIP typeId, clusterId, and hazardId.
Report the taxonomyVersion and whether any code carries a 2025 HIP revision flag
(requires2025Crosswalk).
```

#### Prompt Example B (Ambiguous Free-Text & Unknown Code Handling)
```text
Apply undrr-hip-hazard-classification to classify the free-text field report
"coastal storm surge and urban flash flooding" (candidateLimit: 5) and the unknown code
"ZZ999". Confirm that free text returns human-reviewed candidates rather than an authoritative
exact match, and that the unknown code returns "unresolved".
```

**Expected Behavior & Guardrails:**
* Calls `drr_hazard_crosswalk`.
* Returns `resolutionType: "exact"` for known codes, `"candidates_require_review"` for free text, and `"unresolved"` for unknown inputs—never fabricating a mapping.

---

### 11. `event-identity-and-linkage`
**Skill file:** [`skills/event-identity-and-linkage/SKILL.md`](../skills/event-identity-and-linkage/SKILL.md)

**Specific Use Case — Multi-Feed Deduplication & Cascading Hazard Separation (24/7 EOC Watchstander):**
A major offshore earthquake triggers both a USGS alert, a revised USGS magnitude update, a GDACS earthquake alert 20 km away, and a coastal flood/tsunami alert 3 hours later. The watchstander must avoid duplicate CAP alerts and avoid falsely asserting automated causality.

#### Prompt Example A (Deduplicate USGS + GDACS + Revision Events)
```text
Using the event-identity-and-linkage skill, run drr_event_match_deduplicate on these incoming
events against our existing catalog (spatialRadiusKm: 50, timeWindowHours: 48):
- Incoming 1: exact same USGS event ID with updated magnitude (Mw 6.8 -> 7.1)
- Incoming 2: GDACS EQ event 18 km away within 2 hours of the USGS event
- Incoming 3: GDACS FL/Tsunami event 35 km away 3 hours later
Explain which are revision_update, which are possible_duplicate (held for human review),
and confirm that the cross-hazard co-occurrence is classified as cascading_candidate with
causalInferenceAllowed: false.
```

#### Prompt Example B (Single-Run Shadow Monitoring Cycle)
```text
Using event-identity-and-linkage, execute a read-only shadow monitoring check
(drr_monitor_check with mock: true, readOnly: true) against alerts-config.example.json
and report how duplicate events are suppressed while preserving reversible mergeHistory.
```

**Expected Behavior & Guardrails:**
* Calls `drr_event_match_deduplicate` and/or `drr_monitor_check`.
* Never auto-merges ambiguous cross-source matches and never infers `triggered_by` automatically.

---

### 12. `drr-data-quality-and-provenance`
**Skill file:** [`skills/drr-data-quality-and-provenance/SKILL.md`](../skills/drr-data-quality-and-provenance/SKILL.md)

**Specific Use Case — Pre-Flight Audit, Provenance Manifest & Scientific Replay (DRR Data Steward):**
Before briefing donors or publishing an analytical appendix, the data steward must verify input contracts (coordinate order, units, missing data), inspect registered model applicability, run frozen-input replay verification, and generate a secret-sanitized SHA-256 provenance manifest.

#### Prompt Example A (Input Contract Validation & Provenance Manifest)
```text
Using the drr-data-quality-and-provenance skill, validate an earthquake assessment input
containing coordinates [125.15, 6.85], intensity 0.38, unit "g", currency "USD",
valuationYear 2026, and one facility with valueUsd: null (strictMissingData: true).
Then generate a SHA-256 provenance manifest with sourceIds ["usgs:us7000example"],
method { id: "REG_WALD99_GMICE", version: "1999.1" }, evidenceBasis "modelled",
verificationStatus "unreviewed", and approvalStatus "draft". Verify that any API key in
the inputsSnapshot is redacted before hashing.
```

#### Prompt Example B (Model Registry Inspection & Replay Suite Verification)
```text
Apply drr-data-quality-and-provenance to list all registered methods in MODEL_REGISTRY,
check whether REG_WALD99_GMICE is applicable at MMI 9.2 in exploratory mode, and run
drr_assessment_replay_validate with suite "all" to verify synthetic reference and hindcast
benchmark invariants.
```

**Expected Behavior & Guardrails:**
* Calls `drr_input_contract_validate`, `drr_source_provenance_manifest`, `drr_model_registry_list`, `drr_assessment_replay_validate`.
* Redacts secrets before SHA-256 hashing and distinguishes synthetic replay verification from empirical field validation.

---

### 13. `risk-reduction-options-appraisal`
**Skill file:** [`skills/risk-reduction-options-appraisal/SKILL.md`](../skills/risk-reduction-options-appraisal/SKILL.md)

**Specific Use Case — Urban Flood Levee Investment Appraisal (Municipal Treasury & Public Works):**
A coastal city evaluates whether a \$2.5M levee upgrade (\$30k/year OpEx, \$15k/year urban greenway co-benefits, 25-year horizon, 5% discount rate) is economically justified using a multi-return-period flood loss curve (10-, 50-, 100-, and 250-year return periods).

#### Prompt Example A (Expected Annual Loss + Cost-Benefit Analysis)
```text
Using the risk-reduction-options-appraisal skill:
1. Compute the baseline Expected Annual Loss (EAL) in USD (valuationYear: 2026,
   tailHandling: "flat_extrapolation") from these return-period flood losses:
   10-year: $800,000 | 50-year: $4,200,000 | 100-year: $8,500,000 | 250-year: $14,000,000.
2. Assume the proposed "Coastal Flood Levee Upgrade" reduces EAL to $180,000/year with
   capex $2,500,000, annualOpex $30,000, annualCoBenefits $15,000, discountRate 0.05,
   and horizonYears 25.
3. Run Cost-Benefit Analysis and report NPV, BCR, residual risk EAL, the discount-rate
   sensitivity matrix, and the separate policyJudgements section for treasury decision-makers.
```

#### Prompt Example B (Uncertainty Propagation on Single-Scenario Loss & EAL Guardrail)
```text
Using risk-reduction-options-appraisal, run a seeded Monte Carlo uncertainty propagation
(seed: 42, iterations: 1000, allowIllustrativeDistributions: true) for a 2.0 m flood affecting
$10,000,000 of residential_1story exposure, and confirm that passing a single return-period
event to drr_expected_annual_loss is rejected rather than misreported as EAL.
```

**Expected Behavior & Guardrails:**
* Calls `drr_expected_annual_loss`, `drr_mitigation_cost_benefit`, `drr_uncertainty_propagate`.
* Rejects single-event EAL calculations and cleanly separates `quantitativeMetrics` from `policyJudgements`.

---

## Multi-Skill End-to-End Prompt Chains

For real operations, you can combine multiple skills in a single prompt. Here are three battle-tested templates:

### Chain 1: Sudden-Onset Earthquake EOC Response (First 30 Minutes)
*Skills chained:* `early-warning-telemetry` → `event-identity-and-linkage` → `hazard-exposure-modeling` → `vulnerability-matrix` → `oasis-cap-alerting`

```text
Execute an end-to-end rapid earthquake response workflow:
1. (early-warning-telemetry) Query USGS for M6.0+ earthquakes and compute Wald99 GMICE PGA
   with extrapolation flags.
2. (event-identity-and-linkage) Deduplicate the strongest event against active GDACS EQ alerts.
3. (hazard-exposure-modeling) Join the hazard footprint against
   examples/earthquake-hazus-scenario/input-exposure.json and evaluate URM and C1_PRE_CODE
   fragility in exploratory mode.
4. (vulnerability-matrix) Compute direct economic losses (USD, 2026) and physical facility damage.
5. (oasis-cap-alerting) Draft a validated CAP v1.2 XML alert (status: Draft) and a Markdown
   EOC situation brief, clearly flagging that human approval is required before publication.
```

### Chain 2: 72-Hour Anticipatory Action Flood Financing Check
*Skills chained:* `forecast-based-action-trigger-design` → `undrr-hip-hazard-classification` → `hazard-exposure-modeling` → `cap-governance-and-approval`

```text
Run a 72-hour Anticipatory Action flood screening for Dhaka (lat 23.8, lon 90.4):
1. (forecast-based-action-trigger-design) Screen the 5-day Open-Meteo rainfall forecast against
   an approved trigger policy and screen GloFAS river discharge (m3/s) with river-cell suitability.
   Confirm no flood depth is fabricated from rainfall alone.
2. (undrr-hip-hazard-classification) Crosswalk the hazard to its UNDRR-ISC HIP triad.
3. (hazard-exposure-modeling) Identify critical shelters and clinics inside the target basin polygon.
4. (cap-governance-and-approval) Draft an Advisory CAP XML in Draft status and verify it is
   blocked from production broadcast until a signed approvalToken is supplied.
```

### Chain 3: Post-Disaster Sendai Audit & National DELTA Draft Submission
*Skills chained:* `drr-data-quality-and-provenance` → `vulnerability-matrix` → `sendai-indicator-accounting` → `delta-disaster-recording`

```text
Prepare a post-disaster flood submission for Thailand DDPM using
examples/thailand-flood-scenario/spatial-report.json (flood depth 2.2 m, USD, 2026):
1. (drr-data-quality-and-provenance) Validate the input contract and generate a SHA-256
   provenance manifest with evidenceBasis: "modelled" and approvalStatus: "draft".
2. (vulnerability-matrix) Compute the vulnerability matrix preserving unknown values as null.
3. (sendai-indicator-accounting) Audit the results for Sendai Targets B, C, and D eligibility
   and list all blockers preventing official SFM promotion.
4. (delta-disaster-recording) Validate the DELTA schema and dry-run push (mock: true) a Draft
   record under tenantContext { actorTenant: "THA", targetTenant: "THA" }.
```

---

## See Also
* **[MCP Tools & CLI Reference (`docs/api-reference.md`)](./api-reference.md)** — Full schemas for all 29 MCP tools and 29 CLI subcommands.
* **[Operational Playbook (`docs/operational-playbook.md`)](./operational-playbook.md)** — Personas, response timelines, and monitoring daemon workflows.
* **[Scientific Methodology (`docs/methodology.md`)](./methodology.md)** — Equations, applicability bounds, and C-01..C-08 governance standards.
* **[Authoritative Tool Inventory (`docs/tool-inventory.md`)](./tool-inventory.md)** — Auto-generated tool, CLI, skill, module, and test inventory.
