# Operational Playbook: When & By Whom to Run the DRR Agent Plugin

This playbook outlines real-world operational scenarios, emergency management timelines, stakeholder personas, and step-by-step agent workflows across the disaster risk reduction lifecycle.

---

## 1. Stakeholder Personas ("By Whom")

| Persona / Role | Organization / Setting | Primary Purpose for Using the Plugin |
| :--- | :--- | :--- |
| **EOC Duty Officer & Watchstander** | National Disaster Management Agencies (e.g. FEMA, BNPB Indonesia, NDRRMC Philippines, Civil Defense) | Rapid situational awareness, triggering public OASIS CAP sirens/broadcasts, and tactical search-and-rescue prioritization within the first 2 hours of a shock. |
| **Anticipatory Action Lead** | Red Cross / Red Crescent Climate Centre, WFP, Start Network | Verifying forecast-based financing (FbF) triggers 48–72h before a flood or cyclone peaks to release pre-allocated contingency funds. |
| **UN Humanitarian Affairs Officer** | UN OCHA (Office for the Coordination of Humanitarian Affairs) | Synthesizing standardized Situation Reports (SitReps), cluster briefings, and Flash Appeals within the first 6–24 hours of an emergency. |
| **National Disaster Loss Focal Point** | Ministry of Environment / Civil Defense reporting to UNDRR DELTA | Auditing and mapping post-event losses to UN Sendai Framework Targets (Target B: displacement, C: direct economic loss, D: critical infrastructure damage). |
| **Municipal Structural & Resilience Engineer** | City Urban Planning Department / Public Works | Running tabletop earthquake or flood scenarios against the local building stock (GEM/HAZUS taxonomy) to prioritize retrofitting investments. |

---

## 2. Real-World Operational Scenarios ("When")

```text
       PRE-DISASTER                                 CO-DISASTER                                  POST-DISASTER
┌───────────────────────────┐                ┌───────────────────────────┐                ┌───────────────────────────┐
│ Anticipatory Action       │                │ Rapid Response & Warnings │                │ Sendai Accounting         │
│ (T minus 72h to 24h)      │ ─────────────► │ (T plus 5m to 48h)        │ ─────────────► │ (T plus 2w to 3m)         │
│ Open-Meteo flood triggers │                │ USGS / GDACS / CAP alerts │                │ Targets B, C, D reporting │
└───────────────────────────┘                └───────────────────────────┘                └───────────────────────────┘
```

### Scenario 1: Anticipatory Action Before a Severe Flood (T minus 72h to 24h)
* **Trigger Event**: A multi-model meteorological forecast detects an atmospheric river or monsoon depression.
* **Primary Operator**: Forecast-based Financing (FbF) and Early Warning Coordinators.
* **Operational Workflow**:
  1. **Forecast Ingestion**: The operator prompts the agent to run `drr_openmeteo_forecast` for the vulnerable river basin coordinates.
  2. **Threshold Verification**: If 72-hour precipitation forecast exceeds the **Red Alert threshold ($\ge 200\text{mm}$)**, the plugin estimates peak daily rainfall and inundation depth (e.g. 1.8m).
  3. **Spatial Intersection**: The agent calls `drr_spatial_exposure_join` with local community flood shelters, water purification plants, and access roads.
  4. **Anticipatory Action**: The agent verifies the early action trigger, releasing pre-allocated emergency funds and drafting public evacuation advisories before floodwaters crest.

### Scenario 2: Sudden-Onset M7+ Earthquake (T plus 5 min to 2 hours)
* **Trigger Event**: A major earthquake strikes with ground shaking felt across multiple provinces.
* **Primary Operator**: National Emergency Operations Center (EOC) Watchstanders.
* **Operational Workflow**:
  1. **Hypocenter Query**: The duty officer queries `drr_usgs_earthquake_fetch` to retrieve the revised hypocenter, magnitude, and Instrumental Intensity (MMI).
  2. **PGA Calculation**: The plugin converts MMI to **Peak Ground Acceleration ($\text{PGA}$ in $g$)** using the Wald GMPE engine:
     $$\text{PGA} = \frac{10^{(\text{MMI} + 1.66) / 3.66}}{980.665} \quad (\text{for } \text{MMI} \ge \text{V})$$
  3. **Structural Fragility Assessment**: The agent executes `drr_fragility_eval` against the local building stock (e.g. non-ductile concrete frame `C1_PRE_CODE` and unreinforced masonry `URM`).
  4. **Public Warning & Command Briefing**: Within minutes, the agent generates an **OASIS CAP v1.2 XML alert** (`drr_cap_alert_generate_validate`) for cellular broadcast and drafts a command situation brief for civil protection authorities.

### Scenario 3: Tropical Cyclone Landfall & Immediate Search & Rescue (T plus 6h to 48h)
* **Trigger Event**: A Category 4 tropical cyclone crosses coastlines or island chains.
* **Primary Operator**: UN Disaster Assessment and Coordination (UNDAC) and Civil Defense.
* **Operational Workflow**:
  1. **Footprint Extraction**: The analyst feeds the GDACS cyclone wind swath (`drr_gdacs_fetch`) into `drr_spatial_exposure_join`.
  2. **Critical Infrastructure Audit**: The tool intersects the footprint with provincial hospitals, power substations, and bridge coordinates.
  3. **Vulnerability Evaluation**: `drr_vulnerability_matrix_calc` calculates facilities with high structural failure probabilities ($\text{MDR} \ge 60\%$).
  4. **Tactical Deployment**: The agent outputs an operational brief detailing compromised hospitals, directing mobile surgical teams and tactical satellite communications to the most damaged facilities.

### Scenario 4: Annual Sendai Framework Loss Reporting to the UN (Peace Time / Recovery)
* **Trigger Event**: End-of-year national disaster accounting or Post-Disaster Needs Assessment (PDNA).
* **Primary Operator**: UNDRR National Focal Points and Ministry Economists using DELTA Resilience.
* **Operational Workflow**:
  1. **Loss Reconciliation**: Disaster records are checked against the deterministic fragility models to reconcile insured vs. uninsured infrastructure losses.
  2. **Target Mapping**: The plugin maps the aggregate losses directly into:
     * **Sendai Target B**: Displaced and shelter-dependent populations.
     * **Sendai Target C**: Direct physical asset damage in USD.
     * **Sendai Target D**: Disrupted basic service facilities (schools and hospitals).
  3. **DELTA Ingestion**: Results are committed directly into DELTA's database for official submission to the UN General Assembly.

---

## 3. Quick Operator Prompt Cheatsheet

### For EOC Watchstanders (USGS Earthquake & CAP Alert)
```text
Query the USGS feed for any M6.0+ earthquakes in the region over the last 2 hours.
Extract the estimated PGA for the epicenter, evaluate fragility on URM and C1 buildings,
and generate an OASIS CAP v1.2 XML emergency warning for the provincial cell broadcast.
```

### For Anticipatory Action Leads (Open-Meteo Flood Trigger)
```text
Fetch the 5-day precipitation forecast for coordinates lat 23.8, lon 90.4 using Open-Meteo.
Check if the Anticipatory Action flood trigger threshold is exceeded.
If Red Alert, intersect with our critical facilities GeoJSON and estimate damaged infrastructure.
```

### For UN OCHA Officers (GDACS & Situation Brief)
```text
Ingest the latest GDACS Orange and Red alerts for the South Pacific.
Perform a spatial join against our health clinics and shelter coordinates,
and synthesize a 24-hour Emergency Situation Brief in Markdown.
```
