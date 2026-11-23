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

* **End-User Skills & Prompting Guide**: See **[docs/skills-guide.md](docs/skills-guide.md)** (ready-to-use prompt examples & specific DRR use cases for all **19 domain skills**, plus multi-skill chains).
* **Machine-Readable Skills Manifest**: See **[skills-manifest.json](skills-manifest.json)** (auto-generated skill catalog with safety tiers and validated MCP tool bindings).
* **Programmatic Inventory**: See **[docs/tool-inventory.md](docs/tool-inventory.md)** (generated directly from executable registration sources via `npm run generate:inventory`).
* **MCP & CLI Specification**: See **[docs/api-reference.md](docs/api-reference.md)** (37 MCP tools and 37 CLI commands).
* **Scientific Methodology & Boundaries**: See **[docs/methodology.md](docs/methodology.md)**.
* **Operational Playbook**: See **[docs/operational-playbook.md](docs/operational-playbook.md)**.

### Directory Structure & Layout

```text
drr-agent-plugin/
├── plugin.json                 # agent-plugins.org v1.0.0 manifest
├── mcp.json                    # Model Context Protocol stdio server declaration
├── skills-manifest.json        # Machine-readable skills catalog with safety tiers & tool bindings
├── package.json                # Standalone Node package definition (0 external deps)
├── Makefile                    # Operational & configuration shortcuts (Linux/macOS)
├── make.bat                    # Windows CMD/PowerShell equivalent of Makefile (e.g. make run, make check)
├── Dockerfile                  # Production Alpine container (~130MB, zero deps)
├── docker-compose.yml          # Autonomous daemon stack & volume persistence
├── .env.example                # Configuration template
├── alerts-config.example.json  # Declarative early warning threshold rules
├── README.md                   # Master documentation
├── LICENSE                     # Apache 2.0
├── bin/
│   ├── mcp-server.js           # Zero-dependency Node.js MCP server (37 active tools)
│   ├── cli.js                  # Direct CLI for shell & CI/CD (37 subcommands)
│   └── serve.js                # Local static preview server
├── lib/                        # Pure stdlib computational & governance modules (31 JS modules + HIP data)
│   ├── contracts.js            # Input contracts, unit conversions, C-03 provenance manifests (R-02/R-03)
│   ├── registry.js             # Scientific method registry & illustrative vs production gate (R-04)
│   ├── replay.js               # Frozen-input synthetic & hindcast replay validation (R-05)
│   ├── security.js             # Approval tokens, channel/tenant/destination policy, XXE & text guard (R-06)
│   ├── sendai.js               # Sendai Target B/C/D semantic & per-100k validator (R-08)
│   ├── hips.js                 # Versioned UNDRR-ISC HIP taxonomy crosswalk & 2025 flags (R-09)
│   ├── hips-data.json          # Bundled UNDRR-ISC HIP taxonomy crosswalk dataset
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
│   ├── sensorthings.js         # OGC SensorThings API v1.1 custom gauge telemetry adapter
│   ├── stac.js                 # STAC v1.0.0 EO hazard catalog & validated flood depth grid adapter
│   ├── shakemap.js             # Custom national FDSN-WS & ShakeMap PGA/Vs30 contour/grid adapter
│   ├── infra-overlay.js        # Sendai Target D 9-sector critical infrastructure overlay & cascades
│   ├── hdx.js                  # OCHA HDX HAPI v2 ingestion & COD-AB P-code/DELTA validator
│   ├── severity.js             # JIAF 2.0 / INFORM-aligned multi-factor humanitarian severity engine
│   ├── benchmarks.js           # GeoDisaster-style multi-step DRR agent trajectory benchmark runner
│   ├── monitor.js              # Autonomous & scheduled single-run shadow monitor with deduplication
│   ├── retry.js                # Bounded exponential backoff with jitter & deadline enforcement
│   ├── state-store.js          # Transactional CAS state persistence & storage lease fencing
│   ├── config.js               # Centralized configuration & .env parser
│   ├── utils.js                # Math, spherical geometry, boundary & antimeridian helpers
│   └── index.js                # Unified barrel export
├── scripts/
│   ├── lint.js                 # Static AST, JSON, inline JS & stdlib-only verifier
│   ├── generate-inventory.js   # Programmatic generator for docs/tool-inventory.md & skills-manifest.json
│   ├── install-git-hook.js     # Pre-commit hook installer
│   └── next-version.js         # Automated SemVer calculator for dev -> main releases
├── docs/
│   ├── skills-guide.md         # End-user prompt examples & specific use cases for all 19 skills
│   ├── api-reference.md        # 37 MCP tools & 37 CLI subcommands specification
│   ├── tool-inventory.md       # Programmatically generated capability & test inventory
│   ├── methodology.md          # Scientific equations, bounds & C-01..C-08 governance
│   ├── operational-playbook.md # Personas, timelines & operational workflows
│   ├── configuration.md        # Environment variables, proxies, country scoping & shadow monitor
│   └── platforms/              # Platform setup guides (Antigravity, Claude, Cursor, Copilot, OpenCode)
├── skills/                     # 19 Reusable AI Agent Skills (SKILL.md)
│   ├── cap-governance-and-approval/
│   ├── critical-infrastructure-overlay/
│   ├── delta-disaster-recording/
│   ├── drr-data-quality-and-provenance/
│   ├── early-warning-telemetry/
│   ├── event-identity-and-linkage/
│   ├── fdsn-shakemap-seismic/
│   ├── forecast-based-action-trigger-design/
│   ├── gdacs-feed-ingestion/
│   ├── hazard-exposure-modeling/
│   ├── hdx-hapi-and-cod-boundaries/
│   ├── humanitarian-rapid-impact-severity/
│   ├── oasis-cap-alerting/
│   ├── ogc-sensorthings-telemetry/
│   ├── risk-reduction-options-appraisal/
│   ├── sendai-indicator-accounting/
│   ├── stac-eo-hazard-grids/
│   ├── undrr-hip-hazard-classification/
│   └── vulnerability-matrix/
├── examples/                   # Executable real-world scenarios & fixtures
└── tests/                      # Full automated test suite (27 test suites + benchmarks/)
    ├── benchmarks/
    │   └── geodisaster-scenarios.json
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
For all 37 MCP tools and 37 CLI subcommands, see **[docs/api-reference.md](docs/api-reference.md)** and **[docs/tool-inventory.md](docs/tool-inventory.md)**.

```bash
# Real-time telemetry & screening
node bin/cli.js usgs --min-mag 5.0 --limit 10
node bin/cli.js forecast --lat -6.2 --lon 106.8 --days 5
node bin/cli.js gdacs --min-level Orange

