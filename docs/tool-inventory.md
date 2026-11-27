# DRR Agent Plugin — Authoritative Tool & Capability Inventory

> Generated directly from executable registration sources by `scripts/generate-inventory.js` (R-01).

## Baseline & Manifest Reconciliation

- **Package**: `@sindicatoesp/drr-agent-plugin` v1.12.0
- **Plugin Manifest**: `drr-analytics` v1.12.0
- **MCP Server**: `drr-analytics-mcp` v1.12.0 (protocol `2024-11-05`)
- **Git Branch**: `feat/gemini-api-adapter`
- **Reference Baseline Commit (`origin/dev`)**: `0b3aafb8ec1436bee3ab54277b9e341d0e284bbd`
- **Current HEAD Commit**: `0b3aafb8ec1436bee3ab54277b9e341d0e284bbd`
- **Registered MCP Tools**: 44
- **Registered CLI Subcommands**: 44
- **Library Modules (`lib/*.js`)**: 36
- **Public Exports (`lib/index.js`)**: 282
- **Skills (`skills/*/SKILL.md`)**: 19
- **Skills Manifest**: `skills-manifest.json`
- **Test Suites (`tests/test-*.js`)**: 37

### Documentation Reconciliation Note
- **Historical 10-vs-11 discrepancy (`origin/dev`)**: `bin/mcp-server.js` registered 11 tools (including `drr_delta_docs`), whereas `docs/api-reference.md` documented 10 tools and omitted `drr_delta_docs`. Both `docs/api-reference.md` and `README.md` are now reconciled with the expanded registration baseline of **44 MCP tools**.

## Registered MCP Tools (44)

