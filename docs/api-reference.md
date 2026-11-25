# MCP Tools & CLI Technical Reference

Complete technical specification of all **42 MCP tools** provided by `bin/mcp-server.js` and the **42 CLI commands** in `bin/cli.js`.

> **Inventory Note (R-01)**: Historically at baseline commit `1d7600ce5cc50dcdea7b438ccbd59d28282793dd` (`origin/dev`), `bin/mcp-server.js` registered 11 tools (including `drr_delta_docs`) while this reference listed 10. Both `docs/api-reference.md` and `docs/tool-inventory.md` are now reconciled with the full **42-tool** registration source.

---

# Part 1: Model Context Protocol (MCP) Tools (42 Tools)

## 1. `drr_gdacs_fetch`
Ingests and filters active GDACS alerts by severity, hazard type (`EQ`, `TC`, `FL`, `VO`, `DR`), or country, with untrusted feed sanitization (`promptInjectionFlagged`), `sourceIssuedAt`, `retrievedAt`, and `payloadHash`.

```json
{
  "minAlertLevel": "Green | Orange | Red",
  "eventType": "EQ | TC | FL | VO | DR",
  "country": "string",
  "samplePayload": {}
}
```

## 2. `drr_adam_fetch`
Ingests pre-processed humanitarian impact and exposure feeds from the **WFP ADAM (Automated Disaster Analysis and Mapping)** OGC API – Features service (`WFP_ADAM_API_URL`, default `https://api.adam.geospatial.wfp.org/api`). Normalizes `ISO3`/`iso3`, `"-9999.0"` GloFAS probability sentinels to `null`, concentric population buffers, flood cropland/population totals, and WFP map/CSV/shapefile/PDF artifact URLs, with untrusted feed sanitization and SHA-256 `payloadHash`.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `collection` | `string` | `"eq"` | Collection alias (`eq`, `fl`, `fl_alerts`, `fl_mom`, `glofas`, `ts`, `ts_buffers`, `ts_tracks`, `ts_nodes`, `ts_disturbance_tracks`, `ts_disturbance_buffers`, `ts_disturbance_nodes`) or full OGC ID (e.g. `adam.adam_eq_events`). |
| `limit` | `number` | `20` | Maximum number of OGC API items to request per page. |
| `offset` | `number` | *None* | Pagination offset for OGC API `/items` queries. |
| `bbox` | `string \| number[]` | *None* | Spatial bounding box `"minLon,minLat,maxLon,maxLat"` passed to the OGC API. |
| `datetime` | `string` | *None* | OGC API ISO-8601 temporal instant or interval (e.g. `"2026-11-01T00:00:00Z/.."`). |
| `country` | `string` | *None* | Case-insensitive country name substring filter (`country`, `adm0_name`, or `countries`). |
| `iso3` | `string` | *None* | Exact case-insensitive ISO3/ISO2 country code filter (e.g. `"PHL"`, `"GHA"`). |
| `minMagnitude` | `number` | *None* | Minimum earthquake magnitude filter (for `eq` collections). |
| `minAlertLevel` | `string` | *None* | Minimum alert severity (`"Green"`, `"Orange"`, or `"Red"`). |
| `listCollections` | `boolean` | `false` | When `true`, returns the list of available WFP ADAM OGC API collections and extents instead of features. |
| `samplePayload` | `object` | *None* | Offline GeoJSON `FeatureCollection` (or `/collections` JSON) for air-gapped or deterministic testing. |

```json
{
  "collection": "eq",
  "limit": 10,
  "minMagnitude": 5.5,
  "iso3": "PHL"
}
```

```json
{
  "collection": "glofas",
  "bbox": "97.0,5.0,106.0,21.0",
  "limit": 20
}
```

## 3. `drr_usgs_earthquake_fetch`
Queries real-time seismic events from the USGS Earthquake Hazards Program and converts MMI to Peak Ground Acceleration (PGA in $g$) via **Wald et al. (1999) GMICE** (`REG_WALD99_GMICE`), recording empirical applicability (MMI V–VIII) and extrapolation flags.

```json
{
  "minMagnitude": 5.0,
  "limit": 20,
  "samplePayload": {}
}
```

