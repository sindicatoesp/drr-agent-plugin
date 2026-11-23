---
name: hdx-hapi-and-cod-boundaries
description: Discovers and validates OCHA HDX Humanitarian API (HAPI v2) baseline indicators (population, humanitarian needs, IDPs, refugees, operational presence) and OCHA COD-AB administrative boundary P-code hierarchies with DELTA Resilience division reconciliation.
---

# OCHA HDX/HAPI & COD-AB Administrative Boundaries

## Triggers
* Searching or ingesting humanitarian baseline indicators (population, humanitarian needs, IDPs, refugees, operational presence) from OCHA HDX HAPI v2 by ISO3 country or P-code.
* Validating OCHA Common Operational Datasets — Administrative Boundaries (COD-AB) GeoJSON or P-code tables before spatial exposure joins, zonal statistics, or UNDRR DELTA Resilience submissions.

## Non-Goals
* **MUST NOT** silently drop unmatched COD-AB P-codes or DELTA administrative divisions during reconciliation.
* **MUST NOT** coerce null/missing HAPI indicator values to `0` (R-02).
* **MUST NOT** redistribute datasets with missing or restricted licenses (`redistributionAllowed: false`) without verifying HDX terms.
* **MUST NOT** bypass SSRF host protection for custom HAPI endpoints.

## Authoritative References & Versions
* **OCHA HDX Humanitarian API (HAPI v2)** (`telemetry.hdx.hapi_v1`, `https://hapi.humdata.org/docs`).
* **OCHA COD-AB P-Code Standard & RFC 7946 GeoJSON** (`spatial.cod_ab.validation_v1`, `https://cod.unocha.org/`).

## Required Inputs
* For HAPI discovery: `resource` (e.g., `population-social/population`, `affected-people/humanitarian-needs`), optional `locationCode` (ISO3), `admin1Code`/`admin2Code`, `maxAgeDays`, or offline `samplePayload`.
* For COD-AB validation: `boundaryGeoJSON` (or `records`), optional `expectedIso3`, `expectedAdminLevel`, `boundarySource`, and optional `deltaDivisions` for reconciliation.

## Allowed Executable Tools
* `drr_hdx_hapi_fetch`
* `drr_cod_boundary_validate`
* `drr_hdx_polygon_population_estimate`
* `drr_geojson_validate`
* `drr_geometry_repair`
* `drr_delta_fetch_exposure`

## Escalation Conditions
* Escalate to IM / GIS data steward if `validateCodBoundaries` returns `valid: false` (duplicate P-codes, hierarchy mismatch, invalid ISO3, or invalid geometry) or if `deltaReconciliation.reconciled === false`.
* Escalate if HAPI `summary.staleCount > 0` or `summary.restrictedLicenseCount > 0` prior to operational briefing publication.

## Example End-User Prompts
* **Use Case — Validate COD-AB ADM2 Boundaries & Reconcile Against DELTA**:
  ```text
  Using the hdx-hapi-and-cod-boundaries skill, validate examples/hdx-hapi-cod/sample-cod-ab.geojson
  for expectedIso3 "THA" at expectedAdminLevel 2 and reconcile against DELTA divisions ["TH9001", "TH9002"].
  ```
* **Use Case — Estimate Exposed Population Inside a Hazard Polygon via COD-AB + HDX HAPI**:
  ```text
  Use drr_hdx_polygon_population_estimate with codBoundaryGeoJSON examples/hdx-hapi-cod/sample-cod-ab.geojson,
  hapiSamplePayload examples/hdx-hapi-cod/sample-hapi-population.json, and a flood polygon covering
  the northern half of Hat Yai. Report area-weighted vs. full-unit totals and uniform-density caveats.
  ```