| # | Tool Name | Required Args | Optional Args | Test Mapping | Description |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `drr_gdacs_fetch` | — | `minAlertLevel`, `eventType`, `country`, `samplePayload`, `compact` | `tests/test-monitor.js, tests/test-security-cap.js, tests/test-mcp-server.js` | Ingest and filter GDACS (Global Disaster Alert and Coordination System) active alerts by severity, event type (EQ, TC, FL, VO), or country. |
| 2 | `drr_adam_fetch` | — | `collection`, `limit`, `offset`, `bbox`, `datetime`, `country`, `iso3`, `minMagnitude`, `minAlertLevel`, `listCollections`, `samplePayload`, `compact` | `tests/test-mcp-server.js` | Ingest pre-processed WFP ADAM (Automated Disaster Analysis and Mapping) OGC API - Features feeds (earthquakes, floods, GloFAS gauge return periods, tropical storm tracks/wind buffers, and population/cropland exposure). |
| 3 | `drr_usgs_earthquake_fetch` | — | `minMagnitude`, `limit`, `samplePayload`, `compact` | `tests/test-usgs.js, tests/test-mcp-server.js` | Query the USGS Earthquake Hazards Program for real-time seismic events and calculate estimated Peak Ground Acceleration (PGA in g) using Wald et al. (1999) GMICE. |
| 4 | `drr_openmeteo_forecast` | — | `latitude`, `longitude`, `days`, `triggerPolicy`, `previousRuns`, `samplePayload` | `tests/test-openmeteo.js, tests/test-mcp-server.js` | Retrieve Open-Meteo multi-day weather forecasts for Anticipatory Action rainfall-threshold screening (never fabricates flood depth). |
| 5 | `drr_spatial_exposure_join` | `hazardGeoJSON`, `exposureGeoJSON` | `epicenter`, `bufferKm` | `tests/test-spatial.js, tests/test-spatial-hydro.js` | Execute deterministic spatial joins between a hazard footprint (Polygon/MultiPolygon GeoJSON) and exposed assets (FeatureCollection). |
| 6 | `drr_fragility_eval` | `hazardType`, `intensity` | `unit`, `taxonomy`, `occupancy`, `mode` | `tests/test-fragility.js, tests/test-contracts-registry.js, tests/test-mcp-server.js` | Calculate illustrative GEM/HAZUS structural damage state probabilities and Mean Damage Ratio (MDR) with explicit unit conversions and model registry provenance. |
| 7 | `drr_vulnerability_matrix_calc` | `spatialReport`, `hazardType`, `intensity` | `unit`, `defaultTaxonomy`, `currency`, `valuationYear` | `tests/test-vulnerability.js, tests/test-hindcast-regression.js` | Compute vulnerability matrix, estimated direct economic losses (Target C), modelled displacement (distinct from Sendai B-1), and physical infrastructure damage (distinct from service disruption D-6..D-8). |
| 8 | `drr_cap_alert_generate_validate` | — | `mode`, `alertParams`, `xmlString`, `context` | `tests/test-cap.js, tests/test-security-cap.js, tests/test-mcp-server.js` | Generate and validate an ITU-T X.1303 / OASIS CAP v1.2 XML alert (default Draft, XXE-hardened, separated validity/authenticity/authorization), or synthesize a markdown situation brief. |
| 9 | `drr_cap_publish` | `xmlString` | `channelType`, `destination`, `permissionScope`, `approvalToken`, `idempotencyKey` | `tests/test-security-cap.js, tests/test-mcp-server.js` | Authorized publication adapter for CAP alerts enforcing schema validity, channel-vs-status safety (Draft/Test/Exercise blocked on production), destination allowlists, idempotency, and verified approval binding. |
| 10 | `drr_delta_push_draft_record` | `assessment` | `name`, `notes`, `mock`, `tenantContext` | `tests/test-delta.js, tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js` | Push a schema-validated post-disaster assessment into DELTA Resilience as a 'Draft' record with status: 'draft', source: 'drr-agent-plugin', and preserved C-03 governance metadata. |
| 11 | `drr_delta_fetch_exposure` | — | `entity`, `filter`, `mock` | `tests/test-delta.js` | Query DELTA Resilience core database via MCP for baseline administrative divisions, sector assets, HIP catalogs, or historical disaster records. |
| 12 | `drr_delta_docs` | — | `mock` | `tests/test-delta.js, tests/test-mcp-server.js` | Query DELTA Resilience MCP 'docs' tool to retrieve DTS system documentation, entity relationships, workflows, and HIP taxonomy reference. |
| 13 | `drr_delta_schema_validate` | `payload` | — | `tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js` | Validate a DELTA relational assessment bundle against DTS fieldsDefApi contracts, HIP triad completeness, wire sanitization, PostGIS SRID 4326 footprint, and Sendai relations. |
| 14 | `drr_monitor_check` | — | `configPath`, `mock`, `readOnly`, `scopeId`, `stateBackend`, `runDeadlineMs` | `tests/test-monitor.js, tests/test-scheduled-monitoring.js, tests/test-mcp-server.js` | Execute a bounded single-run monitoring cycle against multi-source disaster feeds (USGS, GDACS, Open-Meteo) using alerts-config.json rules, durable CAS state/leases, event deduplication, and read-only shadow mode protection. |
| 15 | `drr_input_contract_validate` | `input` | `strictMissingData` | `tests/test-contracts-registry.js, tests/test-mcp-server.js` | Validate DRR assessment inputs across hazard intensity/units, coordinate order, temporal intervals, currency/valuationYear, and missing-data semantics (unknown !== zero). |
| 16 | `drr_source_provenance_manifest` | — | `sourceIds`, `method`, `inputsSnapshot`, `evidenceBasis`, `verificationStatus`, `approvalStatus`, `seed` | `tests/test-contracts-registry.js, tests/test-mcp-server.js` | Generate a secret-sanitized provenance and independent C-03 governance manifest (evidenceBasis, verificationStatus, approvalStatus, reportingEligibility, SHA-256 snapshot hash). |
| 17 | `drr_model_registry_list` | — | `methodId`, `value`, `assetClass`, `mode` | `tests/test-contracts-registry.js, tests/test-mcp-server.js` | List all registered scientific models, empirical bounds, units, and illustrative vs. production applicability status (or check applicability of a specific methodId). |
| 18 | `drr_assessment_replay_validate` | — | `suite` | `tests/test-sendai-replay.js, tests/test-mcp-server.js` | Run deterministic frozen-input replay verification suite covering L0/L1 mathematical invariants, L2 reference model verification, and L3 multi-event historical hindcast & FbF trigger skill benchmarks. |
| 19 | `drr_sendai_validate` | `payload` | `requireCalibratedMethodology` | `tests/test-sendai-replay.js, tests/test-mcp-server.js` | Validate UNDRR Sendai Framework Monitor semantics: separates displacement from B-1 directly affected, physical damage (D-2..D-4) from disruption (D-6..D-8), enforces denominators for per-100k metrics, and separates C-03 states. |
| 20 | `drr_hazard_crosswalk` | `query` | `sourceSystem`, `candidateLimit` | `tests/test-events-crosswalk.js, tests/test-mcp-server.js` | Versioned UNDRR-ISC HIP hazard crosswalk: performs deterministic resolution on exact IDs/codes/aliases while returning human-reviewed candidates for ambiguous free-text queries. |
| 21 | `drr_event_match_deduplicate` | `incomingEvents` | `existingCatalog`, `spatialRadiusKm`, `timeWindowHours` | `tests/test-events-crosswalk.js, tests/test-mcp-server.js` | Multi-source event identity & deduplication engine classifying exact ID matches, revision updates, possible cross-source duplicates (held for review), and non-causal cascading candidates. |
| 22 | `drr_geojson_validate` | `geojson` | `crs` | `tests/test-spatial-hydro.js, tests/test-mcp-server.js` | Validate GeoJSON geometry structure, coordinate order/ranges, ring closure, zero-area degeneracy, winding order, antimeridian crossings, and self-intersections. |
| 23 | `drr_geometry_repair` | `geojson`, `repairRequested` | — | `tests/test-spatial-hydro.js, tests/test-mcp-server.js` | Opt-in auditable GeoJSON ring closure, duplicate vertex removal, and RFC 7946 winding repair preserving originalGeometry and reporting area/topology deltas. |
| 24 | `drr_crs_transform` | `input`, `fromCrs`, `toCrs` | — | `tests/test-spatial-hydro.js, tests/test-mcp-server.js` | Reproject coordinates or GeoJSON geometries between WGS84 geographic (EPSG:4326), Web Mercator (EPSG:3857), and WGS84 UTM zones (EPSG:326xx/327xx). |
| 25 | `drr_raster_zonal_stats` | `rasterGrid`, `zoneGeoJSON` | `zoneCrs`, `boundaryDataset`, `boundaryVersion` | `tests/test-spatial-hydro.js, tests/test-mcp-server.js` | Compute zonal statistics of a gridded raster within vector zone boundaries distinguishing count vs. density_per_sqkm vs. continuous semantics with explicit nodata and CRS alignment checks. |
| 26 | `drr_basin_rainfall_aggregate` | `stationsOrGrid` | `basinId`, `basinName`, `basinGeoJSON`, `dates`, `method` | `tests/test-spatial-hydro.js, tests/test-mcp-server.js` | Aggregate point/grid rainfall forecasts (mm) over a catchment polygon with station weights (never produces fabricated flood depth). |
| 27 | `drr_river_discharge_screen` | `dailyDischargeM3s` | `dates`, `returnPeriodThresholds`, `gridResolutionKm`, `upstreamDrainageAreaSqKm`, `isRiverCell` | `tests/test-spatial-hydro.js, tests/test-mcp-server.js` | Screen GloFAS / Open-Meteo river discharge (m^3/s) against local return-period thresholds with river-cell suitability checks (never labelled as inundation depth). |
| 28 | `drr_uncertainty_propagate` | `hazardType`, `intensity`, `exposedValueUsd` | `mode`, `taxonomy`, `occupancy`, `seed`, `iterations`, `allowIllustrativeDistributions`, `distributions` | `tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js` | Propagate input/parameter uncertainty via deterministic min/central/max bounds, one-at-a-time sensitivity ranking, and reproducible seeded Monte Carlo with convergence checks. |
| 29 | `drr_expected_annual_loss` | `points`, `currency`, `valuationYear` | `tailHandling` | `tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js` | Integrate a multi-return-period loss-exceedance curve via trapezoidal AEP integration (rejects single-event scenario losses masquerading as EAL). |
| 30 | `drr_mitigation_cost_benefit` | `baselineEal`, `mitigatedEal`, `capex`, `discountRate`, `horizonYears`, `currency`, `valuationYear` | `optionName`, `annualOpex`, `annualCoBenefits` | `tests/test-delta-uncertainty-appraisal.js, tests/test-mcp-server.js` | Evaluate DRR mitigation option Cost-Benefit Analysis (NPV, BCR, residual risk EAL, CapEx/OpEx discounting, sensitivity matrix) separating quantitative metrics from policy judgements. |
| 31 | `drr_sensorthings_fetch` | — | `endpointUrl`, `observedProperty`, `filter`, `top`, `observationsTop`, `thresholds`, `maxAgeMinutes`, `excludeSuspect`, `asGeoJSON`, `samplePayload` | `tests/test-sensorthings.js, tests/test-mcp-server.js` | Ingest and normalize custom government or private in-situ sensor observations via OGC SensorThings API v1.1 (OGC 18-088) with unit conversion, WMO/QARTOD QC filtering, staleness checks, licensing/redistribution metadata, and optional threshold screening. |
| 32 | `drr_stac_hazard_fetch` | — | `endpointUrl`, `bbox`, `datetime`, `collections`, `limit`, `maxCloudCover`, `sampleDepthGrid`, `asGeoJSON`, `samplePayload` | `tests/test-stac.js, tests/test-mcp-server.js` | Ingest STAC v1.0.0 Earth Observation catalogs (Copernicus EMS, Sentinel-1 SAR, ICEYE, Floodbase) and validate flood depth grids via ingestValidatedInundationGrid (C-05/R-12), separating flood extent from depth and enforcing commercial licensing, cloud cover, and SSRF guards. |
| 33 | `drr_fdsn_shakemap_fetch` | — | `endpointUrl`, `agency`, `minMagnitude`, `startTime`, `endTime`, `bbox`, `limit`, `minPgaG`, `shakemapContours`, `shakemapStations`, `shakemapPgaGrid`, `asGeoJSON`, `samplePayload` | `tests/test-shakemap.js, tests/test-mcp-server.js` | Ingest custom national FDSN-WS seismic events (BMKG, PHIVOLCS, JMA, EMSC, GeoNet, USGS) and ShakeMap v4 PGA/PGV/Vs30 contours, instrumented station lists, and gridded PGA rasters (upgrading C-04 beyond Wald99 GMICE). |
| 34 | `drr_critical_infra_overlay` | — | `endpointUrl`, `collection`, `bbox`, `limit`, `infraGeoJSON`, `infraLayers`, `hazardGeoJSON`, `epicenter`, `bufferKm`, `sectors`, `audience` | `tests/test-infra-overlay.js, tests/test-mcp-server.js` | Group critical infrastructure assets by the 9 UNDRR Sendai Framework Target D sectors (health, education, water, transportation, telecommunications, energy, waste_management, protective_infrastructure, other_essential), ingest via OGC API - Features or GeoJSON, overlay onto hazard footprints, evaluate lifeline dependency cascades (D-6..D-8 separate from D-2..D-4), and enforce CIP sensitivity redaction. |
| 35 | `drr_osm_critical_infra_fetch` | — | `bbox`, `sectors`, `endpointUrl`, `timeoutSec`, `maxElements`, `hazardGeoJSON`, `epicenter`, `bufferKm`, `audience`, `samplePayload` | `tests/test-osm-infra.js, tests/test-mcp-server.js` | Interim open-source critical infrastructure fallback via OpenStreetMap (Overpass API) mapped to the 9 UNDRR Sendai Target D sectors (verificationStatus='external_unverified', ODbL-1.0 attribution, SSRF & bbox-span guarded). Produces a GeoJSON FeatureCollection compatible with drr_critical_infra_overlay and can optionally run the hazard overlay directly. |
| 36 | `drr_hdx_hapi_fetch` | — | `endpointUrl`, `resource`, `locationCode`, `admin1Code`, `admin2Code`, `adminLevel`, `appIdentifier`, `maxAgeDays`, `limit`, `samplePayload` | `tests/test-hdx-cod.js, tests/test-mcp-server.js` | Query and normalize OCHA HDX Humanitarian API (HAPI v2) indicators (population, humanitarian needs, IDPs, refugees, operational presence, metadata) with ISO3/P-code validation, freshness screening, license/redistribution checks, SSRF protection, and SHA-256 provenance. |
| 37 | `drr_cod_boundary_validate` | — | `boundaryGeoJSON`, `records`, `expectedIso3`, `expectedAdminLevel`, `maxAgeDays`, `boundarySource`, `deltaDivisions` | `tests/test-hdx-cod.js, tests/test-mcp-server.js` | Validate OCHA Common Operational Datasets - Administrative Boundaries (COD-AB) GeoJSON or metadata records for ISO3 codes, P-code syntax/uniqueness, parent-child hierarchy, release freshness, RFC 7946 geometry validity, and optional reconciliation against UNDRR DELTA divisions. |
| 38 | `drr_hdx_catalog_search` | — | `query`, `countryIso3`, `codLevel`, `format`, `geodataOnly`, `rows`, `sort`, `endpointUrl`, `samplePayload` | `tests/test-hdx-cod.js, tests/test-mcp-server.js` | Search the public OCHA HDX CKAN Action API v3 catalog (data.humdata.org/api/3/action/package_search — no API key required) to discover downloadable COD-AB administrative boundaries, COD-PS subnational population CSVs, WorldPop/Kontur population grids, and HOTOSM geodata with license, freshness, and SHA/MD5 resource metadata. |
| 39 | `drr_hdx_polygon_population_estimate` | `codBoundaryGeoJSON` | `hazardGeoJSON`, `epicenter`, `bufferKm`, `hapiSamplePayload`, `populationByPcode`, `expectedIso3`, `expectedAdminLevel`, `gridResolution`, `endpointUrl`, `appIdentifier`, `gender`, `ageRange`, `maxAgeDays` | `tests/test-hdx-cod.js, tests/test-mcp-server.js` | Estimate population exposed inside an arbitrary hazard polygon (or epicenter + bufferKm) by intersecting it with OCHA COD-AB administrative boundaries and joining OCHA HDX HAPI population statistics by P-code via deterministic areal interpolation (reporting both area-weighted and full-unit totals, preserving null !== 0, and flagging uniform-density caveats). |
| 40 | `drr_humanitarian_severity_assess` | — | `pcode`, `unitName`, `hazardType`, `hazardIntensity`, `exposure`, `vulnerability`, `copingCapacityDeficit`, `copingCapacity`, `affectedPopulation`, `totalPopulation`, `exposedFacilities`, `spatialReport`, `vulnerabilityReport`, `infraOverlay`, `weights`, `units` | `tests/test-severity.js, tests/test-mcp-server.js` | Evaluate a JIAF 2.0 / INFORM-aligned multi-factor humanitarian rapid impact and severity assessment (phases 1-5), explicitly separating hazard intensity, exposure, vulnerability, coping capacity deficit, and data confidence without reducing severity to hazard magnitude alone or coercing missing dimensions to 0. |
| 41 | `drr_benchmark_run` | — | `category`, `scenarioId`, `trajectories` | `tests/test-benchmarks.js, tests/test-agent-eval-harness.js, tests/test-mcp-server.js` | Run the curated GeoDisaster-inspired multi-step DRR agent benchmark suite to score tool selection, numerical accuracy, non-goal compliance, provenance coverage, and schema validity across deterministic reference or external agent trajectories. |
| 42 | `drr_sitrep_reconcile` | — | `claims`, `previousSitRep`, `currentSitRep`, `options` | `tests/test-reconcile.js, tests/test-mcp-server.js` | Reconcile conflicting multi-source disaster impact claims (national authority, LGU, humanitarian cluster, modelled estimates) without silently collapsing figures, and/or compute a deterministic version-to-version SitRep diff with SHA-256 provenance. |
| 43 | `drr_workflow_plan` | — | `goal`, `workflowId`, `context`, `availableInputs` | `tests/test-mcp-server.js` | Plan a goal-oriented DRR workflow (flood infrastructure risk, earthquake rapid impact, cyclone early warning, SitRep reconciliation, or anticipatory action trigger check) with action-tier permissions, missing-input clarification questions, and human-approval gates. |
| 44 | `drr_gemini_analyze` | — | `mode`, `text`, `targetLanguage`, `audience`, `imageBase64`, `imageMimeType`, `source`, `authorityTier`, `country`, `reportedAt`, `model`, `samplePayload` | `tests/test-gemini.js, tests/test-mcp-server.js` | Invoke Google Gemini API (pure Node.js REST, zero external deps) for structured DRR field-report impact claim extraction (compatible with drr_sitrep_reconcile), multilingual CAP/SitRep brief translation with deterministic numeric-fidelity checks, or preliminary multimodal visual damage screening mapped to Sendai Target D sectors. Enforces unknown !== 0, C-03 Draft/unreviewed governance, secret redaction, and offline samplePayload support. |

