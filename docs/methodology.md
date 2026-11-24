# Scientific Methodology & References

Theoretical foundations, applicability boundaries, and international standards underpinning the **DRR Analytics Agent Plugin**.

---

## 1. Ground Motion Conversion (Wald et al., 1999 GMICE)

`lib/usgs.js` converts USGS Modified Mercalli Intensity (MMI) to Peak Ground Acceleration ($\text{PGA}$ in $g$) using the empirical Ground-Motion to Intensity Conversion Equation (GMICE) published by **Wald et al. (1999)**:

$$\log_{10}(\text{PGA}_{\text{cm/s}^2}) = \frac{\text{MMI} - 1.66}{3.66} \quad \text{or} \quad \text{PGA}_g = \frac{10^{(\text{MMI} + 1.66)/3.66}}{980.665}$$

* **Classification Boundary (C-04)**: This relation is a **GMICE** (intensity-to-peak-motion empirical conversion), **not** a Ground-Motion Prediction Equation (GMPE) derived from earthquake source parameters, hypocentral distance, and site $V_{s30}$ amplification.
* **Applicability & Extrapolation**: Derived empirically from California earthquakes primarily across **MMI V–VIII**. Values outside this empirical band are explicitly flagged as `extrapolated: true` without fabricated confidence ratings (`REG_WALD99_GMICE`).

---

## 2. Structural Fragility & Illustrative Baseline Curves (C-06)

Fragility curves express conditional damage state exceedance probabilities given an intensity measure ($IM$):

$$P(DS \ge ds_i \mid IM) = \Phi\left(\frac{\ln(IM / \theta_i)}{\beta_i}\right)$$

Where $\Phi$ is the standard normal CDF, $\theta_i$ is median capacity, and $\beta_i$ is lognormal dispersion.

### Damage States & Central Damage Factors
1. **None ($ds_0$)**: 0% damage factor.
2. **Slight ($ds_1$)**: 5% central damage factor.
3. **Moderate ($ds_2$)**: 25% central damage factor.
4. **Extensive ($ds_3$)**: 60% central damage factor.
5. **Complete ($ds_4$)**: 100% central damage factor.

$$\text{MDR} = \sum_{i=0}^{4} P(DS = ds_i) \times \text{DamageFactor}(ds_i)$$

* **Boundary & Production Gate (C-06 / R-04)**: Every calculation resolves to a registered method in `lib/registry.js` (`MODEL_REGISTRY`) recording parameters, explicit intensity units (`g`, `m/s2`, `m`, `ft`, `km/h`, `m/s`, `kt`), and empirical applicability limits. Because embedded generic parameters (`URM`, `C1_PRE_CODE`, `C1_MODERATE_CODE`, `C2`, `S1`, `W1`, flood depth-damage, and wind damage curves) are **illustrative baseline curves** rather than site-calibrated engineering inventories, they are tagged `calibrationStatus: "illustrative_baseline"` and **blocked** from `mode: "production"` publication unless superseded by a locally validated curve registry.
* **Occupancy & Zero-Intensity Invariants**: Distinct flood depth-damage curves exist for `residential_1story`, `residential_2story`, and `commercial`; zero hazard intensity ($IM \le 0$) deterministically returns zero MDR and $P(DS = ds_0) = 1.0$.

---

## 3. Rainfall Screening vs. River Discharge vs. Flood Depth Modelling (C-05 / R-12)

* **Rainfall Screening (`lib/openmeteo.js`, `lib/hydro.js`)**: Precipitation totals (mm) support **meteorological threshold screening only**. The plugin never converts cumulative rainfall directly into fabricated flood inundation depths (`estimatedInundationDepthMeters: null`, `depthStatus: "depth_unavailable"`). Trigger activation requires an explicitly approved `triggerPolicy` and distinct-run persistence checks (`checkForecastPersistence`).
* **River Discharge Screening (`screenRiverDischarge`)**: Supports GloFAS / Open-Meteo flood discharge ($\text{m}^3/\text{s}$) screening against locally approved return-period thresholds with explicit ~5 km river-cell suitability warnings (never labelled as water depth).
* **Inundation Depth Modelling (`ingestValidatedInundationGrid`)**: Depth-based damage estimation requires a separately calibrated hydraulic/inundation depth grid with declared CRS and units.

