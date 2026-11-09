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
* `mcp.json` -> Spawns the `drr-analytics` MCP server
* `skills/*/SKILL.md` -> Registers the 5 DRR domain skills

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
3. You should see `drr-analytics` with 11 active tools:
   - `drr_gdacs_fetch`
   - `drr_usgs_earthquake_fetch`
   - `drr_openmeteo_forecast`
   - `drr_spatial_exposure_join`
   - `drr_fragility_eval`
   - `drr_vulnerability_matrix_calc`
   - `drr_cap_alert_generate_validate`
   - `drr_delta_push_draft_record`
   - `drr_delta_fetch_exposure`
   - `drr_delta_docs`
   - `drr_monitor_check`

---

## 3. Example Prompts in Antigravity

### Multi-Source Seismic Ingestion & Fragility
```text
Query the USGS feed for any M6.0+ earthquakes in the South Pacific over the last week.
For the largest event, extract its estimated PGA and run a fragility analysis
on Unreinforced Masonry (URM) and Concrete Frames (C1).
```

### Anticipatory Action Flood Forecast
```text
Fetch the 5-day precipitation forecast for Dhaka (lat 23.8, lon 90.4) using Open-Meteo.
If the cumulative rainfall meets the Anticipatory Action flood trigger threshold,
calculate the expected flood depth and draft an OASIS CAP alert.
```