## Registered CLI Subcommands (44)

- `drr-tool fragility`
- `drr-tool gdacs`
- `drr-tool adam`
- `drr-tool usgs`
- `drr-tool forecast`
- `drr-tool basin-rainfall`
- `drr-tool river-discharge`
- `drr-tool spatial-join`
- `drr-tool geojson-validate`
- `drr-tool geometry-repair`
- `drr-tool crs-transform`
- `drr-tool raster-zonal-stats`
- `drr-tool vulnerability`
- `drr-tool sendai-validate`
- `drr-tool hazard-crosswalk`
- `drr-tool event-dedup`
- `drr-tool validate-input`
- `drr-tool registry`
- `drr-tool replay-validate`
- `drr-tool uncertainty`
- `drr-tool eal`
- `drr-tool cba`
- `drr-tool cap-generate`
- `drr-tool cap-validate`
- `drr-tool sitrep`
- `drr-tool delta-validate`
- `drr-tool delta-push`
- `drr-tool delta-docs`
- `drr-tool delta-hazards`
- `drr-tool monitor`
- `drr-tool sensorthings`
- `drr-tool stac-hazard`
- `drr-tool fdsn-shakemap`
- `drr-tool infra-overlay`
- `drr-tool osm-infra`
- `drr-tool hdx-hapi`
- `drr-tool cod-validate`
- `drr-tool hdx-search`
- `drr-tool hdx-polygon-pop`
- `drr-tool severity-assess`
- `drr-tool benchmark`
- `drr-tool sitrep-reconcile`
- `drr-tool workflow-plan`
- `drr-tool gemini-analyze`