# OCHA HDX/HAPI, COD-AB validation, humanitarian severity & benchmarks
node bin/cli.js hdx-hapi --file examples/hdx-hapi-cod/sample-hapi-population.json --iso3 THA
node bin/cli.js cod-validate --file examples/hdx-hapi-cod/sample-cod-ab.geojson --iso3 THA --admin-level 2
node bin/cli.js severity-assess --pcode TH9001 --hazard flood --hazard-intensity 7.5 --affected-pop 42000 --total-pop 160000 --vulnerability 6.2 --coping-deficit 5.8
node bin/cli.js benchmark

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

## MCP Server Tools (37 Tools)

The MCP server (`bin/mcp-server.js`) exposes **37 deterministic, provenance-aware tools**:

| Category | MCP Tools |
| :--- | :--- |
| **Telemetry & Hydrology** | `drr_gdacs_fetch`, `drr_usgs_earthquake_fetch`, `drr_fdsn_shakemap_fetch`, `drr_openmeteo_forecast`, `drr_sensorthings_fetch`, `drr_stac_hazard_fetch`, `drr_hdx_hapi_fetch`, `drr_basin_rainfall_aggregate`, `drr_river_discharge_screen`, `drr_monitor_check` |
| **Contracts, Governance & Benchmarks** | `drr_input_contract_validate`, `drr_source_provenance_manifest`, `drr_model_registry_list`, `drr_assessment_replay_validate`, `drr_benchmark_run` |
| **Spatial, COD-AB, Overlay & Raster** | `drr_spatial_exposure_join`, `drr_critical_infra_overlay`, `drr_cod_boundary_validate`, `drr_geojson_validate`, `drr_geometry_repair`, `drr_crs_transform`, `drr_raster_zonal_stats` |
| **Fragility, Loss, Severity & Sendai** | `drr_fragility_eval`, `drr_vulnerability_matrix_calc`, `drr_humanitarian_severity_assess`, `drr_sendai_validate` |
| **Taxonomy & Event Identity** | `drr_hazard_crosswalk`, `drr_event_match_deduplicate` |
| **CAP & DELTA Interoperability** | `drr_cap_alert_generate_validate`, `drr_cap_publish`, `drr_delta_push_draft_record`, `drr_delta_fetch_exposure`, `drr_delta_docs`, `drr_delta_schema_validate` |
| **Uncertainty & Appraisal** | `drr_uncertainty_propagate`, `drr_expected_annual_loss`, `drr_mitigation_cost_benefit` |

