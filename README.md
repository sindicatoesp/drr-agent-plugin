# Disaster Risk Reduction (DRR) Agent Plugin

[![Agent Plugins Standard](https://img.shields.io/badge/Agent_Plugins-v1.0.0-blue.svg)](https://agent-plugins.org/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-green.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0_external-brightgreen.svg)]()
[![CI](https://github.com/sindicatoesp/drr-agent-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/sindicatoesp/drr-agent-plugin/actions/workflows/ci.yml)

A standalone, multi-platform AI Agent Plugin for **Disaster Risk Reduction (DRR) analytics**, built to the [agent-plugins.org](https://agent-plugins.org/) open specification.

This plugin equips AI coding assistants and autonomous agents with sourced domain knowledge skills and deterministic, provenance-tracked tools for:
* **Multi-Source Hazard Telemetry & Screening**:
  * **GDACS**: Active UN OCHA / EC DG ECHO alerts for earthquakes, tropical cyclones, floods, and volcanoes with untrusted-feed prompt-injection sanitization.
  * **USGS**: Real-time Earthquake Hazards Program feeds estimating Peak Ground Acceleration (PGA in $g$) from MMI via **Wald et al. (1999) GMICE** (with empirical MMI V–VIII applicability & extrapolation flags).
  * **Open-Meteo & Hydrological Adapters**: Multi-model precipitation screening (never fabricating flood depths from rainfall alone; returns `depthStatus: "depth_unavailable"` without a calibrated depth grid) and **GloFAS river discharge** ($\text{m}^3/\text{s}$) screening with river-cell suitability checks.
* **Spatial Correctness, CRS & Raster Exposure**: Boundary-inclusive, hole-aware, antimeridian-safe point-in-polygon joins, geodesic buffers, opt-in auditable geometry repair (`originalGeometry` preserved), WGS84 / WebMercator / UTM transformations, and count-vs-density-vs-continuous raster zonal statistics.
* **Illustrative Physical Fragility & Registered Methods**: Log-normal damage state curves and Mean Damage Ratios (MDR) registered in `MODEL_REGISTRY` with explicit unit conversions (`g`, `m/s2`, `m`, `ft`, `km/h`, `m/s`, `kt`) and production gates blocking uncalibrated illustrative curves.
* **Sendai Framework Semantic Accounting (C-01..C-03)**: Strict separation of modelled displacement from `B-1` directly affected people, physical facility damage (`D-2`..`D-4`) from service disruption (`D-6`..`D-8`), independent evidence/verification/approval/eligibility states, and missing-data preservation (`null` vs `0`).
* **OASIS CAP v1.2 Alerting & Publication Controls**: XXE-hardened XML parser/generator defaulting to `Draft` status with separated validity, authenticity, issuer authorization, publication approval, and channel safety enforcement (`DRR_ENABLE_PRODUCTION_PUBLISH !== 'true'` by default).
* **Crosswalk, Deduplication, Uncertainty & Investment Appraisal**: Versioned UNDRR-ISC HIP crosswalks, reversible multi-source event deduplication, deterministic bounds + seeded Monte Carlo uncertainty propagation, Expected Annual Loss (EAL), and Cost-Benefit Analysis (CBA).

---

## Authoritative Inventory & Governance

* **Programmatic Inventory**: See **[docs/tool-inventory.md](docs/tool-inventory.md)** (generated from registration code via `npm run generate:inventory`, referencing `origin/dev` commit `1d7600ce5cc50dcdea7b438ccbd59d28282793dd`).
* **MCP & CLI Specification**: See **[docs/api-reference.md](docs/api-reference.md)** (29 MCP tools and 29 CLI commands).
* **Scientific Methodology & Boundaries**: See **[docs/methodology.md](docs/methodology.md)**.
* **Operational Playbook**: See **[docs/operational-playbook.md](docs/operational-playbook.md)**.

### Directory Structure & Layout

```text
drr-agent-plugin/
├── plugin.json                 # agent-plugins.org v1.0.0 manifest
├── mcp.json                    # Model Context Protocol stdio server declaration
├── package.json                # Standalone Node package definition (0 external deps)
├── Makefile                    # Operational & configuration shortcuts
├── Dockerfile                  # Production Alpine container (~130MB, zero deps)
├── docker-compose.yml          # Autonomous daemon stack & volume persistence
├── .env.example                # Configuration template
├── alerts-config.example.json  # Declarative early warning threshold rules
├── README.md                   # Master documentation
├── LICENSE                     # Apache 2.0
├── bin/
│   ├── mcp-server.js           # Zero-dependency Node.js MCP server (29 active tools)
│   ├── cli.js                  # Direct CLI for shell & CI/CD (29 subcommands)
│   └── serve.js                # Local static preview server
├── lib/                        # Pure stdlib computational & governance modules (21 modules)
│   ├── contracts.js            # Input contracts, unit conversions, C-03 provenance manifests (R-02/R-03)
│   ├── registry.js             # Scientific method registry & illustrative vs production gate (R-04)
│   ├── replay.js               # Frozen-input synthetic & hindcast replay validation (R-05)
│   ├── security.js             # Approval tokens, channel/tenant/destination policy, XXE & text guard (R-06)
│   ├── sendai.js               # Sendai Target B/C/D semantic & per-100k validator (R-08)
│   ├── hips.js                 # Versioned UNDRR-ISC HIP taxonomy crosswalk & 2025 flags (R-09)
│   ├── events.js               # Multi-source event identity, deduplication & reversible merges (R-10)
│   ├── spatial.js              # Antimeridian/hole joins, validation, repair, CRS & raster stats (R-11)
│   ├── hydro.js                # Basin rainfall aggregation, GloFAS discharge screening, grid ingest (R-12)
│   ├── uncertainty.js          # Deterministic bounds, OAT sensitivity & seeded Monte Carlo (R-14)
│   ├── appraisal.js            # Trapezoidal AEP Expected Annual Loss & Cost-Benefit Analysis (R-15)
│   ├── fragility.js            # Registered illustrative GEM/HAZUS curves & unit normalization
│   ├── vulnerability.js        # Composite loss matrix respecting C-01..C-03 & null unknowns
│   ├── cap.js                  # OASIS CAP v1.2 XML generator, XXE-safe validator & pub adapter
│   ├── delta.js                # DELTA relational writer, DTS schema validator & tenant guard
│   ├── gdacs.js                # GDACS feed ingestor with untrusted-text sanitization & hashes
│   ├── usgs.js                 # USGS seismic ingestor & Wald99 GMICE PGA conversion
│   ├── openmeteo.js            # Open-Meteo rainfall screening & persistence/triggerPolicy gates
│   ├── monitor.js              # Autonomous early warning monitor with deduplication & Draft CAP
│   ├── config.js               # Centralized configuration & .env parser
│   ├── utils.js                # Math, spherical geometry, boundary & antimeridian helpers
│   └── index.js                # Unified barrel export
├── scripts/
│   ├── lint.js                 # Static AST, JSON, inline JS & stdlib-only verifier
│   ├── generate-inventory.js   # Programmatic generator for docs/tool-inventory.md (R-01)
│   └── install-git-hook.js     # Pre-commit hook installer
├── skills/                     # 13 Reusable AI Agent Skills (SKILL.md)
│   ├── cap-governance-and-approval/
│   ├── delta-disaster-recording/
│   ├── drr-data-quality-and-provenance/
│   ├── early-warning-telemetry/
│   ├── event-identity-and-linkage/
│   ├── forecast-based-action-trigger-design/
│   ├── gdacs-feed-ingestion/
│   ├── hazard-exposure-modeling/
│   ├── oasis-cap-alerting/
│   ├── risk-reduction-options-appraisal/
│   ├── sendai-indicator-accounting/
│   ├── undrr-hip-hazard-classification/
│   └── vulnerability-matrix/
├── examples/                   # Executable real-world scenarios & fixtures
└── tests/                      # Full automated test suite (18 test suites)
    └── run-all-tests.sh
```

---

## Quickstart

### Prerequisites
* Node.js >= 18.0.0 (Zero external npm packages required — pure standard library).

### 1. Run Lint, Inventory & All Automated Tests
```bash
npm run check
npm run generate:inventory
```

### 2. Direct Command-Line Interface (CLI) Highlights
For all 29 MCP tools and 29 CLI subcommands, see **[docs/api-reference.md](docs/api-reference.md)** and **[docs/tool-inventory.md](docs/tool-inventory.md)**.

```bash
# Real-time telemetry & screening
node bin/cli.js usgs --min-mag 5.0 --limit 10
node bin/cli.js forecast --lat -6.2 --lon 106.8 --days 5
node bin/cli.js gdacs --min-level Orange

# Contracts, registry, replay & Sendai semantics
node bin/cli.js registry
node bin/cli.js replay-validate --suite all
node bin/cli.js hazard-crosswalk --query EQ --source GDACS

# Deterministic fragility, spatial joins & CAP generation (defaults to Draft)
node bin/cli.js fragility --hazard earthquake --intensity 0.40 --taxonomy URM
node bin/cli.js spatial-join \
  --hazard examples/earthquake-hazus-scenario/input-hazard.json \
  --exposure examples/earthquake-hazus-scenario/input-exposure.json
node bin/cli.js vulnerability \
  --spatial examples/thailand-flood-scenario/spatial-report.json \
  --hazard flood --intensity 2.2
node bin/cli.js cap-generate \
  --headline "EARTHQUAKE WARNING: Mw 7.2 Mainshock" \
  --severity Extreme --urgency Immediate --event "Major Earthquake Emergency Alert"
```

---

## MCP Server Tools (29 Tools)

The MCP server (`bin/mcp-server.js`) exposes **29 deterministic, provenance-aware tools**:

| Category | MCP Tools |
| :--- | :--- |
| **Telemetry & Hydrology** | `drr_gdacs_fetch`, `drr_usgs_earthquake_fetch`, `drr_openmeteo_forecast`, `drr_basin_rainfall_aggregate`, `drr_river_discharge_screen`, `drr_monitor_check` |
| **Contracts, Governance & Replay** | `drr_input_contract_validate`, `drr_source_provenance_manifest`, `drr_model_registry_list`, `drr_assessment_replay_validate` |
| **Spatial, CRS & Raster** | `drr_spatial_exposure_join`, `drr_geojson_validate`, `drr_geometry_repair`, `drr_crs_transform`, `drr_raster_zonal_stats` |
| **Fragility, Loss & Sendai** | `drr_fragility_eval`, `drr_vulnerability_matrix_calc`, `drr_sendai_validate` |
| **Taxonomy & Event Identity** | `drr_hazard_crosswalk`, `drr_event_match_deduplicate` |
| **CAP & DELTA Interoperability** | `drr_cap_alert_generate_validate`, `drr_cap_publish`, `drr_delta_push_draft_record`, `drr_delta_fetch_exposure`, `drr_delta_docs`, `drr_delta_schema_validate` |
| **Uncertainty & Appraisal** | `drr_uncertainty_propagate`, `drr_expected_annual_loss`, `drr_mitigation_cost_benefit` |

See **[docs/tool-inventory.md](docs/tool-inventory.md)** for auto-generated per-tool parameter schemas and test mappings.

---

## Configuration & Platform Installation Guides

* **[Configuration Reference](docs/configuration.md)** (`.env`, `TARGET_COUNTRIES`, `DELTA_COUNTRY_STRICT`, `DRR_ENABLE_PRODUCTION_PUBLISH`, `DRR_OFFLINE_MODE`)
* **[Google Antigravity](docs/platforms/antigravity.md)** | **[Cursor IDE](docs/platforms/cursor.md)** | **[Claude Code](docs/platforms/claude-code.md)** | **[GitHub Copilot](docs/platforms/github-copilot.md)** | **[OpenCode CLI](docs/platforms/opencode-cli.md)**

---

## Standards Conformance

* **Package Standard**: [Agent Plugins v1.0.0](https://agent-plugins.org/) (`plugin.json`, `mcp.json`, `skills/`).
* **Tool Protocol**: [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) JSON-RPC 2.0 stdio transport (`2024-11-05`).
* **Alerting Standard**: OASIS Common Alerting Protocol v1.2 / ITU-T Recommendation X.1303.
* **Hazard Taxonomy**: UNDRR-ISC Hazard Information Profiles (HIP 2020 + 2025 revision flags).
* **Disaster Loss Reporting**: UN Sendai Framework for Disaster Risk Reduction (2015–2030) Targets A, B, C, and D.
