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
