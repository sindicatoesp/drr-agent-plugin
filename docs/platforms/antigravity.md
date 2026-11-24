# Antigravity Platform Guide

How to install and use the **DRR Analytics Agent Plugin** in Google Antigravity (AGY) and the Antigravity IDE.

---

## 1. Quick Installation in Antigravity

Antigravity natively discovers plugins conforming to the `agent-plugins.org` standard.

### Option A: Project-Level Mounting
Place or symlink the plugin inside your project's `.agents/plugins/` directory:

```bash
mkdir -p .agents/plugins
cp -r /path/to/drr-agent-plugin .agents/plugins/drr-analytics
```

Antigravity automatically detects:
* `plugin.json` -> Registers plugin metadata
* `mcp.json` -> Spawns the `drr-analytics` MCP server (**41 deterministic tools**)
* `skills/*/SKILL.md` -> Registers all **19 DRR domain skills**

### Option B: Global Mounting
To make DRR capabilities available across all Antigravity workspaces:

```bash
mkdir -p ~/.gemini/config/plugins
cp -r /path/to/drr-agent-plugin ~/.gemini/config/plugins/drr-analytics
```

---

## 2. Verifying in Antigravity

1. Open your Antigravity conversation.
2. Check connected tools by clicking **Additional Options (...) > MCP Servers**.
3. You should see `drr-analytics` with **41 active tools** across 7 categories (see [`docs/tool-inventory.md`](../tool-inventory.md) for the complete generated list):
   - **Telemetry & Hydrology (6)**: `drr_gdacs_fetch`, `drr_usgs_earthquake_fetch`, `drr_openmeteo_forecast`, `drr_basin_rainfall_aggregate`, `drr_river_discharge_screen`, `drr_monitor_check`
   - **Contracts, Governance & Replay (4)**: `drr_input_contract_validate`, `drr_source_provenance_manifest`, `drr_model_registry_list`, `drr_assessment_replay_validate`
   - **Spatial, CRS & Raster (5)**: `drr_spatial_exposure_join`, `drr_geojson_validate`, `drr_geometry_repair`, `drr_crs_transform`, `drr_raster_zonal_stats`
   - **Fragility, Loss & Sendai (3)**: `drr_fragility_eval`, `drr_vulnerability_matrix_calc`, `drr_sendai_validate`
   - **Taxonomy & Event Identity (2)**: `drr_hazard_crosswalk`, `drr_event_match_deduplicate`
   - **CAP & DELTA Interoperability (6)**: `drr_cap_alert_generate_validate`, `drr_cap_publish`, `drr_delta_push_draft_record`, `drr_delta_fetch_exposure`, `drr_delta_docs`, `drr_delta_schema_validate`
   - **Uncertainty & Appraisal (3)**: `drr_uncertainty_propagate`, `drr_expected_annual_loss`, `drr_mitigation_cost_benefit`

---

## 3. Example Prompts in Antigravity

> For prompt examples covering all **13 DRR skills** and specific real-world use cases, see **[docs/skills-guide.md](../skills-guide.md)**.

### Multi-Source Seismic Ingestion & Illustrative Fragility
```text
Using the early-warning-telemetry and hazard-exposure-modeling skills, query USGS for any M6.0+
earthquakes (limit 10). For the strongest event, report its Wald et al. (1999) GMICE estimated
PGA (flagging if MMI is outside V–VIII) and evaluate illustrative fragility in exploratory mode
for Unreinforced Masonry (URM) and Pre-Code Concrete Frames (C1_PRE_CODE).
```

### Anticipatory Action Flood Trigger & Draft CAP Alert
```text
Using forecast-based-action-trigger-design and oasis-cap-alerting, fetch the 5-day precipitation
forecast for Dhaka (lat 23.8, lon 90.4) via Open-Meteo and evaluate it against our approved
triggerPolicy { "policyId": "bgd-fbf-2026", "approved": true, "requirePersistence": false }.
Confirm flood depth stays depth_unavailable without a hydraulic grid, and draft a validated
OASIS CAP v1.2 XML advisory (status: Draft) for Duty Officer review.
```