See **[docs/tool-inventory.md](docs/tool-inventory.md)** for auto-generated per-tool parameter schemas and test mappings, **[skills-manifest.json](skills-manifest.json)** for machine-readable skill safety tiers & tool bindings, and **[docs/critical-infrastructure-overlay-guide.md](docs/critical-infrastructure-overlay-guide.md)** for the Sendai Target D 9-sector overlay authoring & OGC API – Features integration guide.

---

## Domain Skills & Prompting Guide (19 Skills)

Each skill in `skills/*/SKILL.md` encodes DRR scientific guardrails, tool orchestration, and governance escalation rules. See **[docs/skills-guide.md](docs/skills-guide.md)** for ready-to-use end-user prompts applying specific real-world use cases to every skill:

* **Telemetry & Early Warning**: [`early-warning-telemetry`](docs/skills-guide.md#1-early-warning-telemetry), [`gdacs-feed-ingestion`](docs/skills-guide.md#2-gdacs-feed-ingestion), [`forecast-based-action-trigger-design`](docs/skills-guide.md#3-forecast-based-action-trigger-design), [`ogc-sensorthings-telemetry`](docs/skills-guide.md#14-ogc-sensorthings-telemetry), [`stac-eo-hazard-grids`](docs/skills-guide.md#15-stac-eo-hazard-grids), [`fdsn-shakemap-seismic`](docs/skills-guide.md#16-fdsn-shakemap-seismic)
* **Spatial, Overlays, Fragility & Impact**: [`hazard-exposure-modeling`](docs/skills-guide.md#4-hazard-exposure-modeling), [`vulnerability-matrix`](docs/skills-guide.md#5-vulnerability-matrix), [`critical-infrastructure-overlay`](docs/skills-guide.md#17-critical-infrastructure-overlay)
* **Humanitarian Data, COD-AB & Severity**: [`hdx-hapi-and-cod-boundaries`](docs/skills-guide.md#18-hdx-hapi-and-cod-boundaries), [`humanitarian-rapid-impact-severity`](docs/skills-guide.md#19-humanitarian-rapid-impact-severity)
* **Alerting & Broadcast Governance**: [`oasis-cap-alerting`](docs/skills-guide.md#6-oasis-cap-alerting), [`cap-governance-and-approval`](docs/skills-guide.md#7-cap-governance-and-approval)
* **Sendai, DELTA & Taxonomy**: [`sendai-indicator-accounting`](docs/skills-guide.md#8-sendai-indicator-accounting), [`delta-disaster-recording`](docs/skills-guide.md#9-delta-disaster-recording), [`undrr-hip-hazard-classification`](docs/skills-guide.md#10-undrr-hip-hazard-classification), [`event-identity-and-linkage`](docs/skills-guide.md#11-event-identity-and-linkage)
* **Quality, Provenance & Appraisal**: [`drr-data-quality-and-provenance`](docs/skills-guide.md#12-drr-data-quality-and-provenance), [`risk-reduction-options-appraisal`](docs/skills-guide.md#13-risk-reduction-options-appraisal)

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
