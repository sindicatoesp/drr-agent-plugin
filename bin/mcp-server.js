#!/usr/bin/env node
/**
 * Model Context Protocol (MCP) Server for Disaster Risk Reduction (DRR)
 * Standard stdio transport: newline-delimited JSON-RPC 2.0
 */

const readline = require("readline");
const path = require("path");
const { ingestGdacsAlerts } = require("../lib/gdacs");
const { spatialExposureJoin, validateGeoJson, repairGeoJsonGeometry, transformCrs, computeRasterZonalStats } = require("../lib/spatial");
const { evaluateSeismicFragility, evaluateFloodDamage, evaluateWindDamage } = require("../lib/fragility");
const { evaluateVulnerabilityMatrix } = require("../lib/vulnerability");
const { generateCapXml, validateCapXml, prepareCapPublication, generateEmergencyBrief } = require("../lib/cap");
const { ingestUsgsEarthquakes } = require("../lib/usgs");
const { fetchWeatherForecast } = require("../lib/openmeteo");
const { aggregateBasinRainfall, screenRiverDischarge } = require("../lib/hydro");
const { pushDraftDisasterRecord, fetchExposureFromDelta, fetchDeltaDocs, validateDeltaSchema } = require("../lib/delta");
const { runOnce, runMonitoringCycle } = require("../lib/monitor");
const { validateInputContract, createProvenanceManifest } = require("../lib/contracts");
const { listRegisteredMethods, checkDomainApplicability } = require("../lib/registry");
const { runReplayValidation } = require("../lib/replay");
const { validateSendaiSubmission } = require("../lib/sendai");
const { crosswalkHazard } = require("../lib/hips");
const { matchAndDeduplicateEvents } = require("../lib/events");
const { propagateUncertainty } = require("../lib/uncertainty");
const { calculateExpectedAnnualLoss, evaluateMitigationCostBenefit } = require("../lib/appraisal");
const { sanitizeUntrustedFeedText } = require("../lib/security");
const { ingestSensorThings, toSensorGeoJSON } = require("../lib/sensorthings");
const { ingestStacHazardCatalog, toStacFootprintGeoJSON } = require("../lib/stac");
const { ingestFdsnShakeMap, toShakeMapGeoJSON } = require("../lib/shakemap");
const { ingestCriticalInfraOverlay } = require("../lib/infra-overlay");

const pkg = require("../package.json");