## 3. `drr_openmeteo_forecast`
Queries Open-Meteo multi-model weather forecasts for **Anticipatory Action rainfall-threshold screening only** (never derives or fabricates inundation depth from rainfall alone — returns `estimatedInundationDepthMeters: null` and `depthStatus: "depth_unavailable"`). Enforces optional approved `triggerPolicy` and distinct-run `previousRuns` persistence checks.

```json
{
  "latitude": 23.8,
  "longitude": 90.4,
  "days": 5,
  "triggerPolicy": { "policyId": "bgd-fbf-2026", "approved": true, "requirePersistence": false },
  "previousRuns": [],
  "samplePayload": {}
}
```

## 4. `drr_spatial_exposure_join`
Executes deterministic, hole-aware, boundary-inclusive, antimeridian-safe point-in-polygon and geodesic buffer spatial joins between hazard footprints and exposed assets.

```json
{
  "hazardGeoJSON": {},
  "exposureGeoJSON": {},
  "epicenter": [125.15, 6.85],
  "bufferKm": 25.0
}
```

## 5. `drr_fragility_eval`
Evaluates illustrative GEM/HAZUS lognormal damage state probabilities and Mean Damage Ratio (MDR) registered in `MODEL_REGISTRY`. Enforces explicit unit conversion (`g`, `m/s2`, `m`, `ft`, `km/h`, `m/s`, `kt`), distinct flood occupancies (`residential_1story`, `residential_2story`, `commercial`), zero-intensity invariance, and production blocking for uncalibrated illustrative curves.

```json
{
  "hazardType": "earthquake | flood | wind",
  "intensity": 0.35,
  "unit": "g",
  "taxonomy": "URM | C1_PRE_CODE | C1_MODERATE_CODE | C2 | S1 | W1",
  "occupancy": "residential_1story | residential_2story | commercial",
  "mode": "exploratory | production"
}
```

## 6. `drr_vulnerability_matrix_calc`
Computes composite vulnerability matrices with C-01..C-03 compliance: preserves unknown population/value as `null`, separates modelled displacement (`estimatedDisplaced`) from Sendai `B-1` directly affected (`b1DirectlyAffected: null` unless direct evidence exists), separates physical facility damage (`D-2`..`D-4`) from service disruption (`D-6`..`D-8`), and preserves currency/valuationYear.

```json
{
  "spatialReport": {},
  "hazardType": "earthquake | flood | wind",
  "intensity": 0.35,
  "unit": "g",
  "defaultTaxonomy": "URM",
  "currency": "USD",
  "valuationYear": 2026
}
```

## 7. `drr_cap_alert_generate_validate`
Generates and validates ITU-T X.1303 / OASIS CAP v1.2 XML alerts or synthesizes emergency situation briefs. Defaults generated alerts to `status: "Draft"` and UTC `+00:00` timestamps; blocks XXE/DOCTYPE injections; validates `<references>` on `Update`/`Cancel`/`Ack` and `<addresses>` on `Private` scope alerts; separates schema/profile validity from authenticity, issuer authorization, publication approval, and delivery status.

```json
{
  "mode": "generate_xml | validate_xml | generate_brief",
  "alertParams": {},
  "xmlString": "<?xml ...>",
  "context": {}
}
```

## 8. `drr_cap_publish`
Controlled CAP publication adapter enforcing XML validity, channel safety (blocks `Draft`/`Test`/`Exercise` alerts from production channels, disables live production publish unless `DRR_ENABLE_PRODUCTION_PUBLISH === 'true'`), destination allowlists, idempotency replay checks, and signed `approvalToken` verification bound to payload hash and destination.

```json
{
  "xmlString": "<?xml ...>",
  "channelType": "sandbox | production",
  "destination": "https://sandbox.cap.example.org/ingest",
  "permissionScope": "publish_cap",
  "approvalToken": {},
  "idempotencyKey": "cap-dispatch-001"
}
```

## 9. `drr_delta_push_draft_record`
Pushes a schema-validated assessment to DELTA Resilience as a Draft (`status: "draft"`, `source: "drr-agent-plugin"`). Forwards sanitized `name` and `notes`, validates DTS schema (`validateDeltaSchema`), enforces tenant isolation (`tenantContext`), and preserves C-03 governance metadata.

```json
{
  "assessment": {},
  "name": "string",
  "notes": "string",
  "mock": true,
  "tenantContext": { "actorTenant": "THA", "targetTenant": "THA" }
}
```

