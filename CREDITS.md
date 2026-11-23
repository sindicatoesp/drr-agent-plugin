# Credits, Data Sources & Scientific References

The **DRR Analytics Agent Plugin** builds on open humanitarian data, international disaster risk reduction (DRR) standards, and peer-reviewed hazard/fragility methodologies. Recognizing these upstream projects is both good scientific practice and required by open data licenses such as **ODbL-1.0** and **CC BY 4.0**.

---

## 1. Hazard, Weather & Telemetry Data Sources

| Source / Project | Usage in Plugin | License / Terms | Reference |
| :--- | :--- | :--- | :--- |
| **USGS Earthquake Hazards Program (FDSN-WS)** | Real-time earthquake feeds, magnitude, focal depth, MMI, tsunami flags (`lib/usgs.js`) | Public Domain (US Government) | [earthquake.usgs.gov](https://earthquake.usgs.gov/fdsnws/event/1/) |
| **GDACS (UN OCHA & European Commission JRC)** | Global multi-hazard alert feeds (`EQ`, `TC`, `FL`, `VO`, `DR`) (`lib/gdacs.js`) | Open Humanitarian Data | [gdacs.org](https://www.gdacs.org/) |
| **Open-Meteo** | Numerical weather prediction, precipitation & wind forecasts for anticipatory screening (`lib/openmeteo.js`) | CC BY 4.0 (non-commercial) / Commercial API | [open-meteo.com](https://open-meteo.com/) |
| **FDSN (International Federation of Digital Seismograph Networks)** | Custom national/regional FDSN-WS seismic catalogs & ShakeMap bundles (`lib/shakemap.js`) | Open Standard | [fdsn.org](https://www.fdsn.org/) |
| **OGC SensorThings API v1.1** | In-situ hydro-met, tide, and river-gauge telemetry ingestion (`lib/sensorthings.js`) | OGC Open Standard | [ogc.org/standards/sensorthings](https://www.ogc.org/standards/sensorthings/) |
| **STAC (SpatioTemporal Asset Catalog) v1.0.0** | Earth Observation flood-depth and hazard raster discovery (`lib/stac.js`) | Apache-2.0 / Open Spec | [stacspec.org](https://stacspec.org/) |

---

## 2. Exposure, Population & Critical Infrastructure Datasets

| Source / Project | Usage in Plugin | License / Attribution Requirement | Reference |
| :--- | :--- | :--- | :--- |
| **OpenStreetMap & Overpass API** | Interim critical infrastructure fallback across 9 Sendai Target D sectors (`lib/osm-infra.js`, `scripts/build-static-infra.js`) | **ODbL-1.0** — Required attribution: *© OpenStreetMap contributors* | [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright) |
| **OCHA HDX Humanitarian API (HAPI v2) & COD-AB** | Sub-national population baselines, humanitarian indicators, P-code administrative boundaries & areal interpolation (`lib/hdx.js`) | **CC BY-IGO / CC BY 4.0** (per-dataset license preserved in provenance) | [hapi.humdata.org](https://hapi.humdata.org/) · [data.humdata.org](https://data.humdata.org/) |
| **WRI Global Power Plant Database** | Static global energy-sector critical infrastructure builder (`scripts/build-static-infra.js --mode global`) | **CC BY 4.0** — World Resources Institute | [github.com/wri/global-power-plant-database](https://github.com/wri/global-power-plant-database) |
| **OurAirports** | Static global major/medium airport transport infrastructure (`scripts/build-static-infra.js --mode global`) | **Public Domain** | [ourairports.com/data](https://ourairports.com/data/) |
| **Healthsites.io (Global Healthsites Mapping Project)** | Recommended optional static healthcare facility GeoJSON overlay (`--extra-geojson`) | **ODbL-1.0** | [healthsites.io](https://healthsites.io/) |
| **NGA World Port Index** | Recommended optional static maritime port overlay (`--extra-geojson`) | **Public Domain** (US Government) | [msi.nga.mil](https://msi.nga.mil/Publications/WPI) |
| **Geofabrik & HOTOSM** | Recommended regional OpenStreetMap extracts & humanitarian GeoJSON exports | **ODbL-1.0** | [download.geofabrik.de](https://download.geofabrik.de/) · [export.hotosm.org](https://export.hotosm.org/) |

---

## 3. International Frameworks, Standards & Governance

* **UNDRR Sendai Framework for Disaster Risk Reduction (2015–2030)** — Target A (Mortality), Target B (Affected People), Target C (Direct Economic Loss), and Target D (Critical Infrastructure & Basic Services).
* **UNDRR–ISC Hazard Information Profiles (HIPs)** — Standardized multi-hazard classification and crosswalk (`lib/hips.js`, `lib/hips-data.json`).
* **UNDRR DELTA Resilience** — National disaster loss and damage accounting interoperability (`lib/delta.js`).
* **OASIS Common Alerting Protocol (CAP) v1.2 / ITU-T X.1303** — Emergency alert XML generation, validation, and publication governance (`lib/cap.js`).
* **OGC API – Features (OGC 17-069r4)** — Authoritative national/municipal critical infrastructure overlay ingestion (`lib/infra-overlay.js`).
* **Agent Plugins Specification v1.0.0** & **Model Context Protocol (MCP)** — Interoperable AI agent packaging and JSON-RPC 2.0 tool transport (`plugin.json`, `mcp.json`, `bin/mcp-server.js`).

---

## 4. Scientific Models & Methodologies

* **FEMA HAZUS-MH** — Structural fragility curves and earthquake/flood/wind damage state modeling (`lib/fragility.js`, `lib/vulnerability.js`).
* **Global Earthquake Model (GEM) Foundation** — Building taxonomy conventions (`URM`, `C1_PRE_CODE`, `C2_CODE`, `W1`, `S1`, etc.) and exposure modeling concepts.
* **EC JRC Global Flood Depth–Damage Functions** — Huizinga, J., De Moel, H., & Szewczyk, W. (2017), *Global flood depth-damage functions: Methodology and the database with guidelines*, EUR 28552 EN.
* **Ground Motion to Intensity Conversion Equations (GMICE)** — Wald et al. (1999) and Worden et al. (2012) MMI–PGA relations (`lib/usgs.js`, `lib/shakemap.js`).
* **JIAF 2.0 (Joint Intersectoral Analysis Framework) & EC JRC INFORM Severity Index** — Multi-factor humanitarian severity aggregation and 1–5 phase classification (`lib/severity.js`).
* **GeoDisaster Agentic Evaluation Concepts** — Multi-step geospatial disaster-response trajectory benchmarking (`lib/benchmarks.js`, `tests/benchmarks/geodisaster-scenarios.json`).

---

## Attribution Guidance for Downstream Reports

When distributing Situation Briefs, SitReps, or CAP alerts generated by this plugin:
1. Preserve the `provenance` block from `.assessment.json` so every indicator remains traceable to its source, license, and verification status (`external_unverified` / `screening_only` vs. authoritative national registries).
2. Always retain `© OpenStreetMap contributors (ODbL-1.0)` when OSM interim or regional extracts are used, and `CC BY 4.0` notices for WRI, Open-Meteo, and HDX datasets.
