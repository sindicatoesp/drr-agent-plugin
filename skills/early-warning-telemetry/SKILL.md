---
name: early-warning-telemetry
description: Multi-source disaster early warning and telemetry ingestion combining GDACS, USGS Earthquake Hazards, and Open-Meteo Anticipatory Action triggers. Use when fetching real-time seismic parameters, flood forecasts, or multi-agency alerts.
---

# Multi-Source Disaster Telemetry & Early Warning

## Overview
This skill guides AI agents in assimilating multi-agency telemetry from global scientific providers:
1. **GDACS** (Global Disaster Alert and Coordination System - UN OCHA / EC DG ECHO)
2. **USGS** (United States Geological Survey Earthquake Hazards Program)
3. **Open-Meteo** (Global Weather Ensembles & Anticipatory Action Precipitation Triggers)

---

## 1. Provider Roles & Workflows

### 1.1 USGS Earthquake Hazards Feeds
* **Source**: FDSN-WS event service (`earthquake.usgs.gov`).
* **Key Metrics**: Moment Magnitude ($M_w$), hypocentral depth (km), Instrumental Intensity (MMI), and Peak Ground Acceleration ($\text{PGA}$ in $g$).
* **Conversion**: Uses Wald et al. (1999) GMPE empirical relations to derive deterministic $\text{PGA}$ from MMI:
  $$\text{PGA} = \frac{10^{(\text{MMI} + 1.66) / 3.66}}{980.665} \quad (\text{for } \text{MMI} \ge \text{V})$$
* **MCP Tool**: `drr_usgs_earthquake_fetch`.

### 1.2 Open-Meteo Anticipatory Flood Action
* **Source**: Multi-model forecast ensembles (ECMWF, NOAA GFS, DWD ICON).
* **Key Metrics**: 72-hour cumulative precipitation (mm), peak daily rainfall, 10m wind gusts (km/h).
* **Trigger Thresholds**:
  * **Red Alert ($\ge 200\text{mm}$)**: Severe flash flood and riverine inundation trigger. Estimated depth $\ge 1.5\text{m}$.
  * **Orange Alert ($90 - 199\text{mm}$)**: Localized inundation and waterlogging. Estimated depth $\sim 0.4 - 1.2\text{m}$.
  * **Green Alert ($< 90\text{mm}$)**: Normal seasonal rainfall.
* **MCP Tool**: `drr_openmeteo_forecast`.

### 1.3 GDACS Global Humanitarian Alerts
* **Source**: UN OCHA / Joint Research Centre alert feeds.
* **Key Metrics**: GDACS Alert Score ($0 - 3+$), Red/Orange/Green alert levels, affected populations.
* **MCP Tool**: `drr_gdacs_fetch`.

---

## 2. Integrated Disaster Pipeline

When monitoring an active emergency or early warning trigger:

```text
[USGS / Open-Meteo / GDACS]
           │
           ▼ (Normalized Coordinates, PGA or Inundation Depth)
[drr_spatial_exposure_join] ──► Intersects hazard footprint with local hospitals/schools
           │
           ▼ (Exposed Assets Report)
[drr_vulnerability_matrix_calc] ──► Computes Sendai Target B (Displaced) & Target C (Losses)
           │
           ▼ (Loss Assessment)
[drr_cap_alert_generate_validate] ──► Produces OASIS CAP v1.2 XML & Situation Brief
```
