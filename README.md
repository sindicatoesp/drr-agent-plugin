# Disaster Risk Reduction (DRR) Agent Plugin

[![Agent Plugins Standard](https://img.shields.io/badge/Agent_Plugins-v1.0.0-blue.svg)](https://agent-plugins.org/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0_external-brightgreen.svg)]()

A standalone, multi-platform AI Agent Plugin for **Disaster Risk Reduction (DRR) analytics**, built to the [agent-plugins.org](https://agent-plugins.org/) open specification.

This plugin equips AI coding assistants and autonomous agents with domain knowledge skills and deterministic tools for:
* **Multi-Source Hazard Feeds**:
  * **GDACS**: Live and offline UN OCHA / EC DG ECHO alerts for earthquakes, tropical cyclones, floods, and volcanoes.
  * **USGS**: Real-time Earthquake Hazards Program feeds with automated Peak Ground Acceleration (PGA in $g$) estimation from MMI via Wald et al. (1999) ground motion equations.
  * **Open-Meteo**: Global numerical weather forecasts (ECMWF, GFS, ICON) with Anticipatory Action cumulative precipitation thresholds and flood triggers.
* **Deterministic Spatial Exposure Joins**: Ray-casting point-in-polygon and buffer queries intersecting hazard footprints with exposed populations, schools, and hospitals.
* **GEM & HAZUS Physical Fragility Modeling**: Lognormal damage state probability distributions and Mean Damage Ratios (MDR) for earthquakes (PGA), floods (inundation depth), and cyclones (wind speed).
* **Sendai Framework Loss Accounting**: Automatic mapping to Sendai Targets B (affected/displaced population), C (direct economic loss), and D (critical infrastructure disruption).
* **OASIS Common Alerting Protocol (CAP) v1.2**: ITU-T X.1303 compliant XML emergency alert generation and validation, plus multi-agency situation briefs.

---

## Real-World Operations: When & By Whom

For the detailed operational guide, see **[docs/operational-playbook.md](docs/operational-playbook.md)**.

### Target Personas ("By Whom")
* **EOC Duty Officers & Watchstanders** (National Disaster Management Agencies): Rapid situation awareness, triggering public CAP broadcasts, and immediate search-and-rescue prioritization within the first 2 hours of a shock.
* **Anticipatory Action Leads** (Red Cross/Crescent, WFP, Start Network): Verifying forecast-based financing (FbF) triggers 48–72h before a flood or cyclone peaks to release prepositioning funds.
* **UN Humanitarian Affairs Officers** (UN OCHA / UNDAC): Compiling standardized Situation Reports (SitReps) and cluster briefings within the first 6–24 hours of an emergency.
* **National Disaster Loss Focal Points** (UNDRR DELTA): Auditing and mapping post-event losses to UN Sendai Framework Targets (Target B: displacement, C: direct economic loss, D: critical infrastructure damage).
* **Municipal Resilience Engineers** (City Planning / Public Works): Running tabletop earthquake or flood scenarios against local building stock (GEM/HAZUS taxonomy) to prioritize retrofitting.

### Emergency Scenarios ("When")

| Operational Phase | Real-World Scenario | Primary Toolchain | Output / Deliverable |
| :--- | :--- | :--- | :--- |
| **Pre-Disaster**<br>*(T -72h to -24h)* | **Anticipatory Action Flood Early Warning**<br>Atmospheric river or monsoon depression detected. | `drr_openmeteo_forecast` + `drr_spatial_exposure_join` | Trigger verification, shelter standby alerts, pre-disaster evacuation directives. |
| **Co-Disaster**<br>*(T +5m to +2h)* | **Sudden-Onset M7+ Earthquake**<br>Shaking felt across populated provinces. | `drr_usgs_earthquake_fetch` + `drr_fragility_eval` + `drr_cap_alert_generate_validate` | Wald GMPE PGA estimate, structural failure probabilities, OASIS CAP v1.2 XML for cell broadcasts. |
| **Co-Disaster**<br>*(T +6h to +48h)* | **Category 4 Tropical Cyclone Landfall**<br>Catastrophic wind damage along coastal swath. | `drr_gdacs_fetch` + `drr_spatial_exposure_join` + `drr_vulnerability_matrix_calc` | Hospital & bridge damage audit, priority medical deployment list, 24h SitRep brief. |
| **Post-Disaster**<br>*(T +2w to +3m)* | **Sendai Framework Loss Accounting**<br>End-of-year national reporting to UN. | `drr_vulnerability_matrix_calc` + DELTA Resilience DB | Official Sendai Monitor Target B, C, and D loss indicators. |

---

## Architecture & Layout

```text
drr-agent-plugin/
├── plugin.json                 # agent-plugins.org v1.0.0 manifest (v1.2.0)
├── mcp.json                    # Model Context Protocol stdio server declaration
├── package.json                # Standalone Node package definition
├── .env.example                # Configuration template
├── README.md                   # Master documentation
├── LICENSE                     # Apache 2.0
├── bin/
│   ├── mcp-server.js           # Zero-dependency Node.js MCP server (9 active tools)
│   └── cli.js                  # Direct command-line interface for shell & CI/CD
├── lib/                        # Deterministic computational engines
│   ├── config.js               # Centralized configuration & lightweight .env loader
│   ├── gdacs.js                # GDACS feed parser & ingestor
│   ├── usgs.js                 # USGS earthquake feed & MMI-to-PGA estimator
│   ├── openmeteo.js            # Open-Meteo precipitation & flood risk engine
│   ├── delta.js                # DELTA Resilience two-way draft record writer
│   ├── spatial.js              # Ray-casting point-in-polygon & spatial exposure joins
│   ├── fragility.js            # GEM & HAZUS lognormal fragility curves
│   ├── vulnerability.js        # Vulnerability matrix & Sendai Target B/C/D calculators
│   ├── cap.js                  # OASIS CAP v1.2 XML generator & validator
│   └── utils.js                # Math (erf, normal CDF, haversine distance)
├── skills/                     # Reusable AI Agent Skills (SKILL.md)
│   ├── delta-disaster-recording/
│   ├── early-warning-telemetry/
│   ├── hazard-exposure-modeling/
│   ├── vulnerability-matrix/
│   ├── oasis-cap-alerting/
│   └── gdacs-feed-ingestion/
├── examples/                   # Executable real-world scenarios & fixtures
│   ├── earthquake-hazus-scenario/
│   ├── flood-gdacs-exposure/
│   └── cyclone-emergency-brief/
├── docs/                       # Comprehensive documentation
│   ├── configuration.md        # Environment variables, proxy & settings guide
│   ├── operational-playbook.md # Playbook: When & By Whom to run the plugin
│   ├── api-reference.md        # MCP tool schemas & CLI options
│   ├── methodology.md          # Scientific background & standards
│   └── platforms/              # Per-platform installation guides
│       ├── antigravity.md
│       ├── cursor.md
│       ├── claude-code.md
│       ├── github-copilot.md
│       └── opencode-cli.md
└── tests/                      # Full automated test suite (9 test suites)
    ├── test-config.js
    ├── test-spatial.js
    ├── test-fragility.js
    ├── test-vulnerability.js
    ├── test-cap.js
    ├── test-usgs.js
    ├── test-openmeteo.js
    ├── test-delta.js
    ├── test-mcp-server.js
    └── run-all-tests.sh
```

---

## Quickstart

### Prerequisites
* Node.js $\ge 18.0.0$ (Zero external npm packages required — pure standard library).

### 1. Run All Automated Tests
```bash
bash tests/run-all-tests.sh
```

### 2. Command-Line Interface (CLI) Usage
```bash
# Query USGS Earthquakes (M5.5+):
node bin/cli.js usgs --min-mag 5.5

# Query Open-Meteo Forecast & Anticipatory Action Flood Risk:
node bin/cli.js forecast --lat 23.8 --lon 90.4 --days 5

# Calculate earthquake fragility for Unreinforced Masonry (URM) at 0.40g PGA:
node bin/cli.js fragility --hazard earthquake --intensity 0.40 --taxonomy URM

# Run a complete spatial exposure join:
node bin/cli.js spatial-join \
  --hazard examples/earthquake-hazus-scenario/input-hazard.json \
  --exposure examples/earthquake-hazus-scenario/input-exposure.json

# Generate an OASIS CAP v1.2 XML alert:
node bin/cli.js cap-generate \
  --headline "EARTHQUAKE WARNING: Mw 7.2 Mainshock" \
  --severity Extreme \
  --urgency Immediate \
  --event "Major Earthquake Emergency Alert"

# Validate a CAP XML file:
node bin/cli.js cap-validate examples/earthquake-hazus-scenario/output-cap-alert.xml
```

---

## MCP Server Tools (9 Tools)

| Tool Name | Description | Source / Methodology |
| :--- | :--- | :--- |
| `drr_gdacs_fetch` | Query active global alerts by severity/type | GDACS GeoJSON API |
| `drr_usgs_earthquake_fetch` | Ingest real-time seismic events & estimate PGA ($g$) | USGS FDSN-WS / Wald et al. GMPE |
| `drr_openmeteo_forecast` | Weather forecast & Anticipatory Action flood triggers | Open-Meteo Multi-Model API |
| `drr_spatial_exposure_join` | Deterministic point-in-polygon spatial exposure join | Ray-casting & BBox algorithms |
| `drr_fragility_eval` | Damage state probabilities & Mean Damage Ratio (MDR) | GEM Taxonomy & HAZUS-MH 2.1 |
| `drr_vulnerability_matrix_calc`| Composite vulnerability & Sendai Targets B, C, D | UNDRR SFM Loss Accounting |
| `drr_cap_alert_generate_validate`| Generate & validate ITU-T X.1303 CAP XML / briefs | OASIS CAP v1.2 Specification |
| `drr_delta_push_draft_record` | Push validated assessment to DELTA as a Draft record | DELTA Resilience API / MCP |
| `drr_delta_fetch_exposure` | Query administrative divisions & exposure from DELTA | DELTA Resilience Data Layer |

---

## Configuration & Environment Settings

All API endpoints, network proxies, request timeouts, and operational modes are configurable via environment variables or a `.env` file.

* **Configuration Template**: See [`.env.example`](.env.example) to copy and customize.
* **Full Settings Reference**: See **[docs/configuration.md](docs/configuration.md)** for detailed documentation on:
  * Overriding GDACS, USGS, and Open-Meteo API endpoints or mirrors
  * Configuring commercial Open-Meteo API keys
  * Setting up `HTTP_PROXY` / `HTTPS_PROXY` for UN / enterprise firewalls
  * Enabling `DRR_OFFLINE_MODE` for air-gapped EOC centers
  * Connecting to core DELTA Resilience via `DELTA_MCP_API_KEY`

---

## Platform Installation Guides

* **[Google Antigravity Guide](docs/platforms/antigravity.md)**
* **[Cursor IDE Guide](docs/platforms/cursor.md)**
* **[Claude Code & Desktop Guide](docs/platforms/claude-code.md)**
* **[GitHub Copilot & VS Code Guide](docs/platforms/github-copilot.md)**
* **[OpenCode & Terminal CLI Guide](docs/platforms/opencode-cli.md)**

---

## Standards Conformance

* **Package Standard**: [Agent Plugins v1.0.0](https://agent-plugins.org/) (`plugin.json`, `mcp.json`, `skills/`).
* **Tool Protocol**: [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) JSON-RPC 2.0 stdio transport (`2024-11-05`).
* **Alerting Standard**: OASIS Common Alerting Protocol v1.2 / ITU-T Recommendation X.1303.
* **Fragility Curves**: GEM Building Taxonomy v2.0 & FEMA HAZUS-MH 2.1 Multi-hazard Loss Methodology.
* **Disaster Loss Reporting**: UN Sendai Framework for Disaster Risk Reduction (2015–2030) Targets A, B, C, and D.