## 10. `drr_delta_fetch_exposure`
Queries baseline administrative divisions, sector assets, HIP catalogs, or historical disaster records from DELTA via MCP.

```json
{
  "entity": "division | disaster-record | disaster-event | organization | hip-hazard | hip-cluster | hip-type | sector",
  "filter": { "page": 1, "pageSize": 50 },
  "mock": true
}
```

## 11. `drr_delta_docs`
Queries the DELTA Resilience MCP `docs` tool for DTS system documentation, entity relationships, workflows, and HIP taxonomy reference.

```json
{
  "mock": true
}
```

## 12. `drr_delta_schema_validate`
Validates a DELTA relational bundle or assessment against DTS `fieldsDefApi` contracts, HIP triad completeness, wire sanitization, PostGIS SRID 4326 spatial footprints, and Sendai relations.

```json
{
  "payload": {}
}
```

## 13. `drr_monitor_check`
Executes a bounded single-run monitoring cycle against `alerts-config.json` rules using geodesic circular buffers (`createGeodesicBuffer`), hazard-appropriate intensity mapping (no cross-hazard seismic PGA fallback for tropical cyclones), durable CAS state/leases, cross-source event deduplication (`matchAndDeduplicateEvents`), read-only shadow mode protection, and `Draft`-status CAP alert artifacts.

```json
{
  "configPath": "alerts-config.json",
  "mock": true,
  "readOnly": true,
  "scopeId": "default",
  "stateBackend": "cas-file-store | memory-cas-store | stateless",
  "runDeadlineMs": 120000
}
```

## 14. `drr_input_contract_validate`
Validates assessment input contracts (intensity units, coordinate order `[lon, lat]`, temporal intervals, ISO-4217 currency, `valuationYear`, and missing-data preservation where `null` != `0`).

```json
{
  "input": {},
  "strictMissingData": false
}
```

## 15. `drr_source_provenance_manifest`
Generates a secret-sanitized provenance and independent C-03 governance manifest (`evidenceBasis`, `verificationStatus`, `approvalStatus`, `reportingEligibility`, and SHA-256 `snapshotHash`).

```json
{
  "sourceIds": ["usgs:us7000"],
  "method": { "id": "REG_WALD99_GMICE", "version": "1999.1" },
  "inputsSnapshot": {},
  "evidenceBasis": "modelled",
  "verificationStatus": "unreviewed",
  "approvalStatus": "draft",
  "seed": 42
}
```

## 16. `drr_model_registry_list`
Lists all registered scientific methods in `MODEL_REGISTRY` or checks domain applicability for a given `methodId`, `value`, `assetClass`, and `mode`.

```json
{
  "methodId": "REG_WALD99_GMICE",
  "value": 6.5,
  "assetClass": "URM",
  "mode": "exploratory | production"
}
```

## 17. `drr_assessment_replay_validate`
Executes deterministic frozen-input replay validation across `synthetic_reference` and `hindcast_benchmark` test vectors (`R-05`).

```json
{
  "suite": "all | synthetic_reference | hindcast_benchmark"
}
```

## 18. `drr_sendai_validate`
Validates Sendai Framework Monitor (SFM) semantics (`R-08`): blocks unreviewed modelled statistics from official reporting, separates displacement from `B-1`, rejects overlapping population sums without deduplication methodology, distinguishes physical damage (`D-2`..`D-4`) from service disruption (`D-6`..`D-8`), and requires explicit `populationDenominator` for per-100,000 metrics.

```json
{
  "payload": {},
  "requireCalibratedMethodology": false
}
```

## 19. `drr_hazard_crosswalk`
Versioned UNDRR-ISC HIP hazard crosswalk (`UNDRR-ISC-HIP-2020-DELTA-v1`) with deterministic exact resolution on IDs/codes/aliases, human-reviewed candidate ranking for free-text queries, explicit `unresolved` handling for unknown codes, and 2025 HIP revision flags (`R-09`).

```json
{
  "query": "EQ",
  "sourceSystem": "GDACS",
  "candidateLimit": 5
}
```

## 20. `drr_event_match_deduplicate`
Multi-source event identity & deduplication engine (`R-10`) distinguishing exact external-ID matches (`exact_match_idempotent`), source updates (`revision_update`), ambiguous same-family spatio-temporal overlaps (`possible_duplicate` held for human review), and different-hazard co-occurrences (`cascading_candidate`, never inferring `triggered_by` automatically).

