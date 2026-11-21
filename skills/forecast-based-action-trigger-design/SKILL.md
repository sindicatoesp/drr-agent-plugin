---
name: forecast-based-action-trigger-design
description: Hydro-meteorological Anticipatory Action trigger evaluation across Open-Meteo rainfall screening, basin rainfall aggregation, and GloFAS river discharge screening with approved triggerPolicy and persistence gates.
---

# Forecast-Based Action (FbA) Trigger Design

## Triggers
* Designing or evaluating Anticipatory Action / Forecast-based Financing (FbF) rainfall or river-discharge triggers prior to a hydro-meteorological shock.

## Non-Goals
* **MUST NOT** output flood inundation depths derived solely from precipitation totals (`depthStatus: "depth_unavailable"`, C-05).
* **MUST NOT** label GloFAS river discharge ($\text{m}^3/\text{s}$) as water depth or use ~5 km grid cells without river-cell suitability checks (R-12).
* **MUST NOT** activate operational triggers using unapproved default thresholds or single unverified runs when persistence is required.

## Authoritative References & Versions
* **Open-Meteo Weather & Flood API (GloFAS ~5 km grid)** (`REG_OPENMETEO_RAINFALL_SCREENING`, `REG_GLOFAS_DISCHARGE_SCREENING`). [S8]

## Required Inputs
* Basin gauge/grid rainfall time series (`stationsOrGrid`), catchment geometry (`basinGeoJSON`), or daily GloFAS discharge array (`dailyDischargeM3s`), local return-period thresholds, river-cell metadata, and approved `triggerPolicy`.

## Allowed Executable Tools
* `drr_openmeteo_forecast`
* `drr_basin_rainfall_aggregate`
* `drr_river_discharge_screen`
* `drr_spatial_exposure_join`

## Escalation Conditions
* Escalate to hydrological service if `suitability.suitable === false` (e.g., coarse grid on small headwater catchment) or if `triggerPolicy.approved !== true`.

## Example Output & Failure Cases
* **GloFAS Suitability Check**: Returns `dischargeUnit: "m3/s"`, `depthStatus: "depth_unavailable"`, and explicit `suitability.warnings` when `upstreamDrainageAreaSqKm` is small relative to 5 km grid resolution.

## Example End-User Prompts
* **Use Case — 72-Hour Forecast-Based Financing (FbF) Flood Trigger (Bangladesh)**:
  ```text
  Apply the forecast-based-action-trigger-design skill for Dhaka (lat 23.8, lon 90.4, 5-day forecast)
  using approved triggerPolicy { "policyId": "bgd-fbf-monsoon-2026", "approved": true, "requirePersistence": true }
  and two prior forecast runs exceeding 150 mm. Report whether the trigger activates and confirm
  depthStatus remains "depth_unavailable".
  ```
* **Use Case — GloFAS River Discharge & Headwater Suitability Screening**:
  ```text
  Screen daily GloFAS discharge [480, 920, 1340, 1490] m3/s against return-period thresholds
  { q2: 600, q5: 1000, q10: 1250, q20: 1500 } for a 180 km^2 headwater catchment on a 5 km grid,
  and flag any river-cell suitability warnings.
  ```
* See [`docs/skills-guide.md`](../../docs/skills-guide.md#3-forecast-based-action-trigger-design) for additional examples.

