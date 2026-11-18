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

## 7. Authoritative References & Standards
* **UNDRR Sendai Framework Monitor**: *Technical Guidance for Monitoring and Reporting on Progress in Achieving the Global Targets of the Sendai Framework (2015–2030)*. [S1]
* **UNDRR / ISC (2020 & 2025)**: *Hazard Information Profiles (HIPs)* — 2025 revision covering 281 hazards across 8 types. [S2]
* **Wald et al. (1999)**: *Relationships between Peak Ground Acceleration, Peak Ground Velocity, and Modified Mercalli Intensity in California* (Earthquake Spectra / USGS ShakeMap `wald99`). [S3, S4]
* **OASIS / ITU-T**: *Common Alerting Protocol Version 1.2* / *Recommendation X.1303* and *WMO CAP Validator*. [S5, S6]
* **FEMA & GEM**: *HAZUS-MH 2.1 Technical Manuals* & *GEM Building Taxonomy v2.0* (Silva et al., 2018). [S7]
* **Open-Meteo Flood API**: GloFAS river discharge (~5 km grid) documentation and spatial applicability notes. [S8]
* **Operational Playbook**: See [`docs/operational-playbook.md`](./operational-playbook.md) and [`docs/tool-inventory.md`](./tool-inventory.md).