```json
{
  "incomingEvents": [],
  "existingCatalog": [],
  "spatialRadiusKm": 50,
  "timeWindowHours": 48
}
```

## 21. `drr_geojson_validate`
Validates GeoJSON Feature/FeatureCollection geometry topology: coordinate ranges, ring closure, zero-area degeneracy, RFC 7946 winding order, antimeridian spans, and segment self-intersections.

```json
{
  "geojson": {},
  "crs": "EPSG:4326"
}
```

## 22. `drr_geometry_repair`
Opt-in auditable GeoJSON repair (`repairRequested: true` required) performing ring closure, duplicate vertex removal, and RFC 7946 winding orientation while preserving `originalGeometry` and reporting `areaSqKmDelta`.

```json
{
  "geojson": {},
  "repairRequested": true
}
```

## 23. `drr_crs_transform`
Reprojects `[x, y]` points or full GeoJSON geometries across `EPSG:4326` (WGS84), `EPSG:3857` (Web Mercator), and WGS84 UTM zones (`EPSG:32601`–`EPSG:32660`, `EPSG:32701`–`EPSG:32760`).

```json
{
  "input": {},
  "fromCrs": "EPSG:4326",
  "toCrs": "EPSG:3857"
}
```

## 24. `drr_raster_zonal_stats`
Computes zonal statistics for gridded rasters inside vector zone polygons, enforcing CRS alignment, `nodata` exclusion, and explicit `quantityType` semantics (`count` sum, `density_per_sqkm` area-integrated count, or `continuous` min/max/mean).

```json
{
  "rasterGrid": {},
  "zoneGeoJSON": {},
  "zoneCrs": "EPSG:4326",
  "boundaryDataset": "GAUL",
  "boundaryVersion": "2024"
}
```

## 25. `drr_basin_rainfall_aggregate`
Aggregates gauge/grid precipitation forecasts (mm) over a catchment polygon or station array (`arithmetic_mean` or `weighted`), preserving `depthStatus: "depth_unavailable"`.

```json
{
  "basinId": "BASIN-01",
  "basinName": "Lower Chao Phraya",
  "basinGeoJSON": {},
  "stationsOrGrid": [],
  "dates": [],
  "method": "weighted"
}
```

## 26. `drr_river_discharge_screen`
Screens GloFAS / Open-Meteo daily river discharge ($\text{m}^3/\text{s}$) against local return-period thresholds with river-cell suitability checks (`gridResolutionKm`, `upstreamDrainageAreaSqKm`, `isRiverCell`), never labelled inundation depth.

```json
{
  "dailyDischargeM3s": [420, 950, 1280],
  "dates": ["2026-11-01", "2026-11-02", "2026-11-03"],
  "returnPeriodThresholds": { "q2": 600, "q5": 1000, "q10": 1250, "q20": 1500 },
  "gridResolutionKm": 5,
  "upstreamDrainageAreaSqKm": 2500,
  "isRiverCell": true
}
```

## 27. `drr_uncertainty_propagate`
Propagates input/parameter uncertainty using deterministic `min`/`central`/`max` intervals and one-at-a-time sensitivity ranking, or reproducible seeded Monte Carlo (`seed`, distribution provenance check, correlation warnings, split-half convergence check).

```json
{
  "mode": "deterministic_bounds | monte_carlo",
  "hazardType": "earthquake | flood | wind",
  "intensity": 0.35,
  "exposedValueUsd": 1000000,
  "taxonomy": "URM",
  "seed": 42,
  "iterations": 1000,
  "allowIllustrativeDistributions": false
}
```

## 28. `drr_expected_annual_loss`
Integrates multi-return-period exceedance probability vs. loss points via trapezoidal $\text{AEP} = 1/T$ integration. Rejects single-event scenario losses from masquerading as EAL and requires explicit `currency` and `valuationYear`.

```json
{
  "points": [
    { "returnPeriodYears": 10, "loss": 1000000 },
    { "returnPeriodYears": 50, "loss": 5000000 },
    { "returnPeriodYears": 100, "loss": 9000000 }
  ],
  "currency": "USD",
  "valuationYear": 2026,
  "tailHandling": "truncate | flat_extrapolation"
}
```