## Library Modules (36)

- `lib/adam.js`
- `lib/appraisal.js`
- `lib/benchmarks.js`
- `lib/cap.js`
- `lib/config.js`
- `lib/contracts.js`
- `lib/delta.js`
- `lib/events.js`
- `lib/fragility.js`
- `lib/gdacs.js`
- `lib/gemini.js`
- `lib/hdx.js`
- `lib/hips.js`
- `lib/hydro.js`
- `lib/index.js`
- `lib/infra-overlay.js`
- `lib/monitor.js`
- `lib/openmeteo.js`
- `lib/osm-infra.js`
- `lib/reconcile.js`
- `lib/registry.js`
- `lib/replay.js`
- `lib/retry.js`
- `lib/security.js`
- `lib/sendai.js`
- `lib/sensorthings.js`
- `lib/severity.js`
- `lib/shakemap.js`
- `lib/spatial.js`
- `lib/stac.js`
- `lib/state-store.js`
- `lib/uncertainty.js`
- `lib/usgs.js`
- `lib/utils.js`
- `lib/vulnerability.js`
- `lib/workflows.js`

## Knowledge Skills (19)

- `skills/cap-governance-and-approval/SKILL.md`
- `skills/critical-infrastructure-overlay/SKILL.md`
- `skills/delta-disaster-recording/SKILL.md`
- `skills/drr-data-quality-and-provenance/SKILL.md`
- `skills/early-warning-telemetry/SKILL.md`
- `skills/event-identity-and-linkage/SKILL.md`
- `skills/fdsn-shakemap-seismic/SKILL.md`
- `skills/forecast-based-action-trigger-design/SKILL.md`
- `skills/gdacs-feed-ingestion/SKILL.md`
- `skills/hazard-exposure-modeling/SKILL.md`
- `skills/hdx-hapi-and-cod-boundaries/SKILL.md`
- `skills/humanitarian-rapid-impact-severity/SKILL.md`
- `skills/oasis-cap-alerting/SKILL.md`
- `skills/ogc-sensorthings-telemetry/SKILL.md`
- `skills/risk-reduction-options-appraisal/SKILL.md`
- `skills/sendai-indicator-accounting/SKILL.md`
- `skills/stac-eo-hazard-grids/SKILL.md`
- `skills/undrr-hip-hazard-classification/SKILL.md`
- `skills/vulnerability-matrix/SKILL.md`

