# DRR Agent Plugin — Validation & Benchmark Results

> Auto-generated directly from executable verification suites by `scripts/generate-validation-report.js` (package `@sindicatoesp/drr-agent-plugin` v1.10.0).

## Verification vs. Validation Distinction

* **Software & Formula Verification (L0–L2 — Verified in CI)**: Proves the deterministic code reproduces published analytical equations, unit conversions, schema rules, and fail-closed safety gates without bugs. It does **not** by itself prove real-world impact accuracy.
* **Frozen Historical Hindcast Validation (L3 — In CI, Expanding)**: Compares deterministic outputs against published post-disaster reconnaissance bands and real reanalysis grids (USGS ShakeMap/PAGER, EM-DAT, PDNAs, PAGASA/NDRRMC, DDPM, Copernicus C3S ERA5). It measures first-order screening fidelity and regression stability, and does **not** substitute for country-specific engineering calibration (L4–L6).
* **Independent Domain Review (L4) & Live Cross-Model AI Evaluation**: External peer review by domain specialists and live multi-model LLM trajectory/red-team evaluation across assistants remain planned milestones.

## Executive Summary

| Suite / Layer | Cases | Passed | Status | Basis |
| :--- | :---: | :---: | :--- | :--- |
| **L0–L1 Synthetic Reference Invariants** | 6 | 6 | ✅ Verified in CI | Formula, unit, null-preservation, Sendai & CAP invariants |
| **L2 Reference Model Verification** | 4 | 4 | ✅ Verified in CI | Golden analytical checks (Wald99, lognormal CDF, AEP EAL, CAP 1.2) |
| **L3 Historical Hindcast & Reanalysis** | 5 | 5 | 🟡 Passing in CI (L3) | 8 scalar events + 4 FbF triggers + 2 geospatial replays + 1 ERA5 WBGT replay |
| **GeoDisaster Benchmark (Deterministic Baseline)** | 6 | 6 | ✅ Verified in CI | Mean deterministic analytics score: `1` |
| **Live Cross-Assistant LLM Benchmark & Red-Team** | — | — | ⏳ Planned | Requires live model runs across Antigravity, Claude, Cursor, Copilot, OpenCode |

---

## 1. L2 Reference Model Verification (Formula & Standard Accuracy)

| Case ID | Status | Key Verified Metrics / Tolerance |
| :--- | :---: | :--- |
| `l2_wald99_reference_table` | ✅ Pass | `pointsVerified=6`, `maxAbsErrorG=0.000049` |
| `l2_fragility_lognormal_closed_form` | ✅ Pass | `taxonomiesVerified=6`, `maxProbError=0.000045`, `maxMdrError=0.000065`, `codeOrderingAt040g={"URM":0.4957,"C1_PRE_CODE":0.3783,"C1_MODERATE_CODE":0.1881,"C2":0.1427}` |
| `l2_appraisal_eal_analytical_integral` | ✅ Pass | `flatEalUsd=40250`, `truncatedEalUsd=35250`, `cbaNpvUsd=66208.58`, `cbaBcr=1.4` |
| `l2_oasis_cap12_canonical_examples` | ✅ Pass | `canonicalValidCount=2`, `malformedRejectedCount=3` |

---

## 2. L3 Multi-Event Historical Hindcast Corpus (`tests/validation/historical-hindcasts.json`)

* **Events Evaluated**: 8
* **Within Observed MDR Band**: 8/8 (100%)
* **Uncertainty Interval Coverage**: 8/8 (100%)
* **Mean Absolute MDR Error (vs. Band Midpoint)**: `0.034`
* **Corpus Snapshot Hash (SHA-256)**: `ddd24a3365aa4bb3583229f06bfc6c65c431d5be6095e6150ea9da1e7eed9b43`

| Event ID | ISO3 | Year | Hazard | Modelled MDR | Observed MDR Band | Abs Error | In Band | Uncertainty Covered |
| :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| `hist_eq_haiti_2010` | HTI | 2010 | earthquake | 0.5812 | [0.4, 0.85] | 0.0188 | ✅ | ✅ |
| `hist_eq_nepal_2015` | NPL | 2015 | earthquake | 0.2718 | [0.2, 0.55] | 0.0782 | ✅ | ✅ |
| `hist_eq_palu_2018` | IDN | 2018 | earthquake | 0.4206 | [0.3, 0.65] | 0.0294 | ✅ | ✅ |
| `hist_eq_turkiye_2023` | TUR | 2023 | earthquake | 0.6013 | [0.45, 0.8] | 0.0013 | ✅ | ✅ |
| `hist_flood_thailand_2017` | THA | 2017 | flood | 0.6304 | [0.45, 0.78] | 0.0104 | ✅ | ✅ |
| `hist_flood_pakistan_2022` | PAK | 2022 | flood | 0.5643 | [0.4, 0.75] | 0.0043 | ✅ | ✅ |
| `hist_cyclone_haiyan_2013` | PHL | 2013 | cyclone | 0.72 | [0.65, 1] | 0.13 | ✅ | ✅ |
| `hist_cyclone_idai_2019` | MOZ | 2019 | cyclone | 0.45 | [0.25, 0.7] | 0 | ✅ | ✅ |