const SERVER_NAME = "drr-analytics-mcp";
const SERVER_VERSION = pkg.version;
const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
	{
		name: "drr_gdacs_fetch",
		description:
			"Ingest and filter GDACS (Global Disaster Alert and Coordination System) active alerts by severity, event type (EQ, TC, FL, VO), or country.",
		inputSchema: {
			type: "object",
			properties: {
				minAlertLevel: {
					type: "string",
					enum: ["Green", "Orange", "Red"],
					description: "Minimum alert score threshold (defaults to Green)",
				},
				eventType: {
					type: "string",
					description: "Event type: EQ (Earthquake), TC (Cyclone), FL (Flood), VO (Volcano)",
				},
				country: {
					type: "string",
					description: "Filter by country name or substring",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test GeoJSON payload to parse instead of fetching live network",
				},
			},
		},
	},
	{
		name: "drr_usgs_earthquake_fetch",
		description:
			"Query the USGS Earthquake Hazards Program for real-time seismic events and calculate estimated Peak Ground Acceleration (PGA in g) using Wald et al. (1999) GMICE.",
		inputSchema: {
			type: "object",
			properties: {
				minMagnitude: {
					type: "number",
					description: "Minimum earthquake magnitude (e.g. 4.5, 6.0)",
				},
				limit: {
					type: "number",
					description: "Maximum number of events to retrieve (default: 20)",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test GeoJSON payload to parse instead of fetching live network",
				},
			},
		},
	},
	{
		name: "drr_openmeteo_forecast",
		description:
			"Retrieve Open-Meteo multi-day weather forecasts for Anticipatory Action rainfall-threshold screening (never fabricates flood depth).",
		inputSchema: {
			type: "object",
			properties: {
				latitude: {
					type: "number",
					description: "Target location latitude",
				},
				longitude: {
					type: "number",
					description: "Target location longitude",
				},
				days: {
					type: "number",
					description: "Forecast window in days (default: 5)",
				},
				triggerPolicy: {
					type: "object",
					description: "Optional approved local FbF triggerPolicy ({ policyId, approved, requirePersistence, requiredConsecutiveRuns })",
				},
				previousRuns: {
					type: "array",
					items: { type: "object" },
					description: "Optional prior forecast runs for persistence checking",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test forecast payload to parse instead of fetching live network",
				},
			},
		},
	},
	{
		name: "drr_spatial_exposure_join",
		description:
			"Execute deterministic spatial joins between a hazard footprint (Polygon/MultiPolygon GeoJSON) and exposed assets (FeatureCollection).",
		inputSchema: {
			type: "object",
			required: ["hazardGeoJSON", "exposureGeoJSON"],
			properties: {
				hazardGeoJSON: {
					type: "object",
					description: "GeoJSON Feature or FeatureCollection of hazard zone polygon(s)",
				},
				exposureGeoJSON: {
					type: "object",
					description: "GeoJSON FeatureCollection of exposed infrastructure or population points",
				},
				epicenter: {
					type: "array",
					items: { type: "number" },
					description: "Optional [longitude, latitude] of epicenter / center",
				},
				bufferKm: {
					type: "number",
					description: "Optional radius buffer in kilometers around epicenter",
				},
			},
		},
	},
	{
		name: "drr_fragility_eval",
		description:
			"Calculate illustrative GEM/HAZUS structural damage state probabilities and Mean Damage Ratio (MDR) with explicit unit conversions and model registry provenance.",
		inputSchema: {
			type: "object",
			required: ["hazardType", "intensity"],
			properties: {
				hazardType: {
					type: "string",
					enum: ["earthquake", "flood", "wind"],
					description: "Type of peril",
				},
				intensity: {
					type: "number",
					description: "Intensity parameter (PGA in g, inundation depth in m, or wind speed in km/h)",
				},
				unit: {
					type: "string",
					description: "Explicit unit (e.g. g, m/s2, m, ft, km/h, m/s, kt)",
				},
				taxonomy: {
					type: "string",
					description: "Building taxonomy class: URM, C1_PRE_CODE, C1_MODERATE_CODE, C2, S1, W1",
				},
				occupancy: {
					type: "string",
					description: "Occupancy type for flood: residential_1story, residential_2story, commercial",
				},
				mode: {
					type: "string",
					enum: ["exploratory", "production"],
					description: "Execution mode; production blocks uncalibrated illustrative baseline curves",
				},
			},
		},
	},
	{
		name: "drr_vulnerability_matrix_calc",
		description:
			"Compute vulnerability matrix, estimated direct economic losses (Target C), modelled displacement (distinct from Sendai B-1), and physical infrastructure damage (distinct from service disruption D-6..D-8).",
		inputSchema: {
			type: "object",
			required: ["spatialReport", "hazardType", "intensity"],
			properties: {
				spatialReport: {
					type: "object",
					description: "Report object returned by drr_spatial_exposure_join",
				},
				hazardType: {
					type: "string",
					enum: ["earthquake", "flood", "wind"],
					description: "Peril type (earthquake, flood, wind)",
				},
				intensity: {
					type: "number",
					description: "Hazard intensity metric",
				},
				unit: {
					type: "string",
					description: "Explicit unit of hazard intensity",
				},
				defaultTaxonomy: {
					type: "string",
					description: "Fallback structural taxonomy if not defined in asset properties",
				},
				currency: {
					type: "string",
					description: "ISO-4217 currency code (default: USD)",
				},
				valuationYear: {
					type: "number",
					description: "Valuation reference year for economic assets",
				},
			},
		},
	},
	{
		name: "drr_cap_alert_generate_validate",
		description:
			"Generate and validate an ITU-T X.1303 / OASIS CAP v1.2 XML alert (default Draft, XXE-hardened, separated validity/authenticity/authorization), or synthesize a markdown situation brief.",
		inputSchema: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["generate_xml", "validate_xml", "generate_brief"],
					description: "Action mode: generate_xml, validate_xml, or generate_brief",
				},
				alertParams: {
					type: "object",
					description: "Parameters for CAP XML generation",
				},
				xmlString: {
					type: "string",
					description: "Raw XML string to validate (for validate_xml mode)",
				},
				context: {
					type: "object",
					description: "Combined hazard, spatial, and vulnerability context (for generate_brief mode)",
				},
			},
		},
	},
	{
		name: "drr_cap_publish",
		description:
			"Authorized publication adapter for CAP alerts enforcing schema validity, channel-vs-status safety (Draft/Test/Exercise blocked on production), destination allowlists, idempotency, and verified approval binding.",
		inputSchema: {
			type: "object",
			required: ["xmlString"],
			properties: {
				xmlString: { type: "string", description: "CAP XML document string" },
				channelType: { type: "string", enum: ["sandbox", "production"] },
				destination: { type: "string", description: "Target CAP hub/feed endpoint" },
				permissionScope: { type: "string", enum: ["read_only", "draft_write", "publish_cap", "admin"] },
				approvalToken: { type: "object", description: "Cryptographically signed approval token bound to payloadHash & destination" },
				idempotencyKey: { type: "string", description: "Unique key to prevent duplicate CAP dispatches" },
			},
		},
	},
	{
		name: "drr_delta_push_draft_record",
		description:
			"Push a schema-validated post-disaster assessment into DELTA Resilience as a 'Draft' record with status: 'draft', source: 'drr-agent-plugin', and preserved C-03 governance metadata.",
		inputSchema: {
			type: "object",
			required: ["assessment"],
			properties: {
				assessment: {
					type: "object",
					description: "Assessment object from drr_vulnerability_matrix_calc or manual input",
				},
				name: {
					type: "string",
					description: "Optional disaster event name (forwarded cleanly to parentEvent and locationDesc)",
				},
				notes: {
					type: "string",
					description: "Audit trail notes or context (forwarded cleanly to bundle audit notes)",
				},
				mock: {
					type: "boolean",
					description: "Set to true for dry-run/mock validation without making network calls",
				},
				tenantContext: {
					type: "object",
					description: "Optional tenant isolation context ({ actorTenant, targetTenant })",
				},
			},
		},
	},
	{
		name: "drr_delta_fetch_exposure",
		description:
			"Query DELTA Resilience core database via MCP for baseline administrative divisions, sector assets, HIP catalogs, or historical disaster records.",
		inputSchema: {
			type: "object",
			properties: {
				entity: {
					type: "string",
					enum: [
						"division",
						"disaster-record",
						"disaster-event",
						"organization",
						"hip-hazard",
						"hip-cluster",
						"hip-type",
						"sector",
					],
					description: "Entity type to fetch (default: division)",
				},
				filter: {
					type: "object",
					description: "Filter parameters (e.g. page, pageSize)",
				},
				mock: {
					type: "boolean",
					description: "Set to true for mock response without making network calls",
				},
			},
		},
	},
	{
		name: "drr_delta_docs",
		description:
			"Query DELTA Resilience MCP 'docs' tool to retrieve DTS system documentation, entity relationships, workflows, and HIP taxonomy reference.",
		inputSchema: {
			type: "object",
			properties: {
				mock: {
					type: "boolean",
					description: "Set to true for mock response without making network calls",
				},
			},
		},
	},
	{
		name: "drr_delta_schema_validate",
		description:
			"Validate a DELTA relational assessment bundle against DTS fieldsDefApi contracts, HIP triad completeness, wire sanitization, PostGIS SRID 4326 footprint, and Sendai relations.",
		inputSchema: {
			type: "object",
			required: ["payload"],
			properties: {
				payload: { type: "object", description: "Assessment or relational DELTA bundle" },
			},
		},
	},
	{
		name: "drr_monitor_check",
		description:
			"Execute a bounded single-run monitoring cycle against multi-source disaster feeds (USGS, GDACS, Open-Meteo) using alerts-config.json rules, durable CAS state/leases, event deduplication, and read-only shadow mode protection.",
		inputSchema: {
			type: "object",
			properties: {
				configPath: {
					type: "string",
					description: "Optional custom path to alerts-config.json",
				},
				mock: {
					type: "boolean",
					description: "Set to true to run in dry-run mode",
				},
				readOnly: {
					type: "boolean",
					description: "Blocks consequential outbound actions (default true for shadow runs)",
				},
				scopeId: {
					type: "string",
					description: "State/lease namespace identifier (default: global)",
				},
				stateBackend: {
					type: "string",
					enum: ["cas-file-store", "memory-cas-store", "stateless"],
					description: "Authoritative persistence adapter",
				},
				runDeadlineMs: {
					type: "number",
					description: "Overall application budget in milliseconds",
				},
			},
		},
	},
	{
		name: "drr_input_contract_validate",
		description:
			"Validate DRR assessment inputs across hazard intensity/units, coordinate order, temporal intervals, currency/valuationYear, and missing-data semantics (unknown !== zero).",
		inputSchema: {
			type: "object",
			required: ["input"],
			properties: {
				input: { type: "object", description: "Assessment input payload to validate" },
				strictMissingData: { type: "boolean", description: "Reject if all assets lack population/value" },
			},
		},
	},
	{
		name: "drr_source_provenance_manifest",
		description:
			"Generate a secret-sanitized provenance and independent C-03 governance manifest (evidenceBasis, verificationStatus, approvalStatus, reportingEligibility, SHA-256 snapshot hash).",
		inputSchema: {
			type: "object",
			properties: {
				sourceIds: { type: "array", items: { type: "string" } },
				method: { type: "object" },
				inputsSnapshot: { type: "object" },
				evidenceBasis: { type: "string", enum: ["modelled", "observed", "field_reported", "hybrid"] },
				verificationStatus: { type: "string", enum: ["unreviewed", "peer_reviewed", "field_verified"] },
				approvalStatus: { type: "string", enum: ["draft", "pending_review", "approved", "rejected"] },
				seed: { type: "number" },
			},
		},
	},
	{
		name: "drr_model_registry_list",
		description:
			"List all registered scientific models, empirical bounds, units, and illustrative vs. production applicability status (or check applicability of a specific methodId).",
		inputSchema: {
			type: "object",
			properties: {
				methodId: { type: "string", description: "Optional registered method ID to inspect applicability" },
				value: { type: "number", description: "Optional input value for domain check" },
				assetClass: { type: "string", description: "Optional structural/asset class" },
				mode: { type: "string", enum: ["exploratory", "production"] },
			},
		},
	},
	{
		name: "drr_assessment_replay_validate",
		description:
			"Run deterministic frozen-input replay verification suite covering mathematical invariants, unit conversions, missing-data semantics, CAP XML, Sendai rules, and hindcast benchmarks.",
		inputSchema: {
			type: "object",
			properties: {
				suite: {
					type: "string",
					enum: ["all", "synthetic_reference", "hindcast_benchmark"],
					description: "Subset of replay cases to execute (default: all)",
				},
			},
		},
	},
	{
		name: "drr_sendai_validate",
		description:
			"Validate UNDRR Sendai Framework Monitor semantics: separates displacement from B-1 directly affected, physical damage (D-2..D-4) from disruption (D-6..D-8), enforces denominators for per-100k metrics, and separates C-03 states.",
		inputSchema: {
			type: "object",
			required: ["payload"],
			properties: {
				payload: { type: "object", description: "Sendai Framework reporting or assessment payload" },
				requireCalibratedMethodology: { type: "boolean" },
			},
		},
	},
	{
		name: "drr_hazard_crosswalk",
		description:
			"Versioned UNDRR-ISC HIP hazard crosswalk: performs deterministic resolution on exact IDs/codes/aliases while returning human-reviewed candidates for ambiguous free-text queries.",
		inputSchema: {
			type: "object",
			required: ["query"],
			properties: {
				query: { type: ["string", "object"], description: "Hazard code, ID, external code, or free-text query" },
				sourceSystem: { type: "string", description: "Optional source system (e.g. GDACS, USGS)" },
				candidateLimit: { type: "number", description: "Max candidate matches for free text (default: 5)" },
			},
		},
	},
	{
		name: "drr_event_match_deduplicate",
		description:
			"Multi-source event identity & deduplication engine classifying exact ID matches, revision updates, possible cross-source duplicates (held for review), and non-causal cascading candidates.",
		inputSchema: {
			type: "object",
			required: ["incomingEvents"],
			properties: {
				incomingEvents: { type: "array", items: { type: "object" } },
				existingCatalog: { type: "array", items: { type: "object" } },
				spatialRadiusKm: { type: "number" },
				timeWindowHours: { type: "number" },
			},
		},
	},
	{
		name: "drr_geojson_validate",
		description:
			"Validate GeoJSON geometry structure, coordinate order/ranges, ring closure, zero-area degeneracy, winding order, antimeridian crossings, and self-intersections.",
		inputSchema: {
			type: "object",
			required: ["geojson"],
			properties: {
				geojson: { type: "object" },
				crs: { type: "string", description: "Coordinate reference system (default: EPSG:4326)" },
			},
		},
	},
	{
		name: "drr_geometry_repair",
		description:
			"Opt-in auditable GeoJSON ring closure, duplicate vertex removal, and RFC 7946 winding repair preserving originalGeometry and reporting area/topology deltas.",
		inputSchema: {
			type: "object",
			required: ["geojson", "repairRequested"],
			properties: {
				geojson: { type: "object" },
				repairRequested: { type: "boolean", description: "Must be true to opt into geometry repair" },
			},
		},
	},
	{
		name: "drr_crs_transform",
		description:
			"Reproject coordinates or GeoJSON geometries between WGS84 geographic (EPSG:4326), Web Mercator (EPSG:3857), and WGS84 UTM zones (EPSG:326xx/327xx).",
		inputSchema: {
			type: "object",
			required: ["input", "fromCrs", "toCrs"],
			properties: {
				input: { type: ["object", "array"] },
				fromCrs: { type: "string" },
				toCrs: { type: "string" },
			},
		},
	},
	{
		name: "drr_raster_zonal_stats",
		description:
			"Compute zonal statistics of a gridded raster within vector zone boundaries distinguishing count vs. density_per_sqkm vs. continuous semantics with explicit nodata and CRS alignment checks.",
		inputSchema: {
			type: "object",
			required: ["rasterGrid", "zoneGeoJSON"],
			properties: {
				rasterGrid: { type: "object" },
				zoneGeoJSON: { type: "object" },
				zoneCrs: { type: "string" },
				boundaryDataset: { type: "string" },
				boundaryVersion: { type: "string" },
			},
		},
	},
	{
		name: "drr_basin_rainfall_aggregate",
		description:
			"Aggregate point/grid rainfall forecasts (mm) over a catchment polygon with station weights (never produces fabricated flood depth).",
		inputSchema: {
			type: "object",
			required: ["stationsOrGrid"],
			properties: {
				basinId: { type: "string" },
				basinName: { type: "string" },
				basinGeoJSON: { type: "object" },
				stationsOrGrid: { type: "array", items: { type: "object" } },
				dates: { type: "array", items: { type: "string" } },
				method: { type: "string", enum: ["arithmetic_mean", "weighted"] },
			},
		},
	},
	{
		name: "drr_river_discharge_screen",
		description:
			"Screen GloFAS / Open-Meteo river discharge (m^3/s) against local return-period thresholds with river-cell suitability checks (never labelled as inundation depth).",
		inputSchema: {
			type: "object",
			required: ["dailyDischargeM3s"],
			properties: {
				dailyDischargeM3s: { type: "array", items: { type: "number" } },
				dates: { type: "array", items: { type: "string" } },
				returnPeriodThresholds: {
					type: "object",
					description: "Locally calibrated return-period discharge thresholds in m^3/s ({ q2, q5, q10, q20 })",
				},
				gridResolutionKm: { type: "number" },
				upstreamDrainageAreaSqKm: { type: "number" },
				isRiverCell: { type: "boolean" },
			},
		},
	},
	{
		name: "drr_uncertainty_propagate",
		description:
			"Propagate input/parameter uncertainty via deterministic min/central/max bounds, one-at-a-time sensitivity ranking, and reproducible seeded Monte Carlo with convergence checks.",
		inputSchema: {
			type: "object",
			required: ["hazardType", "intensity", "exposedValueUsd"],
			properties: {
				mode: { type: "string", enum: ["deterministic_bounds", "monte_carlo"] },
				hazardType: { type: "string", enum: ["earthquake", "flood", "wind"] },
				intensity: { type: "number" },
				exposedValueUsd: { type: "number" },
				taxonomy: { type: "string" },
				occupancy: { type: "string" },
				seed: { type: "number" },
				iterations: { type: "number" },
				allowIllustrativeDistributions: { type: "boolean" },
				distributions: { type: "object" },
			},
		},
	},
	{
		name: "drr_expected_annual_loss",
		description:
			"Integrate a multi-return-period loss-exceedance curve via trapezoidal AEP integration (rejects single-event scenario losses masquerading as EAL).",
		inputSchema: {
			type: "object",
			required: ["points", "currency", "valuationYear"],
			properties: {
				points: { type: "array", items: { type: "object" } },
				currency: { type: "string" },
				valuationYear: { type: "number" },
				tailHandling: { type: "string", enum: ["truncate", "flat_extrapolation"] },
			},
		},
	},
	{
		name: "drr_mitigation_cost_benefit",
		description:
			"Evaluate DRR mitigation option Cost-Benefit Analysis (NPV, BCR, residual risk EAL, CapEx/OpEx discounting, sensitivity matrix) separating quantitative metrics from policy judgements.",
		inputSchema: {
			type: "object",
			required: ["baselineEal", "mitigatedEal", "capex", "discountRate", "horizonYears", "currency", "valuationYear"],
			properties: {
				optionName: { type: "string" },
				baselineEal: { type: "number" },
				mitigatedEal: { type: "number" },
				capex: { type: "number" },
				annualOpex: { type: "number" },
				annualCoBenefits: { type: "number" },
				discountRate: { type: "number" },
				horizonYears: { type: "number" },
				currency: { type: "string" },
				valuationYear: { type: "number" },
			},
		},
	},
	{
		name: "drr_sensorthings_fetch",
		description:
			"Ingest and normalize custom government or private in-situ sensor observations via OGC SensorThings API v1.1 (OGC 18-088) with unit conversion, WMO/QARTOD QC filtering, staleness checks, licensing/redistribution metadata, and optional threshold screening.",
		inputSchema: {
			type: "object",
			properties: {
				endpointUrl: {
					type: "string",
					description: "OGC SensorThings API v1.1 root or /Datastreams URL (SSRF-guarded; optional if samplePayload or OGC_SENSORTHINGS_URL is set)",
				},
				observedProperty: {
					type: "string",
					description: "Optional ObservedProperty name filter (e.g. 'Water Level', 'Precipitation', 'River Discharge', 'PGA')",
				},
				filter: {
					type: "string",
					description: "Optional OGC SensorThings $filter expression",
				},
				top: {
					type: "number",
					description: "Maximum number of Datastreams to retrieve (default: 50, max: 200)",
				},
				observationsTop: {
					type: "number",
					description: "Maximum observations per Datastream ordered newest-first (default: 5, max: 100)",
				},
				thresholds: {
					type: "object",
					description: "Optional threshold rules: { warning?: number, critical?: number, unit?: string }",
				},
				maxAgeMinutes: {
					type: "number",
					description: "Maximum observation age in minutes before flagging stale (default: 180)",
				},
				excludeSuspect: {
					type: "boolean",
					description: "When true, excludes QARTOD 'suspect' observations from threshold evaluation (default: false)",
				},
				asGeoJSON: {
					type: "boolean",
					description: "When true, includes a GeoJSON FeatureCollection of stations and latest readings",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test OGC SensorThings v1.1 JSON payload to parse instead of fetching live network",
				},
			},
		},
	},
	{
		name: "drr_stac_hazard_fetch",
		description:
			"Ingest STAC v1.0.0 Earth Observation catalogs (Copernicus EMS, Sentinel-1 SAR, ICEYE, Floodbase) and validate flood depth grids via ingestValidatedInundationGrid (C-05/R-12), separating flood extent from depth and enforcing commercial licensing, cloud cover, and SSRF guards.",
		inputSchema: {
			type: "object",
			properties: {
				endpointUrl: {
					type: "string",
					description: "STAC API v1.0.0 root or /search URL (SSRF-guarded; optional if samplePayload or STAC_API_URL is set)",
				},
				bbox: {
					type: "array",
					items: { type: "number" },
					description: "Optional bounding box [minLon, minLat, maxLon, maxLat]",
				},
				datetime: {
					type: "string",
					description: "Optional RFC 3339 datetime or interval (e.g. '2026-11-01T00:00:00Z/2026-11-10T00:00:00Z')",
				},
				collections: {
					type: "array",
					items: { type: "string" },
					description: "Optional STAC collection IDs to query",
				},
				limit: {
					type: "number",
					description: "Maximum number of STAC items to return (default: 20, max: 100)",
				},
				maxCloudCover: {
					type: "number",
					description: "Maximum acceptable eo:cloud_cover percentage before flagging cloudObscured (default: 25)",
				},
				sampleDepthGrid: {
					type: "object",
					description: "Optional pre-extracted depth grid object { itemId?, bbox, crs, unit, width, height, values, nodata } to validate against a STAC Item",
				},
				asGeoJSON: {
					type: "boolean",
					description: "When true, includes a GeoJSON FeatureCollection of STAC footprints ready for drr_spatial_exposure_join",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test STAC v1.0.0 FeatureCollection or Item JSON payload",
				},
			},
		},
	},
	{
		name: "drr_fdsn_shakemap_fetch",
		description:
			"Ingest custom national FDSN-WS seismic events (BMKG, PHIVOLCS, JMA, EMSC, GeoNet, USGS) and ShakeMap v4 PGA/PGV/Vs30 contours, instrumented station lists, and gridded PGA rasters (upgrading C-04 beyond Wald99 GMICE).",
		inputSchema: {
			type: "object",
			properties: {
				endpointUrl: {
					type: "string",
					description: "Custom FDSN-WS event service root or /query URL (SSRF-guarded; optional if samplePayload or FDSN_API_URL is set)",
				},
				agency: {
					type: "string",
					description: "Optional national seismic agency identifier (e.g. 'BMKG', 'PHIVOLCS', 'JMA', 'EMSC', 'GeoNet')",
				},
				minMagnitude: {
					type: "number",
					description: "Optional minimum earthquake magnitude filter",
				},
				startTime: {
					type: "string",
					description: "Optional ISO-8601 start time for FDSN-WS query",
				},
				endTime: {
					type: "string",
					description: "Optional ISO-8601 end time for FDSN-WS query",
				},
				bbox: {
					type: "array",
					items: { type: "number" },
					description: "Optional geographic bounding box [minLon, minLat, maxLon, maxLat]",
				},
				limit: {
					type: "number",
					description: "Maximum number of FDSN events (default: 20, max: 200)",
				},
				minPgaG: {
					type: "number",
					description: "Optional minimum PGA threshold in g for filtering ShakeMap contours",
				},
				shakemapContours: {
					type: "object",
					description: "Optional ShakeMap PGA contours GeoJSON FeatureCollection (cont_pga.json)",
				},
				shakemapStations: {
					type: "object",
					description: "Optional ShakeMap stationlist.json GeoJSON FeatureCollection with PGA, PGV, and Vs30",
				},
				shakemapPgaGrid: {
					type: "object",
					description: "Optional ShakeMap PGA raster grid { bbox, crs, unit, width, height, values, nodata }",
				},
				asGeoJSON: {
					type: "string",
					enum: ["contours", "stations"],
					description: "Optional: include a GeoJSON FeatureCollection of ShakeMap 'contours' or 'stations' for drr_spatial_exposure_join",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test FDSN-WS GeoJSON or combined ShakeMap bundle JSON payload",
				},
			},
		},
	},
	{
		name: "drr_critical_infra_overlay",
		description:
			"Group critical infrastructure assets by the 9 UNDRR Sendai Framework Target D sectors (health, education, water, transportation, telecommunications, energy, waste_management, protective_infrastructure, other_essential), ingest via OGC API - Features or GeoJSON, overlay onto hazard footprints, evaluate lifeline dependency cascades (D-6..D-8 separate from D-2..D-4), and enforce CIP sensitivity redaction.",
		inputSchema: {
			type: "object",
			properties: {
				endpointUrl: {
					type: "string",
					description: "Optional OGC API - Features (OGC 17-069r4) root or /items URL (SSRF-guarded)",
				},
				collection: {
					type: "string",
					description: "Optional OGC API - Features collection ID (e.g. 'critical-infrastructure')",
				},
				bbox: {
					type: "array",
					items: { type: "number" },
					description: "Optional bounding box [minLon, minLat, maxLon, maxLat]",
				},
				limit: {
					type: "number",
					description: "Maximum features to fetch from OGC API - Features (default: 200, max: 1000)",
				},
				infraGeoJSON: {
					type: "object",
					description: "Offline Critical Infrastructure GeoJSON FeatureCollection",
				},
				infraLayers: {
					type: "array",
					items: { type: "object" },
					description: "Optional array of separate per-sector GeoJSON FeatureCollections to merge and group",
				},
				hazardGeoJSON: {
					type: "object",
					description: "Optional hazard footprint GeoJSON (e.g. ShakeMap contour, STAC flood footprint, GDACS polygon) to overlay against",
				},
				epicenter: {
					type: "array",
					items: { type: "number" },
					description: "Optional [lon, lat] epicenter for geodesic buffer overlay when no polygon is supplied",
				},
				bufferKm: {
					type: "number",
					description: "Optional geodesic buffer radius in km paired with epicenter",
				},
				sectors: {
					type: "array",
					items: { type: "string" },
					description: "Optional filter to include only specific Sendai Target D sector keys (e.g. ['health', 'energy', 'water'])",
				},
				audience: {
					type: "string",
					enum: ["eoc_internal", "public"],
					description: "Redaction mode: 'eoc_internal' (default) retains restricted assets; 'public' strips sensitivity='restricted' and redistributionAllowed=false assets",
				},
			},
		},
	},
];

