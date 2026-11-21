---
name: stac-eo-hazard-grids
description: Ingests STAC v1.0.0 Earth Observation catalogs (Copernicus EMS, Sentinel-1 SAR, ICEYE, Floodbase) and validates flood inundation depth grids via ingestValidatedInundationGrid (C-05 / R-12), separating flood extent from depth and enforcing commercial licensing, cloud cover, and SSRF guards.
---

# STAC Earth Observation Catalogs & Validated Flood Depth Grids

## Triggers
* User requests querying a government or commercial **STAC v1.0.0** Earth Observation catalog (Copernicus EMS, Sentinel-1 SAR, NASA SWOT, ICEYE, Capella Space, Floodbase) for flood extent footprints or validated flood inundation depth grids.
* Analyst needs to resolve `depthStatus: "depth_unavailable"` (C-05) by ingesting a calibrated satellite SAR or hydraulic depth grid and piping it into `drr_raster_zonal_stats` and `drr_vulnerability_matrix_calc`.

## Non-Goals
* **MUST NOT** treat a flood-extent polygon (`depthStatus: "extent_only_no_depth"`) as flood depth in meters (C-05).
* **MUST NOT** fabricate depth values from binary Cloud-Optimized GeoTIFF (COG) assets when no extracted JSON depth grid is provided (`depthStatus: "cog_asset_requires_extraction"`).
* **MUST NOT** mark cloud-obscured optical imagery (`eo:cloud_cover > maxCloudCover`) as verified `observed` evidence.
* **MUST NOT** redistribute commercial satellite products with `redistributionAllowed: false` (e.g., proprietary ICEYE/Maxar licenses) in public CAP alerts.

## Authoritative References & Versions
* **STAC Specification v1.0.0** (`https://stacspec.org/`, registered method `telemetry.stac.hazard_grid_v1`).
* **Copernicus EMS Rapid Mapping** & **Commercial SAR Flood Depth Grids** bridged into `ingestValidatedInundationGrid` (`lib/hydro.js`) and `computeRasterZonalStats` (`lib/spatial.js`).

## Required Inputs
* Either a STAC API v1.0.0 `endpointUrl` (or `STAC_API_URL` env var) + optional `bbox`, `datetime`, `collections`, `limit` OR an offline `samplePayload` STAC FeatureCollection/Item.
* Optional: `sampleDepthGrid` (pre-extracted JSON depth grid), `maxCloudCover` (default `25`), and `asGeoJSON`.

## Allowed Executable Tools
* `drr_stac_hazard_fetch`
* `drr_raster_zonal_stats`
* `drr_spatial_exposure_join`
* `drr_fragility_eval`
* `drr_vulnerability_matrix_calc`

## Escalation Conditions
* Escalate to EO/GIS analyst when `requiresExternalCogDecoder === true` (binary COG must be decoded to JSON grid) or when `eoMetadata.cloudObscured === true`.
* Escalate to legal/licensing lead before redistributing any item with `licensing.redistributionAllowed === false`.

## Example Output & Failure Cases
* **Validated SAR Depth Grid (C-05 Solved)**: An ICEYE item carrying `drr:depth_grid` in feet (`unit: "ft"`) normalizes to meters (`unit: "m"`), preserves `nodata: -9999`, passes `ingestValidatedInundationGrid` (`depthStatus: "validated_depth_grid"`), and outputs summary depth stats (`minDepthMeters`, `maxDepthMeters`, `meanDepthMeters`).
* **Extent-Only Separation**: A Copernicus EMS Sentinel-1 extent item returns `depthStatus: "extent_only_no_depth"` without fabricating depths.

## Example End-User Prompts
* **Use Case — Yala SAR Flood Depth Grid & Zonal Exposure (GIS / EO Analyst)**:
  ```text
  Using the stac-eo-hazard-grids skill, ingest examples/stac-flood-depth/sample-stac-items.json
  with asGeoJSON: true and maxCloudCover: 25. Report which item yields a validated flood depth
  grid (normalized to meters), confirm that the Copernicus EMS extent-only item stays
  "extent_only_no_depth", flag the cloud-obscured Sentinel-2 COG, and flag commercial licensing
  restrictions before public alerting.
  ```
* **Use Case — Live STAC API Search for Regional Flood Mapping**:
  ```text
  Query our STAC v1.0.0 endpoint (endpointUrl: "https://stac.agency.gov/v1",
  bbox: [101.1, 6.4, 101.4, 6.7], datetime: "2026-11-06T00:00:00Z/2026-11-08T00:00:00Z",
  collections: ["sentinel-1-flood-depth"]) using stac-eo-hazard-grids and export footprints
  as GeoJSON for drr_spatial_exposure_join.
  ```
* See [`docs/skills-guide.md`](../../docs/skills-guide.md#15-stac-eo-hazard-grids) for additional examples.