## 29. `drr_mitigation_cost_benefit`
Evaluates DRR prevention/mitigation options via discounted Cost-Benefit Analysis (NPV, BCR, residual risk EAL, CapEx/OpEx, sensitivity matrix across discount rates and benefits), explicitly separating quantitative economic evidence from policy judgements.

```json
{
  "optionName": "Flood Levee Upgrade",
  "baselineEal": 500000,
  "mitigatedEal": 150000,
  "capex": 2000000,
  "annualOpex": 25000,
  "annualCoBenefits": 10000,
  "discountRate": 0.05,
  "horizonYears": 25,
  "currency": "USD",
  "valuationYear": 2026
}
```

## 30. `drr_sensorthings_fetch`
Ingests and normalizes custom government or private in-situ sensor observations via **OGC SensorThings API v1.1** (`OGC 18-088`, registered method `telemetry.ogc.sensorthings_v1_1`) with DRR unit normalization (`ft`/`cm`→`m`, `in`→`mm`, `cfs`→`m3/s`, `m/s`/`kt`/`mph`→`km/h`, `m/s2`/`gal`→`g`), WMO/QARTOD quality-control filtering (`bad`/`missing` excluded from threshold triggers), null preservation, staleness checks, SSRF protection, prompt-injection sanitization, private redistribution licensing metadata, and optional GeoJSON export.

```json
{
  "endpointUrl": "https://sensors.agency.gov/v1.1",
  "observedProperty": "Water Level",
  "top": 50,
  "observationsTop": 5,
  "thresholds": { "warning": 2.0, "critical": 2.5, "unit": "m" },
  "maxAgeMinutes": 180,
  "excludeSuspect": false,
  "asGeoJSON": true,
  "samplePayload": {}
}
```

## 31. `drr_stac_hazard_fetch`
Ingests **STAC v1.0.0** Earth Observation catalogs (Copernicus EMS, Sentinel-1 SAR, ICEYE, Floodbase; registered method `telemetry.stac.hazard_grid_v1`) and validates flood inundation depth grids via `ingestValidatedInundationGrid` (`lib/hydro.js`), normalizing `cm`/`ft`→`m`, preserving `nodata`, separating flood extent (`extent_only_no_depth`) from depth (`validated_depth_grid`), flagging binary COGs (`cog_asset_requires_extraction`), enforcing `eo:cloud_cover` thresholds, commercial redistribution licensing, SSRF guards, and exporting footprints as GeoJSON.

```json
{
  "endpointUrl": "https://stac.agency.gov/v1",
  "bbox": [101.1, 6.4, 101.4, 6.7],
  "datetime": "2026-11-06T00:00:00Z/2026-11-08T00:00:00Z",
  "collections": ["copernicus-ems-rapid-mapping"],
  "limit": 20,
  "maxCloudCover": 25,
  "sampleDepthGrid": {},
  "asGeoJSON": true,
  "samplePayload": {}
}
```

## 32. `drr_fdsn_shakemap_fetch`
Ingests custom national **FDSN-WS** seismic events (BMKG, PHIVOLCS, JMA, EMSC, GeoNet, USGS; registered method `telemetry.fdsn.shakemap_v1`) and **ShakeMap v4** PGA/PGV/$V_{s30}$ contours, instrumented station lists, and continuous PGA grids — upgrading **C-04** beyond Wald et al. (1999) GMICE approximations with NEHRP site classes (`A`–`E`), `%g`/`m/s2`/`gal`→`g` normalization, DYFI macroseismic separation, SSRF protection, and GeoJSON export.

```json
{
  "endpointUrl": "https://seismic.agency.gov/fdsnws/event/1",
  "agency": "PHIVOLCS",
  "minMagnitude": 5.5,
  "bbox": [120.0, 5.0, 127.0, 10.0],
  "limit": 20,
  "minPgaG": 0.15,
  "asGeoJSON": "contours",
  "samplePayload": {}
}
```

## 33. `drr_critical_infra_overlay`
Groups critical infrastructure assets by the **9 UNDRR Sendai Framework Target D sectors** (`health`, `education`, `water`, `transportation`, `telecommunications`, `energy`, `waste_management`, `protective_infrastructure`, `other_essential`; registered method `overlay.sendai.critical_infra_v1`), ingests layers via **OGC API – Features** (`OGC 17-069r4`) or GeoJSON, overlays onto hazard footprints, separates direct physical exposure (`D-2..D-4`) from cascading lifeline disruption risk (`D-6..D-8` via `dependsOn`), and enforces CIP sensitivity redaction when `audience: "public"`.