## Automated Test Suites (37)

- `tests/test-adam.js`
- `tests/test-agent-eval-harness.js`
- `tests/test-benchmarks.js`
- `tests/test-cap.js`
- `tests/test-cli-inventory.js`
- `tests/test-config.js`
- `tests/test-contracts-registry.js`
- `tests/test-delta-uncertainty-appraisal.js`
- `tests/test-delta.js`
- `tests/test-dpg-compliance.js`
- `tests/test-end-user-workflows.js`
- `tests/test-events-crosswalk.js`
- `tests/test-fragility.js`
- `tests/test-gemini.js`
- `tests/test-harness-eval.js`
- `tests/test-hdx-cod.js`
- `tests/test-hindcast-regression.js`
- `tests/test-infra-overlay.js`
- `tests/test-l2-l3-validation.js`
- `tests/test-mcp-server.js`
- `tests/test-monitor.js`
- `tests/test-openmeteo.js`
- `tests/test-osm-infra.js`
- `tests/test-reconcile.js`
- `tests/test-release-version.js`
- `tests/test-scheduled-monitoring.js`
- `tests/test-security-cap.js`
- `tests/test-sendai-replay.js`
- `tests/test-sensorthings.js`
- `tests/test-severity.js`
- `tests/test-shakemap.js`
- `tests/test-spatial-hydro.js`
- `tests/test-spatial.js`
- `tests/test-stac.js`
- `tests/test-static-infra.js`
- `tests/test-usgs.js`
- `tests/test-vulnerability.js`