---

## 4. United Nations Sendai Framework Loss Accounting (C-01, C-02, C-03, R-08)

The plugin enforces strict UNDRR Sendai Framework Monitor (SFM) semantic boundaries in `lib/vulnerability.js` and `lib/sendai.js`:
* **Target B (C-01)**: Modelled housing displacement (`estimatedDisplaced`) is preserved separately from `B-1` directly affected people (`b1DirectlyAffected: null` unless qualified direct evidence is provided) and overlapping `B-1`–`B-5` sub-populations cannot be summed without deduplication methodology.
* **Target C**: Physical replacement loss (`targetC_DirectEconomicLoss`) explicitly records ISO-4217 currency and `valuationYear`; missing values remain `null` rather than `0`.
* **Target D (C-02)**: Physical facility damage (`D-2`..`D-4`) and functional service disruption (`D-6`..`D-8`) are stored independently; service interruption can occur without structural collapse and vice versa.
* **Per-100,000 Normalization & C-03 Governance States**: Relative indicators require an explicit non-zero population denominator (`populationDenominator`). Provenance separates `evidenceBasis` (`modelled` vs `observed` vs `field_reported`), `verificationStatus`, `approvalStatus`, and `reportingEligibility` so human review/approval never mutates `evidenceBasis`.

---

## 5. OASIS Common Alerting Protocol (CAP) v1.2 & Governance (C-07 / R-07)

`lib/cap.js` and `lib/security.js` enforce ITU-T Recommendation X.1303 / OASIS CAP v1.2 (`urn:oasis:names:tc:emergency:cap:1.2`):
* **Safety & Parsing**: Blocks `<!DOCTYPE>` / `<!ENTITY>` / XML bombs via `validateXmlSafety`. Defaults generated alerts to `status: "Draft"` and UTC `+00:00` timestamps. Validates `<references>` on `Update`/`Cancel`/`Ack` and `<addresses>` on `Private` scope alerts.
* **State Separation (C-07)**: Independently tracks `schemaValid`, `profileCompliant`, `authenticityVerified`, `issuerAuthorized`, `publicationApproved`, and `deliveryStatus`.
* **External Validator Evaluation Note (R-07 / [S6])**: We evaluated integrating the World Meteorological Organization (WMO) CAP Validator (`World-Meteorological-Organization/capvalidator`, Python/Flask + XSD/XMLDSig) alongside pure-Node runtime constraints. Because `drr-agent-plugin` enforces a **zero external dependency** Node.js standard library core (`scripts/lint.js`), pure-Node structural, XXE, reference, scope, and coordinate checks run natively in `validateCapXml`, while full XSD/XMLDSig verification can be paired via an optional external WMO CAP Validator microservice under maintainer trust-policy review.

---

## 6. Uncertainty Propagation & Investment Appraisal (R-14 / R-15)

* **Uncertainty (`lib/uncertainty.js`)**: Separates deterministic min/central/max bounds and one-at-a-time (OAT) parameter sensitivity from seeded reproducible Monte Carlo simulation (Mulberry32 PRNG + Box-Muller transform) with split-half convergence checks and explicit distribution provenance requirements.
* **Appraisal (`lib/appraisal.js`)**: Calculates Expected Annual Loss (EAL) via multi-return-period Annual Exceedance Probability ($\text{AEP} = 1/T$) trapezoidal integration (explicitly rejecting single-event losses as EAL) and Cost-Benefit Analysis (NPV, BCR, residual EAL, discount sensitivity), separating quantitative outputs from policy judgement.

---

## 7. Validation Maturity Ladder (L0–L6) & Scope Boundaries