---

## 3. L3 Forecast-based Financing (FbF) Trigger Skill Verification

* **Contingency Table** (4 cases): Hits=`2`, Misses=`0`, False Alarms=`0`, Correct Negatives=`2`
* **Skill Metrics**: POD=`1`, FAR=`0`, CSI=`1`, Accuracy=`1`
* **C-05 Invariant**: All cases returned `depthStatus: "depth_unavailable"` and `estimatedInundationDepthMeters: null`.

---

## 4. L3 End-to-End Geospatial Historical Event Replays (`tests/validation/geospatial-event-replays.json`)

Exercises full deterministic chain: `spatialExposureJoin` → `overlayCriticalInfraOnHazard` → `evaluateVulnerabilityMatrix` → `validateSendaiSubmission` → `evaluateHumanitarianSeverity`.

| Replay ID | ISO3 | Hazard | Spatial Precision / Recall | Exposed Pop (Ref) | Pop APE (%) | Portfolio MDR (Band) | Severity Phase | Reproducible |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `e2e_eq_turkiye_kahramanmaras_2023` | TUR | earthquake | 1 / 1 | 580,000 (580,000) | 0% | 0.6019 ([0.4, 0.8]) | Phase 5 | ✅ |
| `e2e_tc_philippines_odette_2021` | PHL | cyclone | 1 / 1 | 859,000 (859,000) | 0% | 0.45 ([0.3, 0.85]) | Phase 5 | ✅ |

---

## 5. L3 Real-Event Extreme-Heat Reanalysis Replay (`tests/validation/era5-luzon-wbgt-2024-04.json`)

* **Event**: April 2024 Luzon Extreme Heatwave (Copernicus C3S ERA5 single-levels reanalysis, peak `2024-04-29T05:00:00Z`)
* **Peak Outdoor WBGT**: `36.16 °C` | **Highland Cooling Gradient**: `2.98 °C` | **Continuous Semantics Preserved**: `true`

| Zone ID | P-Code | Role | Cells | Outdoor Mean / Max (°C) | Indoor Mean (°C) | Solar Load Δ (°C) |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| `phl_cagayan_valley` | PH02 | lowland_peak | 9 | 34.9833 / 36.16 | 29.8044 | +5.18 |
| `phl_metro_manila_ncr` | PH13 | urban_lowland | 2 | 34.57 / 34.62 | 30.275 | +4.3 |
| `phl_central_luzon` | PH03 | lowland | 6 | 34.4933 / 35.12 | 30.2867 | +4.21 |
| `phl_cordillera_highlands` | PH14 | highland_control | 6 | 32.0067 / 34.86 | 26.9783 | +5.03 |

---

## 6. GeoDisaster Agentic Benchmark Suite (`tests/benchmarks/geodisaster-scenarios.json`)

Scored via `runDualLayerEvaluation()` separating deterministic tool analytics from agent orchestration & narrative claim-grounding. The table below reports the **deterministic reference baseline**; live cross-model assistant runs (with prompt-injection red-team & tool-failure tests) are tracked separately as the next evaluation milestone.

| Scenario ID | Category | Deterministic Analytics Score | Reference Orchestration Score | Diagnosis |
| :--- | :--- | :---: | :---: | :--- |
| `geo-01-flood-fba-non-fabrication` | anticipatory_action_hydrology | 1 | 1 | `aligned_pass` |
| `geo-02-eq-rapid-exposure-sendai` | seismic_exposure_and_sendai | 1 | 1 | `aligned_pass` |
| `geo-03-cap-draft-governance` | alert_governance | 1 | 1 | `aligned_pass` |
| `geo-04-hdx-cod-severity` | humanitarian_severity_and_cod | 1 | 1 | `aligned_pass` |
| `geo-05-cip-cascade-redaction` | critical_infrastructure_and_cip | 1 | 1 | `aligned_pass` |
| `geo-06-stac-depth-vs-extent` | earth_observation_stac | 1 | 1 | `aligned_pass` |

### Reproducing This Report
```bash
npm run generate:validation-report
node bin/cli.js replay-validate --suite all
node bin/cli.js benchmark
```