```json
{
  "endpointUrl": "https://gis.agency.gov/ogcapi",
  "collection": "critical-infrastructure",
  "infraGeoJSON": {},
  "hazardGeoJSON": {},
  "sectors": ["health", "energy", "water", "protective_infrastructure"],
  "audience": "eoc_internal | public"
}
```

## 34. `drr_hdx_hapi_fetch`
Queries and normalizes **OCHA HDX Humanitarian API (HAPI v2)** indicators (`population-social/population`, `affected-people/humanitarian-needs`, `affected-people/idps`, `affected-people/refugees-persons-of-concern`, `coordination-context/operational-presence`, `metadata/*`; registered method `telemetry.hdx.hapi_v1`) with ISO3/P-code validation, freshness screening (`maxAgeDays`), open-license redistribution checks, SSRF protection, and SHA-256 provenance.

```json
{
  "resource": "population-social/population",
  "locationCode": "THA",
  "adminLevel": 2,
  "maxAgeDays": 365,
  "samplePayload": {}
}
```

## 35. `drr_cod_boundary_validate`
Validates **OCHA COD-AB** administrative boundary GeoJSON or metadata records (`spatial.cod_ab.validation_v1`) for ISO3 alignment, P-code syntax & uniqueness, parent-child hierarchy nesting, release freshness, RFC 7946 geometry validity, and optional reconciliation against UNDRR DELTA administrative divisions.

```json
{
  "boundaryGeoJSON": {},
  "expectedIso3": "THA",
  "expectedAdminLevel": 2,
  "boundarySource": "OCHA ROAP COD-AB",
  "deltaDivisions": ["TH9001", "TH9002"]
}
```

## 36. `drr_humanitarian_severity_assess`
Evaluates a **JIAF 2.0 / INFORM-aligned** multi-factor humanitarian rapid impact and severity assessment (phases 1–5; registered method `assessment.humanitarian.severity_v1`), explicitly separating `hazardIntensity`, `exposure`, `vulnerability`, `copingCapacityDeficit`, and `dataConfidence` without reducing severity to hazard magnitude alone or coercing missing dimensions to `0`. Supports single-area assessments or multi-unit ADM1/ADM2 priority ranking (`units[]`).

```json
{
  "pcode": "TH9001",
  "unitName": "Hat Yai",
  "hazardType": "flood",
  "hazardIntensity": 7.5,
  "affectedPopulation": 42000,
  "totalPopulation": 160000,
  "vulnerability": 6.2,
  "copingCapacityDeficit": 5.8
}
```

## 37. `drr_benchmark_run`
Runs the curated GeoDisaster-inspired multi-step DRR agent benchmark suite (`tests/benchmarks/geodisaster-scenarios.json`) to score tool selection, numerical accuracy, non-goal compliance, provenance coverage, and schema validity across deterministic reference trajectories or external LLM agent traces.

```json
{
  "category": "humanitarian_severity_and_cod",
  "scenarioId": "geo-04-hdx-cod-severity",
  "trajectories": {}
}
```

## 38. `drr_hdx_polygon_population_estimate`
Estimates exposed population inside an arbitrary hazard polygon (or `epicenter` + `bufferKm`) by intersecting it with **OCHA COD-AB** administrative boundaries and joining **OCHA HDX HAPI v2** population counts by P-code via deterministic areal interpolation (`exposure.hdx.polygon_population_v1`). Reports both area-weighted and full-unit totals, preserves missing HAPI counts as `null` (`R-02`), separates modelled exposure from Sendai `B-1` (`C-01`), and flags uniform-density caveats.

```json
{
  "hazardGeoJSON": {},
  "epicenter": [100.45, 7.0],
  "bufferKm": 15,
  "codBoundaryGeoJSON": {},
  "hapiSamplePayload": {},
  "expectedIso3": "THA",
  "expectedAdminLevel": 2,
  "gridResolution": 25
}
```