Deterministic computation does not by itself establish operational reliability—uncertainty accumulates across hazard telemetry, ground-motion or depth estimation, fragility curves, and exposure inventories. `drr-agent-plugin` tracks its evidence status explicitly against a seven-tier validation ladder:

| Level | Tier | Current Status | Verification Basis & Scope |
| :--- | :--- | :--- | :--- |
| **L0** | **Software Verified** | ✅ Verified in CI | Pure-stdlib AST lint, zero-dependency enforcement, unit & integration tests, MCP stdio contract tests, and deterministic replay invariants (`npm run check`). |
| **L1** | **Standards Verified** | ✅ Verified in CI | OASIS CAP v1.2 structural/XXE/reference/scope rules, UNDRR-ISC HIP 2020/2025 taxonomy crosswalk, Sendai Target B/C/D semantic separation (`C-01`..`C-03`), and DELTA schema validation. |
| **L2** | **Reference Model Verified** | ✅ Verified in CI | Golden numerical checks against published analytical reference values (Wald et al. 1999 GMICE table points, lognormal fragility/MDR closed-form & HAZUS-style reference points, AEP trapezoidal EAL analytical integrals, and OASIS CAP v1.2 canonical example alerts). |
| **L3** | **Historical Hindcast Validated** | 🟡 Multi-Event Suite in CI *(expanding)* | Frozen multi-event historical hindcast fixtures paired with observed outcome bands (USGS PAGER/ShakeMap, GDACS, EM-DAT/DDPM, and FbF trigger skill metrics: POD, FAR, CSI, uncertainty interval coverage). Not a substitute for country-specific calibration. |
| **L4** | **Independent Domain Review** | ⏳ External / Planned | Formal peer review of hazard, vulnerability, and exposure methodologies by independent seismologists, hydrologists, and DRR specialists. |
| **L5** | **Operational Pilot (Shadow Mode)** | ⏳ Institutional / Planned | Multi-month EOC or DRR agency shadow-mode trial (`--read-only true`) across live hazard events without affecting public decisions. |
| **L6** | **Operational Decision Support** | ⏳ Institutional Only | Requires L4 + L5 completion, locally calibrated exposure/fragility registries, and explicit **human-in-the-loop authority** for CAP publication, FbF release, and official Sendai reporting. |

---

## 8. Parameter Provenance & Domain-of-Validity Limits

| Component | Parameters / Equation | Provenance & Attribution | Domain of Validity & Tectonic / Regional Caveats |
| :--- | :--- | :--- | :--- |
| **Seismic GMICE (`lib/usgs.js`)** | Wald et al. (1999) Eq. 1–2 (`log10(PGA)` vs. MMI) | Published empirical regression: Wald et al. (1999), *Earthquake Spectra* 15(3), Table 1 / USGS ShakeMap `wald99` | Calibrated on **California crustal earthquakes, MMI V–VIII**. Extrapolation outside MMI V–VIII is explicitly flagged (`extrapolated: true`). **Not a GMPE** (no fault distance, focal mechanism, or $V_{s30}$ site amplification). In subduction/megathrust settings (e.g., Philippines, Indonesia, Japan), prefer authoritative ShakeMap PGA/PGV/$V_{s30}$ grids via `drr_fdsn_shakemap_fetch`. |
| **Seismic Fragility (`lib/fragility.js`)** | `URM`, `C1_PRE_CODE`, `C1_MODERATE_CODE`, `C2`, `S1`, `W1` medians ($\theta$) & dispersions ($\beta$); damage factors `0%, 5%, 25%, 60%, 100%` | **Synthetic illustrative baseline ranges** informed by FEMA HAZUS-MH 2.1 Technical Manual (Ch. 5, Table 5.9 structural damage states) and GEM Building Taxonomy v2.0 (Silva et al., 2018) | **Screening only (`calibrationStatus: "illustrative_baseline"`)**; blocked by code from `mode: "production"` until superseded by a locally calibrated national/regional fragility registry. |
| **Flood Depth-Damage (`lib/fragility.js`)** | `residential_1story`, `residential_2story`, `commercial` piecewise depth-damage curves | **Synthetic illustrative baseline ranges** informed by JRC Global Flood Depth-Damage Functions (Huizinga et al., 2017) & FEMA HAZUS-MH Flood Model | Requires a **validated inundation depth grid** (e.g., STAC EO or hydraulic model). Never derived from Open-Meteo rainfall totals (`depthStatus: "depth_unavailable"`). Blocked from `mode: "production"` without local calibration. |
| **Wind Fragility (`lib/fragility.js`)** | Wind-speed MDR curve (`km/h`, `m/s`, `kt` normalized) | **Synthetic illustrative baseline** informed by HAZUS-MH Hurricane Model / GEM wind vulnerability literature | Screening only; does not model storm surge or wind-driven rain ingress separately. Blocked from `mode: "production"` without local calibration. |
| **Humanitarian Severity (`lib/severity.js`)** | 4-pillar weighted composite (`0–10` → Phases `1–5`) | Inspired by OCHA/IASC **JIAF 2.0** and EU JRC **INFORM** risk structure (see Section 9 below for exact weights & departures) | Screening/prioritization index (`reportingEligibility: "screening_only"`). Requires local inter-cluster calibration before operational humanitarian classification. |