async function handleToolCall(name, args) {
	switch (name) {
		case "drr_critical_infra_overlay": {
			return ingestCriticalInfraOverlay({
				endpointUrl: args.endpointUrl,
				collection: args.collection,
				bbox: args.bbox,
				limit: args.limit,
				infraGeoJSON: args.infraGeoJSON,
				infraLayers: args.infraLayers,
				hazardGeoJSON: args.hazardGeoJSON,
				epicenter: args.epicenter,
				bufferKm: args.bufferKm,
				sectors: args.sectors,
				audience: args.audience,
			});
		}

		case "drr_fdsn_shakemap_fetch": {
			const report = await ingestFdsnShakeMap({
				endpointUrl: args.endpointUrl,
				agency: args.agency,
				minMagnitude: args.minMagnitude,
				startTime: args.startTime,
				endTime: args.endTime,
				bbox: args.bbox,
				limit: args.limit,
				minPgaG: args.minPgaG,
				shakemapContours: args.shakemapContours,
				shakemapStations: args.shakemapStations,
				shakemapPgaGrid: args.shakemapPgaGrid,
				samplePayload: args.samplePayload,
			});
			if (args.asGeoJSON) {
				return { ...report, geojson: toShakeMapGeoJSON(report, args.asGeoJSON) };
			}
			return report;
		}

		case "drr_stac_hazard_fetch": {
			const report = await ingestStacHazardCatalog({
				endpointUrl: args.endpointUrl,
				bbox: args.bbox,
				datetime: args.datetime,
				collections: args.collections,
				limit: args.limit,
				maxCloudCover: args.maxCloudCover,
				sampleDepthGrid: args.sampleDepthGrid,
				samplePayload: args.samplePayload,
			});
			if (args.asGeoJSON) {
				return { ...report, geojson: toStacFootprintGeoJSON(report) };
			}
			return report;
		}

		case "drr_sensorthings_fetch": {
			const report = await ingestSensorThings({
				endpointUrl: args.endpointUrl,
				observedProperty: args.observedProperty,
				filter: args.filter,
				top: args.top,
				observationsTop: args.observationsTop,
				thresholds: args.thresholds,
				maxAgeMinutes: args.maxAgeMinutes,
				excludeSuspect: args.excludeSuspect,
				samplePayload: args.samplePayload,
			});
			if (args.asGeoJSON) {
				return { ...report, geojson: toSensorGeoJSON(report) };
			}
			return report;
		}

		case "drr_gdacs_fetch": {
			const events = await ingestGdacsAlerts(args.samplePayload || null, {
				minAlertLevel: args.minAlertLevel,
				eventType: args.eventType,
				country: args.country,
			});
			return { totalEvents: events.length, events: events.slice(0, 20) };
		}

		case "drr_usgs_earthquake_fetch": {
			const earthquakes = await ingestUsgsEarthquakes({
				minMagnitude: args.minMagnitude,
				limit: args.limit,
				samplePayload: args.samplePayload,
			});
			return { totalEvents: earthquakes.length, earthquakes: earthquakes.slice(0, 20) };
		}

		case "drr_openmeteo_forecast": {
			return fetchWeatherForecast({
				latitude: args.latitude,
				longitude: args.longitude,
				days: args.days,
				triggerPolicy: args.triggerPolicy,
				previousRuns: args.previousRuns,
				samplePayload: args.samplePayload,
			});
		}

		case "drr_spatial_exposure_join": {
			return spatialExposureJoin(
				args.hazardGeoJSON,
				args.exposureGeoJSON,
				{ epicenter: args.epicenter, bufferKm: args.bufferKm },
			);
		}

		case "drr_fragility_eval": {
			const opts = { unit: args.unit, mode: args.mode };
			if (args.hazardType === "earthquake") {
				return evaluateSeismicFragility(args.taxonomy || "URM", args.intensity, opts);
			} else if (args.hazardType === "flood") {
				return evaluateFloodDamage(args.intensity, args.occupancy, opts);
			} else if (args.hazardType === "wind") {
				return evaluateWindDamage(args.intensity, opts);
			}
			throw new Error(`Unsupported hazard type: ${args.hazardType}`);
		}

		case "drr_vulnerability_matrix_calc": {
			return evaluateVulnerabilityMatrix(args.spatialReport, {
				type: args.hazardType,
				intensity: args.intensity,
				unit: args.unit,
				defaultTaxonomy: args.defaultTaxonomy,
				currency: args.currency,
				valuationYear: args.valuationYear,
			});
		}

		case "drr_cap_alert_generate_validate": {
			const mode = args.mode || "generate_xml";
			if (mode === "generate_xml") {
				const xml = generateCapXml(args.alertParams || {});
				const validation = validateCapXml(xml);
				return { xml, validation };
			} else if (mode === "validate_xml") {
				return validateCapXml(args.xmlString || "");
			} else if (mode === "generate_brief") {
				const brief = generateEmergencyBrief(args.context || {});
				return { markdownBrief: brief };
			}
			throw new Error(`Invalid mode: ${mode}`);
		}

		case "drr_cap_publish": {
			return prepareCapPublication(args.xmlString || "", {
				channelType: args.channelType || "sandbox",
				destination: args.destination,
				permissionScope: args.permissionScope,
				approvalToken: args.approvalToken,
				idempotencyKey: args.idempotencyKey,
			});
		}

		case "drr_delta_push_draft_record": {
			// Fix R-01/defects: forward args.name and args.notes cleanly into record builder!
			const safeNotes = args.notes !== undefined
				? sanitizeUntrustedFeedText(args.notes).text
				: args.assessment?.notes;
			const assessmentPayload = {
				...(args.assessment || {}),
				...(args.name !== undefined ? { name: sanitizeUntrustedFeedText(args.name).text } : {}),
				...(safeNotes !== undefined ? { notes: safeNotes } : {}),
			};
			return pushDraftDisasterRecord(assessmentPayload, {
				mock: args.mock !== undefined ? args.mock : false,
				tenantContext: args.tenantContext,
			});
		}

		case "drr_delta_fetch_exposure": {
			return fetchExposureFromDelta(args.entity || "division", args.filter || {}, {
				mock: args.mock !== undefined ? args.mock : false,
			});
		}

		case "drr_delta_docs": {
			return fetchDeltaDocs({
				mock: args.mock !== undefined ? args.mock : false,
			});
		}

		case "drr_delta_schema_validate": {
			return validateDeltaSchema(args.payload || {});
		}

		case "drr_monitor_check": {
			let safeConfigPath = undefined;
			if (args.configPath) {
				const rootDir = path.resolve(__dirname, "..");
				const cwdDir = path.resolve(process.cwd());
				const resolved = path.resolve(args.configPath);
				const inRoot =
					resolved.startsWith(rootDir + path.sep) || resolved === rootDir;
				const inCwd =
					resolved.startsWith(cwdDir + path.sep) || resolved === cwdDir;
				if ((!inRoot && !inCwd) || !resolved.endsWith(".json")) {
					throw new Error(
						"Security constraint: configPath must be a .json file within the workspace or plugin directory.",
					);
				}
				safeConfigPath = resolved;
			}
			return runMonitoringCycle({
				configPath: safeConfigPath,
				mock: args.mock !== undefined ? args.mock : false,
				readOnly: args.readOnly,
				scopeId: args.scopeId,
				stateBackend: args.stateBackend,
				runDeadlineMs: args.runDeadlineMs,
			});
		}

		case "drr_input_contract_validate": {
			return validateInputContract(args.input || {}, {
				strictMissingData: args.strictMissingData === true,
			});
		}

		case "drr_source_provenance_manifest": {
			return createProvenanceManifest(args || {});
		}

		case "drr_model_registry_list": {
			if (args.methodId) {
				return checkDomainApplicability(
					args.methodId,
					{ value: args.value, assetClass: args.assetClass },
					{ mode: args.mode || "exploratory" },
				);
			}
			return { methods: listRegisteredMethods() };
		}

		case "drr_assessment_replay_validate": {
			return runReplayValidation({ suite: args.suite || "all" });
		}

		case "drr_sendai_validate": {
			return validateSendaiSubmission(args.payload || {}, {
				requireCalibratedMethodology: args.requireCalibratedMethodology === true,
			});
		}

		case "drr_hazard_crosswalk": {
			return crosswalkHazard(args.query, {
				sourceSystem: args.sourceSystem,
				candidateLimit: args.candidateLimit,
			});
		}

		case "drr_event_match_deduplicate": {
			return matchAndDeduplicateEvents(
				args.incomingEvents || [],
				args.existingCatalog || [],
				{
					spatialRadiusKm: args.spatialRadiusKm,
					timeWindowHours: args.timeWindowHours,
				},
			);
		}

		case "drr_geojson_validate": {
			return validateGeoJson(args.geojson, { crs: args.crs });
		}

		case "drr_geometry_repair": {
			return repairGeoJsonGeometry(args.geojson, { repairRequested: args.repairRequested === true });
		}

		case "drr_crs_transform": {
			return transformCrs(args.input, args.fromCrs, args.toCrs);
		}

		case "drr_raster_zonal_stats": {
			return computeRasterZonalStats(args.rasterGrid, args.zoneGeoJSON, {
				zoneCrs: args.zoneCrs,
				boundaryDataset: args.boundaryDataset,
				boundaryVersion: args.boundaryVersion,
			});
		}

		case "drr_basin_rainfall_aggregate": {
			return aggregateBasinRainfall(args || {});
		}

		case "drr_river_discharge_screen": {
			return screenRiverDischarge(args || {});
		}

		case "drr_uncertainty_propagate": {
			return propagateUncertainty(args || {});
		}

		case "drr_expected_annual_loss": {
			return calculateExpectedAnnualLoss(args || {});
		}

		case "drr_mitigation_cost_benefit": {
			return evaluateMitigationCostBenefit(args || {});
		}

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

// JSON-RPC 2.0 stdio loop (only run when executed directly)
const MAX_RPC_LINE_BYTES = 16 * 1024 * 1024; // 16 MB max JSON-RPC message size

if (require.main === module) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	function sendResponse(id, result, error = null) {
		const res = { jsonrpc: "2.0", id };
		if (error) {
			res.error = error;
		} else {
			res.result = result;
		}
		process.stdout.write(JSON.stringify(res) + "\n");
	}

	rl.on("line", async (line) => {
		if (Buffer.byteLength(line, "utf8") > MAX_RPC_LINE_BYTES) {
			sendResponse(null, null, {
				code: -32600,
				message: `Invalid Request: JSON-RPC payload exceeds maximum size limit (${MAX_RPC_LINE_BYTES} bytes)`,
			});
			return;
		}
		const trimmed = line.trim();
		if (!trimmed) return;

		let msg;
		try {
			msg = JSON.parse(trimmed);
		} catch (err) {
			sendResponse(null, null, { code: -32700, message: "Parse error" });
			return;
		}

		const { id, method, params } = msg;

		// Notification (no id)
		if (id === undefined || id === null) {
			return;
		}

		try {
			switch (method) {
				case "initialize":
					sendResponse(id, {
						protocolVersion: PROTOCOL_VERSION,
						capabilities: { tools: {} },
						serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
					});
					break;

				case "tools/list":
					sendResponse(id, { tools: TOOLS });
					break;

				case "tools/call": {
					if (!params || !params.name) {
						sendResponse(id, null, {
							code: -32602,
							message: "Invalid params: name required",
						});
						return;
					}
					const toolResult = await handleToolCall(params.name, params.arguments || {});
					sendResponse(id, {
						content: [
							{
								type: "text",
								text: JSON.stringify(toolResult, null, 2),
							},
						],
					});
					break;
				}

				case "ping":
					sendResponse(id, {});
					break;

				default:
					sendResponse(id, null, {
						code: -32601,
						message: `Method not found: ${method}`,
					});
					break;
			}
		} catch (err) {
			sendResponse(id, null, {
				code: -32000,
				message: err.message || "Internal server error",
			});
		}
	});

	process.on("SIGINT", () => process.exit(0));
	process.on("SIGTERM", () => process.exit(0));
}

module.exports = {
	SERVER_NAME,
	SERVER_VERSION,
	PROTOCOL_VERSION,
	TOOLS,
	handleToolCall,
};