## Public Exports from `lib/index.js` (282)

`ADAM_COLLECTIONS`, `APPROVAL_STATUS_VALUES`, `APPROVED_RETENTION_POLICIES`, `AUTHORITY_TIERS`, `ActionPolicyGuard`, `AuthoritativeStateStore`, `CAP_XMLNS`, `CASCADING_HAZARD_PAIRS`, `COD_VALIDATION_METHOD_ID`, `COMMON_ALIASES`, `CONFIG`, `CONTRACT_SCHEMA_VERSION`, `DAMAGE_RATIO_WEIGHTS`, `DEFAULT_BENCHMARK_PATH`, `DEFAULT_FRESHNESS_THRESHOLDS_MS`, `DEFAULT_GEMINI_API_URL`, `DEFAULT_GEMINI_MODEL`, `DEFAULT_HAPI_BASE_URL`, `DEFAULT_HDX_CKAN_URL`, `DEFAULT_OVERPASS_URL`, `DEFAULT_PILLAR_WEIGHTS`, `DEFAULT_POLICY_GUARD`, `EVIDENCE_BASIS_VALUES`, `EXTERNAL_SYSTEM_CROSSWALK`, `FileCasStateStore`, `GDACS_FEED_URL`, `GEMINI_METHOD_ID`, `HDX_CKAN_CATALOG_METHOD_ID`, `HDX_HAPI_METHOD_ID`, `HDX_POLYGON_POP_METHOD_ID`, `HIP_CLUSTERS`, `HIP_CROSSWALK_VERSION`, `HIP_HAZARDS`, `HIP_HAZARD_MAP`, `HIP_TAXONOMY_VERSION`, `HIP_TYPES`, `HTTPS_KEEPALIVE_AGENT`, `HTTP_KEEPALIVE_AGENT`, `INFRA_OVERLAY_METHOD_ID`, `INTENSITY_UNIT_SPECS`, `InMemoryCasStateStore`, `MAX_BBOX_SPAN_DEG`, `MODEL_REGISTRY`, `MONITOR_SUMMARY_SCHEMA_VERSION`, `OPENMETEO_API_URL`, `OSM_INTERIM_INFRA_METHOD_ID`, `OSM_SENDAI_SECTOR_QUERIES`, `POLICY_VERSION`, `ProviderBudgetTracker`, `RECONCILE_METHOD_ID`, `REPORTING_ELIGIBILITY_VALUES`, `RESPONSE_SCHEMAS`, `RETRY_SCHEMA_VERSION`, `SEISMIC_FRAGILITY_PARAMS`, `SENDAI_CRITICAL_INFRASTRUCTURE`, `SENDAI_INFRA_SECTORS`, `SENDAI_REFERENCE`, `SENSORTHINGS_METHOD_ID`, `SEVERITY_METHOD_ID`, `SEVERITY_PHASES`, `SHAKEMAP_METHOD_ID`, `STAC_METHOD_ID`, `STATE_SCHEMA_VERSION`, `SUPPORTED_HAPI_RESOURCES`, `SUPPORTED_MODES`, `SUPPORTED_SCHEMA_VERSIONS`, `SYSTEM_INSTRUCTIONS`, `USGS_API_URL`, `VALID_B_SUBINDICATORS`, `VALID_CATEGORIES`, `VALID_CERTAINTIES`, `VALID_D_DAMAGE_INDICATORS`, `VALID_D_DISRUPTION_INDICATORS`, `VALID_FLOOD_OCCUPANCIES`, `VALID_MSG_TYPES`, `VALID_OSM_SECTORS`, `VALID_SCOPES`, `VALID_SEVERITIES`, `VALID_STATUSES`, `VALID_URGENCIES`, `VERIFICATION_STATUS_VALUES`, `WFP_ADAM_API_URL`, `WORKFLOW_CATALOG`, `aggregateBasinRainfall`, `analyzeFloodRisk`, `analyzeWithGemini`, `buildFdsnEventUrl`, `buildHdxCkanSearchUrl`, `buildHdxHapiUrl`, `buildOgcApiFeaturesUrl`, `buildOperationalContext`, `buildOverpassEndpointUrl`, `buildOverpassQuery`, `buildRelationalRecordBundle`, `buildSensorThingsUrl`, `buildStacSearchUrl`, `calculateBBox`, `calculateExpectedAnnualLoss`, `callDeltaMcp`, `callGeminiGenerateContent`, `checkDomainApplicability`, `checkForecastPersistence`, `classifyError`, `classifyNehrpVs30`, `classifyOsmTagsToSendaiSector`, `classifySendaiInfraSector`, `classifySeverityPhase`, `classifyStacAssets`, `classifyToolActionTier`, `computeAssessmentKey`, `computeBackoffDelayMs`, `computeCanonicalEventHash`, `computeEventIdentity`, `computeGeometryAreaSqKm`, `computePayloadHash`, `computePolygonOverlapFraction`, `computeRasterZonalStats`, `computeRingAreaSqKm`, `computeSnapshotHash`, `createAssessmentEnvelope`, `createEmptyLedgerState`, `createGeodesicBuffer`, `createProvenanceManifest`, `createSeededRng`, `createStateStore`, `crosswalkHazard`, `detectAndRedactPii`, `diffSituationReports`, `dispatchWebhook`, `enforceTenantIsolation`, `erf`, `escapeXml`, `estimateHdxPolygonPopulation`, `estimatePgaFromMmi`, `estimatePgaFromMmiDetailed`, `evaluateActionPolicy`, `evaluateAgentClaimGrounding`, `evaluateFloodDamage`, `evaluateHdxLicense`, `evaluateHumanitarianSeverity`, `evaluateMitigationCostBenefit`, `evaluateSeismicFragility`, `evaluateSourceFreshness`, `evaluateVulnerabilityMatrix`, `evaluateWindDamage`, `executeReferenceScenario`, `executeWithRetry`, `exportLedgerState`, `extractCodProperties`, `extractImpactClaimsWithGemini`, `fetchAdamCollections`, `fetchDeltaDimensions`, `fetchDeltaDocs`, `fetchDeltaHazards`, `fetchExposureFromDelta`, `fetchJsonWithConfig`, `fetchWeatherForecast`, `findHipHazards`, `formatCapTimestamp`, `formatMonitorMarkdownSummary`, `generateAlertsIndexHtml`, `generateCapXml`, `generateEmergencyBrief`, `generateVisualSitRepHtml`, `geojsonToCapPolygon`, `getAllHipClusters`, `getAllHipHazards`, `getAllHipTypes`, `getHipHierarchy`, `getRegisteredMethod`, `haversineDistance`, `inferWorkflowId`, `ingestAdamFeed`, `ingestCriticalInfraOverlay`, `ingestFdsnShakeMap`, `ingestGdacsAlerts`, `ingestHdxHapiData`, `ingestOsmInterimCriticalInfra`, `ingestSensorThings`, `ingestStacHazardCatalog`, `ingestUsgsEarthquakes`, `ingestValidatedInundationGrid`, `isBlockedWebhookHost`, `isEventInCountry`, `isPointInGeometry`, `issueApprovalToken`, `listRegisteredMethods`, `loadBenchmarkSuite`, `loadEnv`, `loadMonitoringRules`, `lognormalCdf`, `lookupHip`, `mapAssetCategoryToSector`, `mapEventType`, `mapHazardToHip`, `mapOutcomeToExitCode`, `matchAndDeduplicateEvents`, `migrateStateSchema`, `normalCdf`, `normalizeCriticalInfraOverlay`, `normalizeDepthValuesToMeters`, `normalizeExtractedClaims`, `normalizeHazardFamily`, `normalizeHazardIntensity`, `normalizeLongitude`, `normalizePgaToG`, `normalizeQcFlag`, `overlayCriticalInfraOnHazard`, `parseAdamFeatureCollection`, `parseAdamNullableNumber`, `parseEnvContent`, `parseFdsnShakeMapPayload`, `parseGdacsFeed`, `parseGeminiCandidateJson`, `parseHdxCkanSearchPayload`, `parseHdxHapiPayload`, `parseOverpassPayload`, `parseRetryAfterMs`, `parseSensorThingsPayload`, `parseShakeMapContours`, `parseShakeMapPgaGrid`, `parseShakeMapStations`, `parseStacCatalogPayload`, `parseUsgsFeed`, `planGoalWorkflow`, `pointInPolygonRing`, `pointOnSegment`, `prepareCapPublication`, `processQualifyingEvent`, `propagateUncertainty`, `purgeLedgerState`, `pushDraftDisasterRecord`, `reconcileAndDiffSitRep`, `reconcileImpactClaims`, `redactSensitiveObject`, `redactUrlSecrets`, `repairGeoJsonGeometry`, `resolveAdamCollection`, `resolveSensorUnit`, `revertEventDecision`, `ringCrossesAntimeridian`, `runBenchmarkSuite`, `runDualLayerEvaluation`, `runMonitoringCycle`, `runOnce`, `runReplayValidation`, `sanitizeForProvenanceHash`, `sanitizeUntrustedFeedText`, `scoreAgentTrajectory`, `screenDamageImageWithGemini`, `screenRiverDischarge`, `searchHdxCkanCatalog`, `segmentsIntersect`, `signedRingArea`, `spatialExposureJoin`, `startMonitoringDaemon`, `stripVolatileEventFields`, `summarizeDepthGrid`, `toSensorGeoJSON`, `toShakeMapGeoJSON`, `toStacFootprintGeoJSON`, `toUtcIsoWithOffset`, `transformCrs`, `transitionGovernanceState`, `translateBriefWithGemini`, `unwrapAntimeridianRing`, `validateCapXml`, `validateCodBoundaries`, `validateCoordinatePair`, `validateDeltaSchema`, `validateDestination`, `validateGeoJson`, `validateInputContract`, `validateLedgerStateSchema`, `validateMonitorConfig`, `validateRunRecord`, `validateSendaiSubmission`, `validateStacDepthGrid`, `validateTemporalInterval`, `validateXmlSafety`, `verifyApprovalToken`, `verifyNumericFidelity`