---

## 9. Humanitarian Severity Weighting & Departures from JIAF 2.0 / INFORM

`lib/severity.js` (`assessment.humanitarian.severity_v1`) computes a transparent 0–10 composite score mapped to 5 severity phases (`1: Minimal [0–2)`, `2: Stress [2–4)`, `3: Severe [4–6)`, `4: Extreme [6–8)`, `5: Catastrophic [8–10]`):

* **Default Pillar Weights (`DEFAULT_PILLAR_WEIGHTS`)**:
  * `hazardIntensity`: **0.25**
  * `exposure`: **0.30**
  * `vulnerability`: **0.25**
  * `copingCapacityDeficit`: **0.20**
* **Exposure Normalization (`deriveExposurePillar`)**:
  * When `affectedPopulation` and `totalPopulation` are provided: $\min(10, \sqrt{\text{share}} \times 14)$ (so 1% → ~1.4, 10% → ~4.4, 50%+ → ~9.9–10).
  * When only absolute `affectedPopulation` is provided: $\min(10, \log_{10}(\text{pop} + 1) \times 2)$.
  * Missing pillars stay `null` (never coerced to `0`), weights are re-normalized across available pillars with an explicit `dataConfidence` penalty, and **hazard-only scoring is blocked**.
* **Explicit Departures from Published Frameworks**:
  * Full **JIAF 2.0** relies on sector-specific People in Need (PiN) indicators, multi-sector severity convergence rules, and expert inter-cluster consensus rather than a single fixed linear weighted sum.
  * Full **INFORM** uses geometric aggregation across Hazard & Exposure, Vulnerability, and Lack of Coping Capacity (`(H&E × V × LCC)^(1/3)`) over curated national/sub-national indicator sets.
  * `lib/severity.js` intentionally uses an explicit, inspectable linear baseline for rapid screening so analysts can override `weights` and audit every pillar score, and marks all outputs `approvalStatus: "draft"` and `reportingEligibility: "screening_only"`.

---

## 10. Guardrail Enforcement Matrix: Code-Enforced vs. Skill-Prompt Only

Because LLM instructions can be ignored under prompt pressure or model drift, `drr-agent-plugin` explicitly distinguishes **hard code-enforced gates** from **advisory skill instructions**:

| Guardrail / Safety Rule | Enforcement Layer | Where Enforced | Failure Behavior |
| :--- | :--- | :--- | :--- |
| **No flood depth fabricated from rainfall** | **Code-Enforced (Hard)** | `lib/openmeteo.js`, `lib/hydro.js` | Always returns `depthStatus: "depth_unavailable"` and `estimatedInundationDepthMeters: null`. |
| **Missing data preserved (`null` ≠ `0`)** | **Code-Enforced (Hard)** | `lib/contracts.js`, `lib/vulnerability.js`, `lib/severity.js`, `lib/reconcile.js` | Missing numeric fields stay `null`; per-100k metrics require non-zero `referencePopulation`. |
| **CAP defaults to `Draft`; prod publish blocked** | **Code-Enforced (Hard)** | `lib/cap.js`, `lib/security.js` | Defaults to `status: "Draft"`; live publish blocked unless `DRR_ENABLE_PRODUCTION_PUBLISH === "true"` + HMAC approval token bound to payload/destination. |
| **XML XXE / DOCTYPE / SSRF blocking** | **Code-Enforced (Hard)** | `lib/security.js`, `lib/config.js` | Rejects `<!DOCTYPE>`/`<!ENTITY>` XML payloads and private/link-local webhook/API hosts. |
| **Illustrative fragility blocked in production** | **Code-Enforced (Hard)** | `lib/registry.js`, `lib/fragility.js` | Throws error if `mode: "production"` is requested on any `illustrative_baseline` method. |
| **Sendai displacement ≠ `B-1`; physical damage ≠ service disruption** | **Code-Enforced (Hard)** | `lib/vulnerability.js`, `lib/sendai.js` | Sets `b1DirectlyAffected: null` on modelled outputs and rejects conflated submissions in `validateSendaiSubmission`. |
| **Non-silent SitRep conflict preservation** | **Code-Enforced (Hard)** | `lib/reconcile.js` | Preserves all conflicting source records; never promotes `modelled_estimate` or `media_unverified` as official reporting. |
| **Prompt-injection detection on external feeds** | **Code-Enforced (Flag) + Prompt-Guided (Compliance)** | `lib/security.js`, `lib/gdacs.js`, `lib/reconcile.js` | Code sanitizes control chars and sets `promptInjectionFlagged: true`; ignoring injected instructions in prose still depends on the host LLM (tested via `evaluateAgentClaimGrounding`). |
| **Human escalation handoffs (Duty Officer / Hydrologist / Focal Point)** | **Skill-Prompt Only (Advisory)** | `skills/*/SKILL.md` | Instructs the agent when to pause and escalate; cannot physically stop a human or host UI from ignoring the advice outside write-gated tools. |
| **Prefer ShakeMap over GMICE & narrative caveat phrasing** | **Skill-Prompt Only (Advisory) + Eval-Checked** | `skills/early-warning-telemetry/SKILL.md`, `lib/benchmarks.js` | Instructs tool precedence and narrative discipline; audited post-hoc by `runDualLayerEvaluation` / `evaluateAgentClaimGrounding`. |

---

## 11. Authoritative References & Standards
* **UNDRR Sendai Framework Monitor**: *Technical Guidance for Monitoring and Reporting on Progress in Achieving the Global Targets of the Sendai Framework (2015–2030)*. [S1]
* **UNDRR / ISC (2020 & 2025)**: *Hazard Information Profiles (HIPs)* — 2025 revision covering 281 hazards across 8 types. [S2]
* **Wald et al. (1999)**: *Relationships between Peak Ground Acceleration, Peak Ground Velocity, and Modified Mercalli Intensity in California* (Earthquake Spectra / USGS ShakeMap `wald99`). [S3, S4]
* **OASIS / ITU-T**: *Common Alerting Protocol Version 1.2* / *Recommendation X.1303* and *WMO CAP Validator*. [S5, S6]
* **FEMA & GEM**: *HAZUS-MH 2.1 Technical Manuals* & *GEM Building Taxonomy v2.0* (Silva et al., 2018). [S7]
* **JRC (Huizinga et al., 2017)**: *Global Flood Depth-Damage Functions: Methodology and the Database with Guidelines* (EUR 28552 EN).
* **Open-Meteo Flood API**: GloFAS river discharge (~5 km grid) documentation and spatial applicability notes. [S8]
* **Published Validation & Benchmark Results**: See [`docs/validation-results.md`](./validation-results.md), [`docs/operational-playbook.md`](./operational-playbook.md), and [`docs/tool-inventory.md`](./tool-inventory.md).
