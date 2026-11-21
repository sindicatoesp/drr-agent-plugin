# MCP Tools & CLI Technical Reference

Complete technical specification of all **32 MCP tools** provided by `bin/mcp-server.js` and the **32 CLI commands** in `bin/cli.js`.

> **Inventory Note (R-01)**: Historically at baseline commit `1d7600ce5cc50dcdea7b438ccbd59d28282793dd` (`origin/dev`), `bin/mcp-server.js` registered 11 tools (including `drr_delta_docs`) while this reference listed 10. Both `docs/api-reference.md` and `docs/tool-inventory.md` are now reconciled with the full **32-tool** registration source.

---

# Part 1: Model Context Protocol (MCP) Tools (32 Tools)

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

## 2. `drr_usgs_earthquake_fetch`
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

---

# Part 2: Command-Line Interface (CLI) Reference (32 Subcommands)

Run `node bin/cli.js --help` (or `drr-tool --help`) for usage.

* **Telemetry & Hydro**: `gdacs`, `usgs`, `fdsn-shakemap`, `forecast`, `sensorthings`, `stac-hazard`, `basin-rainfall`, `river-discharge`, `monitor`
* **Contracts, Registry & Replay**: `validate-input`, `registry`, `replay-validate`
* **Spatial, CRS & Raster**: `spatial-join`, `geojson-validate`, `geometry-repair`, `crs-transform`, `raster-zonal-stats`
* **Fragility, Vulnerability & Sendai**: `fragility` *(requires `--intensity`)*, `vulnerability` *(requires `--spatial` and `--intensity`)*, `sendai-validate`
* **Taxonomy & Event Identity**: `hazard-crosswalk`, `event-dedup`
* **Uncertainty & Appraisal**: `uncertainty`, `eal`, `cba`
* **CAP & SitRep**: `cap-generate` *(defaults to `--status Draft`)*, `cap-validate`, `sitrep`
* **DELTA Interoperability**: `delta-validate`, `delta-push` *(requires `--file`)*, `delta-docs`, `delta-hazards`