## 39. `drr_osm_critical_infra_fetch`
Interim open-source critical infrastructure fallback via **OpenStreetMap (Overpass API)** mapped to the 9 UNDRR Sendai Target D sectors (`exposure.osm.interim_critical_infra_v1`; SSRF-guarded, max 5° × 5° bbox span). Returns a Sendai-normalized GeoJSON FeatureCollection with `verificationStatus: "external_unverified"`, `reportingEligibility: "screening_only"`, and ODbL-1.0 attribution, and can optionally invoke `drr_critical_infra_overlay` directly when `hazardGeoJSON` or `epicenter` + `bufferKm` is provided.

```json
{
  "bbox": [100.40, 6.95, 100.55, 7.08],
  "sectors": ["health", "energy", "water", "protective_infrastructure"],
  "hazardGeoJSON": {},
  "samplePayload": {}
}
```

## 40. `drr_hdx_catalog_search`
Searches the public **OCHA HDX CKAN v3** dataset catalog (no API key required) for COD-AB administrative boundaries, COD-PS population statistics, WorldPop rasters, Kontur population grids, and HOTOSM critical infrastructure layers.

```json
{
  "iso3": "THA",
  "query": "population",
  "limit": 10,
  "samplePayload": {}
}
```

## 42. `drr_sitrep_reconcile`
Reconciles conflicting multi-source disaster impact claims (national official authorities, sub-national LGUs, humanitarian clusters, modelled estimates, and unverified media) without silently collapsing figures into a single unattributed number, and/or computes a deterministic version-to-version SitRep diff with SHA-256 provenance.

```json
{
  "claims": [
    {
      "source": "NDRRMC Situational Report #4",
      "authorityTier": "national_official",
      "evidenceBasis": "confirmed",
      "metric": "affected_population",
      "value": 12000,
      "pcode": "PH160200000",
      "reportedAt": "2025-11-12T06:00:00Z"
    }
  ],
  "previousSitRep": {},
  "currentSitRep": {},
  "options": { "conflictThresholdPct": 10, "eventId": "PHL-TY-2025-01" }
}
```

---

# Part 2: Command-Line Interface (CLI) Reference (42 Subcommands)

Run `node bin/cli.js --help` (or `drr-tool --help`) for usage.

* **Telemetry & Hydro**: `gdacs`, `adam`, `usgs`, `fdsn-shakemap`, `forecast`, `sensorthings`, `stac-hazard`, `hdx-hapi`, `hdx-search`, `basin-rainfall`, `river-discharge`, `monitor`
* **Contracts, Registry, Replay & Benchmarks**: `validate-input`, `registry`, `replay-validate`, `benchmark`
* **Spatial, COD-AB, Overlay & Raster**: `spatial-join`, `infra-overlay`, `osm-infra`, `cod-validate`, `hdx-polygon-pop`, `geojson-validate`, `geometry-repair`, `crs-transform`, `raster-zonal-stats`
* **Fragility, Vulnerability, Severity & Sendai**: `fragility` *(requires `--intensity`)*, `vulnerability` *(requires `--spatial` and `--intensity`)*, `severity-assess`, `sendai-validate`
* **Taxonomy, Event Identity & SitRep Reconciliation**: `hazard-crosswalk`, `event-dedup`, `sitrep-reconcile`
* **Uncertainty & Appraisal**: `uncertainty`, `eal`, `cba`
* **CAP & SitRep**: `cap-generate` *(defaults to `--status Draft`)*, `cap-validate`, `sitrep`
* **DELTA Interoperability**: `delta-validate`, `delta-push` *(requires `--file`)*, `delta-docs`, `delta-hazards`

### `drr-tool adam` Options
```bash
node bin/cli.js adam --list-collections
node bin/cli.js adam --collection eq --min-mag 5.5 --iso3 PHL --limit 10
node bin/cli.js adam --collection glofas --bbox 97.0,5.0,106.0,21.0 --limit 20
node bin/cli.js adam --collection ts_buffers --min-level Orange --file examples/wfp-adam-ogc/sample-adam-eq.json
```
Supported flags: `--collection <alias|id>`, `--limit <n>`, `--offset <n>`, `--bbox <minLon,minLat,maxLon,maxLat>`, `--datetime <iso8601>`, `--country <name>`, `--iso3 <code>`, `--min-mag <n>`, `--min-level <Green|Orange|Red>`, `--list-collections`, `--file <path>`.
