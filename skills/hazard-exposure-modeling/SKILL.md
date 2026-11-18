---
name: hazard-exposure-modeling
description: Execute deterministic spatial joins (antimeridian, hole, CRS, raster-aware) and registered illustrative GEM/HAZUS physical fragility curves with explicit unit conversions and production gates.
---

# Hazard Exposure Modeling & Physical Fragility

## Triggers
* User requests point-in-polygon / geodesic buffer spatial exposure joins, GeoJSON topology checks, CRS transforms, or raster zonal statistics.
* User requests structural damage state probabilities or Mean Damage Ratio (MDR) for earthquake, flood, or wind intensities.

## Non-Goals
* **MUST NOT** claim embedded illustrative baseline fragility curves (`calibrationStatus: "illustrative_baseline"`) are validated national HAZUS/GEM production inventories (C-06).
* **MUST NOT** silently repair malformed GeoJSON without opt-in (`repairRequested: true`) preserving `originalGeometry` (C-08).
* **MUST NOT** mix population `count` rasters with `density_per_sqkm` rasters or coerce missing population/asset values to zero (R-02, R-11).
* **MUST NOT** substitute silent intensity defaults when `intensity` is null/missing.

## Authoritative References & Versions
* **GEM Building Taxonomy v2.0** (Silva et al., 2018) & **FEMA HAZUS-MH 2.1 Technical Manuals** (registered baseline curves `REG_SEISMIC_FRAGILITY_ILLUSTRATIVE`, `REG_FLOOD_DEPTH_DAMAGE_ILLUSTRATIVE`, `REG_WIND_FRAGILITY_ILLUSTRATIVE` — illustrative until locally calibrated). [S7]
* **RFC 7946** GeoJSON topology & spherical/geodesic geometry (`EPSG:4326`, `EPSG:3857`, WGS84 UTM).

## Required Inputs
* Validated hazard footprint (`Polygon`/`MultiPolygon` GeoJSON or geodesic `epicenter` + `bufferKm`) and exposure `FeatureCollection`.
* Explicit `hazardType`, numeric `intensity`, explicit `unit` (`g`, `m/s2`, `m`, `ft`, `km/h`, `m/s`, `kt`), `taxonomy` / `occupancy`, and `mode` (`exploratory` vs `production`).

## Allowed Executable Tools
* `drr_geojson_validate`, `drr_geometry_repair`, `drr_crs_transform`, `drr_raster_zonal_stats`
* `drr_spatial_exposure_join`
* `drr_model_registry_list`
* `drr_fragility_eval`

## Escalation Conditions
* Escalate to structural engineer / local model custodian if `mode: "production"` is requested on `illustrative_baseline` curves (tool blocks execution).
* Escalate if `drr_geojson_validate` reports self-intersections, unclosed rings, or CRS mismatch before spatial intersection.

## Example Output & Failure Cases
* **Expected Zero-Intensity Invariant**: `intensity: 0` deterministically yields `meanDamageRatio: 0`, `probabilities.none: 1`.
* **Production Gate Failure**: Calling `drr_fragility_eval` with `mode: "production"` throws/rejects uncalibrated baseline curves cleanly.
