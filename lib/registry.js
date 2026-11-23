/**
 * Scientific Model & Parameter Registry (R-04, C-04, C-05, C-06)
 *
 * Registers every fragility, vulnerability, intensity conversion, and screening
 * method with exact references, versions, units, applicability bounds, and
 * illustrative vs. empirically-validated status.
 *
 * Pure Node.js standard library only.
 */

const MODEL_REGISTRY = {
	"gmice.wald1999": {
		id: "gmice.wald1999",
		version: "1999.1",
		category: "ground_motion_intensity_conversion",
		classification: "GMICE", // Ground-Motion Intensity Conversion Equation, NOT a GMPE
		name: "Wald et al. (1999) MMI-to-PGA Relationship",
		reference: "Wald, D. J., Quitoriano, V., Heaton, T. H., & Kanamori, H. (1999). Relationships between Peak Ground Acceleration, Peak Ground Velocity, and Modified Mercalli Intensity in California. Earthquake Spectra, 15(3), 557-564.",
		sourceUrl: "https://pubs.usgs.gov/publication/70021541",
		inputMeasure: "MMI",
		inputUnit: "MMI",
		outputMeasure: "PGA",
		outputUnit: "g",
		geography: "California (empirical calibration dataset)",
		validRange: { min: 5.0, max: 8.0, lowBranchMin: 1.0, lowBranchMax: 5.0 },
		license: "Public Domain (USGS)",
		productionStatus: "registered_empirical_screening",
		limitations: [
			"GMICE empirical conversion only; not a GMPE based on earthquake source, distance, and Vs30 site conditions.",
			"Primary high-intensity branch (MMI >= V) calibrated on California earthquakes for MMI V-VIII.",
			"Deriving MMI from magnitude alone (M * 1.15) is an uncalibrated screening heuristic and must not be used for production loss estimation.",
		],
	},
	"fragility.seismic.gem_hazus_baseline": {
		id: "fragility.seismic.gem_hazus_baseline",
		version: "GEM-v2.0/HAZUS-MH-2.1",
		category: "structural_fragility",
		classification: "lognormal_fragility_curve",
		name: "Seismic Lognormal Fragility Curves (Illustrative GEM/HAZUS Baseline)",
		reference: "GEM Building Taxonomy v2.0 (Silva et al., 2018); FEMA HAZUS-MH 2.1 Technical Manual (illustrative representative parameters for 6 low-rise typologies).",
		sourceUrl: "https://www.fema.gov/ilo/flood-maps/tools-resources/flood-map-products/hazus/user-technical-manuals",
		inputMeasure: "PGA",
		inputUnit: "g",
		outputMeasure: "exceedance_probability_and_mdr",
		outputUnit: "ratio_0_to_1",
		assetClasses: ["URM", "C1_PRE_CODE", "C1_MODERATE_CODE", "C2", "S1", "W1"],
		geography: "Generic baseline (requires regional/national calibration before official loss reporting)",
		validRange: { minExclusive: 0, max: 3.0 },
		license: "Apache-2.0 / Public Reference",
		productionStatus: "illustrative_baseline",
		limitations: [
			"Representative baseline parameters; does not establish full equivalence to local HAZUS inventory-specific methodologies.",
			"Requires local building taxonomy verification and calibration before production reporting.",
		],
	},
	"fragility.flood.fia_hazus_baseline": {
		id: "fragility.flood.fia_hazus_baseline",
		version: "FIA-HAZUS-baseline-1.0",
		category: "depth_damage_vulnerability",
		classification: "piecewise_depth_damage",
		name: "Flood Depth-Damage Functions (Illustrative FIA/HAZUS Baseline)",
		reference: "FEMA FIA / HAZUS-MH Flood Model Technical Manual (illustrative piecewise structural and content curves).",
		sourceUrl: "https://www.fema.gov/ilo/flood-maps/tools-resources/flood-map-products/hazus/user-technical-manuals",
		inputMeasure: "inundation_depth",
		inputUnit: "m",
		outputMeasure: "structural_and_content_damage_ratio",
		outputUnit: "ratio_0_to_1",
		assetClasses: ["residential_1story", "residential_2story", "commercial"],
		geography: "Generic baseline (requires local first-floor elevation and regional calibration)",
		validRange: { min: 0, max: 15.0 },
		license: "Apache-2.0 / Public Reference",
		productionStatus: "illustrative_baseline",
		limitations: [
			"Requires validated inundation depth source (meters above ground/first floor); never derive depth from rainfall alone.",
			"Illustrative piecewise depth-damage ratios require national/local calibration before production loss reporting.",
		],
	},
	"fragility.wind.saffir_simpson_screening": {
		id: "fragility.wind.saffir_simpson_screening",
		version: "SS-screening-1.0",
		category: "wind_damage_screening",
		classification: "step_function_screening",
		name: "Saffir-Simpson Wind Damage Screening Table",
		reference: "Saffir-Simpson Hurricane Wind Scale screening mapping (illustrative tier-based MDR, not full HAZUS component wind model).",
		sourceUrl: "https://www.fema.gov/ilo/flood-maps/tools-resources/flood-map-products/hazus/user-technical-manuals",
		inputMeasure: "sustained_wind_speed",
		inputUnit: "km/h",
		outputMeasure: "mean_damage_ratio",
		outputUnit: "ratio_0_to_1",
		assetClasses: ["generic_building"],
		geography: "Generic screening",
		validRange: { min: 0, max: 400.0 },
		license: "Apache-2.0",
		productionStatus: "illustrative_screening",
		limitations: [
			"Discrete Saffir-Simpson step function; not equivalent to HAZUS component-based hurricane wind engineering curves.",
			"Does not model storm surge, wind-borne debris, or building envelope specifics.",
		],
	},
	"screening.openmeteo.rainfall_trigger": {
		id: "screening.openmeteo.rainfall_trigger",
		version: "1.1",
		category: "meteorological_screening",
		classification: "rainfall_threshold_screening",
		name: "Open-Meteo Cumulative Precipitation Trigger Screening",
		reference: "Open-Meteo Forecast API (ECMWF/GFS/ICON); Anticipatory Action rainfall threshold screening.",
		sourceUrl: "https://open-meteo.com/en/docs",
		inputMeasure: "precipitation_sum",
		inputUnit: "mm",
		outputMeasure: "screening_alert_color",
		outputUnit: "categorical",
		geography: "Global numerical weather model grid",
		validRange: { min: 0, max: 5000.0 },
		license: "CC-BY-4.0 / Open-Meteo Terms",
		productionStatus: "registered_screening_only",
		limitations: [
			"Rainfall-threshold screening only; MUST NOT output or fabricate flood inundation depth.",
			"Operational trigger activation requires a locally approved FbF/anticipatory-action trigger policy.",
		],
	},
	"screening.openmeteo.glofas_discharge": {
		id: "screening.openmeteo.glofas_discharge",
		version: "GloFAS-v4/OpenMeteo-1.0",
		category: "hydrological_screening",
		classification: "river_discharge_screening",
		name: "Open-Meteo / GloFAS River Discharge Screening Adapter",
		reference: "Open-Meteo Flood API (GloFAS ~5 km gridded river discharge).",
		sourceUrl: "https://open-meteo.com/en/docs/flood-api",
		inputMeasure: "river_discharge",
		inputUnit: "m^3/s",
		outputMeasure: "discharge_exceedance_signal",
		outputUnit: "categorical_and_m3s",
		geography: "Global ~5 km river network grid",
		validRange: { min: 0, max: 500000.0 },
		license: "CC-BY-4.0 / Copernicus GloFAS",
		productionStatus: "registered_screening_only",
		limitations: [
			"~5 km grid resolution; requires river-cell suitability check and catchment alignment.",
			"River discharge (m^3/s) is NOT inundation depth (m).",
		],
	},
	"telemetry.ogc.sensorthings_v1_1": {
		id: "telemetry.ogc.sensorthings_v1_1",
		version: "OGC-18-088-v1.1",
		category: "sensor_telemetry_ingestion",
		classification: "in_situ_sensor_observation",
		name: "OGC SensorThings API v1.1 Custom Sensor Telemetry Adapter",
		reference: "OGC SensorThings API Part 1: Sensing Version 1.1 (OGC 18-088); WMO / IOOS QARTOD Observation Quality Control Flags.",
		sourceUrl: "https://docs.ogc.org/is/18-088/18-088.html",
		inputMeasure: "multi_hazard_in_situ_observations",
		inputUnit: "mixed_normalized",
		outputMeasure: "normalized_sensor_observations_and_threshold_signals",
		outputUnit: "m | mm | m3/s | km/h | g",
		geography: "Custom government or private in-situ sensor network",
		validRange: { min: -Infinity, max: Infinity },
		license: "Source-dependent (enforces redistributionAllowed & license metadata per Thing/Datastream)",
		productionStatus: "registered_empirical_screening",
		limitations: [
			"Observation trustworthiness depends on sensor calibration metadata, QARTOD/WMO QC flags, and staleness window.",
			"Observations flagged 'bad' or 'missing' are excluded from threshold breach triggers.",
			"Private/commercial sensor feeds with redistributionAllowed=false must not be redistributed in public CAP broadcasts.",
		],
	},
	"telemetry.stac.hazard_grid_v1": {
		id: "telemetry.stac.hazard_grid_v1",
		version: "STAC-1.0.0",
		category: "earth_observation_hazard_grid",
		classification: "satellite_sar_and_hydraulic_depth_grid",
		name: "STAC v1.0.0 Earth Observation Catalog & Validated Flood Depth Grid Adapter",
		reference: "SpatioTemporal Asset Catalog (STAC) Specification v1.0.0; Copernicus EMS Rapid Mapping; Commercial SAR Flood Depth (ICEYE / Floodbase).",
		sourceUrl: "https://stacspec.org/",
		inputMeasure: "eo_catalog_items_and_inundation_depth_grid",
		inputUnit: "m | cm | ft",
		outputMeasure: "validated_inundation_depth_grid_and_footprints",
		outputUnit: "m",
		geography: "Global / Regional Earth Observation footprints",
		validRange: { min: 0, max: 50.0 },
		license: "Source-dependent (enforces commercial vs. open redistributionAllowed per STAC Item)",
		productionStatus: "registered_empirical_screening",
		limitations: [
			"Flood extent polygons alone do NOT provide inundation depth (returns depthStatus: 'extent_only_no_depth').",
			"Binary Cloud-Optimized GeoTIFF (COG) assets require an external raster decoder to extract JSON depth grids in zero-dependency mode.",
			"Optical imagery with high cloud cover (eo:cloud_cover > maxCloudCover) is flagged as unverified_eo.",
			"Commercial satellite products (redistributionAllowed=false) must not be redistributed in public CAP alerts.",
		],
	},
	"telemetry.fdsn.shakemap_v1": {
		id: "telemetry.fdsn.shakemap_v1",
		version: "FDSN-1.2/ShakeMap-v4",
		category: "seismic_ground_motion_field",
		classification: "station_constrained_shakemap_and_fdsn",
		name: "Custom National FDSN-WS & ShakeMap PGA/PGV/Vs30 Contour/Grid Adapter",
		reference: "FDSN Web Service Specification (fdsnws-event v1.2); USGS ShakeMap v4 Manual (Worden et al., 2020); NEHRP Vs30 Site Classification.",
		sourceUrl: "https://www.fdsn.org/webservices/fdsnws-event-1.2.pdf",
		inputMeasure: "fdsn_events_shakemap_contours_stations_and_pga_grid",
		inputUnit: "%g | g | m/s2 | gal | cm/s | m/s",
		outputMeasure: "station_constrained_pga_g_vs30_site_class_and_grid",
		outputUnit: "g",
		geography: "National / Regional seismic networks (BMKG, PHIVOLCS, JMA, EMSC, GeoNet, USGS)",
		validRange: { min: 0, max: 5.0 },
		license: "Agency-dependent (open FDSN or national agency terms)",
		productionStatus: "registered_empirical_screening",
		limitations: [
			"Upgrades C-04 beyond Wald99 GMICE when instrumented seismic station PGA or ShakeMap PGA contours/grids are provided.",
			"Separates instrumented seismic stations from crowd-sourced macroseismic (DYFI) reports.",
			"Downstream structural loss estimation still requires locally calibrated fragility curves before mode: 'production'.",
		],
	},
	"overlay.sendai.critical_infra_v1": {
		id: "overlay.sendai.critical_infra_v1",
		version: "Sendai-D/OAPIF-1.0",
		category: "critical_infrastructure_overlay",
		classification: "sendai_sector_overlay_and_lifeline_dependencies",
		name: "Sendai Target D 9-Sector Critical Infrastructure Overlay & OGC API - Features Adapter",
		reference: "UNDRR Sendai Framework Monitor Technical Guidance (Target D: D-2..D-4, D-6..D-8); OGC API - Features Part 1 Core (OGC 17-069r4); EU INSPIRE Utility & Governmental Services; FEMA Community Lifelines.",
		sourceUrl: "https://www.ogc.org/standards/ogcapi-features/",
		inputMeasure: "critical_infrastructure_geojson_and_hazard_footprint",
		inputUnit: "WGS84_GeoJSON",
		outputMeasure: "sector_grouped_exposure_and_lifeline_disruption_risk",
		outputUnit: "facilities_by_sendai_sector",
		geography: "National / Municipal critical infrastructure networks",
		validRange: { min: 0, max: Infinity },
		license: "Source-dependent (enforces sensitivity & redistributionAllowed CIP redaction)",
		productionStatus: "registered_empirical_screening",
		limitations: [
			"Physical exposure (D-2..D-4) is tracked strictly separately from cascading lifeline service disruption risk (D-6..D-8) per C-02.",
			"Facilities without recognized Sendai sector tags default to 'other_essential' with classificationWarning=true.",
			"Restricted critical infrastructure (sensitivity='restricted' or redistributionAllowed=false) is redacted when audience='public'.",
		],
	},
	"vulnerability.sendai_composite": {
		id: "vulnerability.sendai_composite",
		version: "1.1",
		category: "loss_and_impact_aggregation",
		classification: "composite_impact_model",
		name: "Composite Vulnerability & Sendai Impact Model",
		reference: "UNDRR Sendai Framework Monitor Technical Guidance (Targets B, C, D) + structural MDR displacement heuristic.",
		sourceUrl: "https://www.undrr.org/implementing-sendai-framework/monitoring-sendai-framework/sfm-methodology",
		inputMeasure: "spatial_exposure_and_intensity",
		inputUnit: "mixed",
		outputMeasure: "economic_loss_and_displacement_estimates",
		outputUnit: "USD_and_persons",
		geography: "Configurable asset portfolio",
		validRange: { min: 0, max: Infinity },
		license: "Apache-2.0",
		productionStatus: "illustrative_baseline",
		limitations: [
			"Modelled displacement (MDR >= 40% heuristic) is distinct from Sendai B-1 directly affected people.",
			"Physical facility damage (D-2..D-4) is tracked separately from basic service disruption (D-6..D-8).",
			"Model output requires Sendai semantic validation and authorized review before official reporting.",
		],
	},
	"telemetry.hdx.ckan_catalog_v1": {
		id: "telemetry.hdx.ckan_catalog_v1",
		version: "CKAN-3.0",
		category: "humanitarian_data_discovery",
		classification: "hdx_ckan_catalog_adapter",
		name: "OCHA HDX CKAN Action API v3 Dataset & COD Discovery Adapter",
		reference: "OCHA Centre for Humanitarian Data — HDX CKAN Action API v3 (package_search) for discovering COD-AB, COD-PS, WorldPop, Kontur, and HOTOSM geodata.",
		sourceUrl: "https://data.humdata.org/api/3/action/package_search",
		inputMeasure: "solr_catalog_query_and_country_filters",
		inputUnit: "query_parameters",
		outputMeasure: "normalized_dataset_catalog_and_resource_download_links",
		outputUnit: "dataset_metadata",
		geography: "Global & Country-Level (ISO-3 HDX Groups)",
		validRange: { min: 0, max: Infinity },
		license: "Dataset-dependent (preserves per-dataset license_id, cod_level, caveats & SHA/MD5 hash)",
		productionStatus: "registered_empirical_screening",
		limitations: [
			"Catalog discovery returns dataset metadata and download URLs without validating downstream resource contents.",
			"Non-COD third-party datasets require verification against authoritative national GIS/statistics before official Sendai reporting.",
		],
	},
	"telemetry.hdx.hapi_v1": {
		id: "telemetry.hdx.hapi_v1",
		version: "2.0",
		category: "humanitarian_data_ingestion",
		classification: "hdx_hapi_rest_adapter",
		name: "OCHA HDX Humanitarian API (HAPI) Ingestion & Provenance Adapter",
		reference: "OCHA Centre for Humanitarian Data — HDX Humanitarian API (HAPI v2) OpenAPI Specification.",
		sourceUrl: "https://hapi.humdata.org/docs",
		inputMeasure: "humanitarian_indicators_and_metadata",
		inputUnit: "HAPI_JSON_records",
		outputMeasure: "normalized_humanitarian_records_with_freshness_and_license",
		outputUnit: "structured_records",
		geography: "Global humanitarian operations (ISO3 / OCHA P-code indexed)",
		validRange: { min: 0, max: Infinity },
		license: "Source-dependent (enforces per-dataset license & freshness metadata)",
		productionStatus: "registered_empirical_screening",
		limitations: [
			"Dataset freshness, geographic coverage, and redistribution rights vary by contributing humanitarian organization and must be checked before operational use.",
			"Live queries to hapi.humdata.org require a registered app_identifier query parameter or HAPI_APP_IDENTIFIER environment variable.",
		],
	},
	"spatial.cod_ab.validation_v1": {
		id: "spatial.cod_ab.validation_v1",
		version: "1.0",
		category: "administrative_boundary_validation",
		classification: "cod_ab_pcode_validator",
		name: "OCHA COD-AB Administrative Boundary & P-Code Hierarchy Validator",
		reference: "OCHA Common Operational Datasets — Administrative Boundaries (COD-AB) P-Code Standard & RFC 7946 GeoJSON.",
		sourceUrl: "https://cod.unocha.org/",
		inputMeasure: "admin_boundary_geojson_or_records",
		inputUnit: "WGS84_GeoJSON_and_PCodes",
		outputMeasure: "hierarchy_geometry_and_delta_reconciliation_report",
		outputUnit: "validation_report",
		geography: "Global administrative divisions (ADM0..ADM4)",
		validRange: { min: 0, max: 4 },
		license: "Apache-2.0 / OCHA COD-AB Terms",
		productionStatus: "registered_empirical_screening",
		limitations: [
			"Validates P-code syntax, uniqueness, parent-child hierarchy, ISO3 alignment, release freshness, and GeoJSON topology; does not supersede national statistical office gazetteers.",
			"Optional DELTA division reconciliation flags unmatched P-codes for human data-steward review rather than silently dropping administrative units.",
		],
	},
	"exposure.hdx.polygon_population_v1": {
		id: "exposure.hdx.polygon_population_v1",
		version: "1.0",
		category: "population_exposure_estimation",
		classification: "areal_interpolation_cod_hapi",
		name: "HDX HAPI + COD-AB Polygon Population Overlap Estimator (Areal Interpolation Screening)",
		reference: "OCHA COD-AB Administrative Boundaries + HDX HAPI v2 Population Statistics (COD-PS) deterministic grid areal interpolation.",
		sourceUrl: "https://hapi.humdata.org/docs",
		inputMeasure: "hazard_polygon_and_cod_ab_boundaries",
		inputUnit: "WGS84_GeoJSON_and_persons",
		outputMeasure: "area_weighted_and_full_unit_exposed_population",
		outputUnit: "persons",
		geography: "Global COD-AB / HDX HAPI covered administrative divisions (ADM0..ADM2)",
		validRange: { min: 0, max: Infinity },
		license: "Apache-2.0 / Source COD-PS License",
		productionStatus: "illustrative_baseline",
		limitations: [
			"Uses uniform-density areal interpolation within each overlapping administrative unit; where urban/rural density varies sharply, use gridded population rasters (WorldPop / GHS-POP) with drr_raster_zonal_stats.",
			"Modelled population exposure is strictly distinct from UNDRR Sendai Target B-1 directly affected people (C-01).",
			"Missing HAPI population counts are preserved as null (never coerced to 0, R-02) and reported in missingPopulationUnits.",
		],
	},
	"exposure.osm.interim_critical_infra_v1": {
		id: "exposure.osm.interim_critical_infra_v1",
		version: "1.0",
		category: "interim_critical_infrastructure_ingestion",
		classification: "osm_overpass_sendai_target_d",
		name: "OpenStreetMap (Overpass API) Interim Critical Infrastructure Adapter (9 Sendai Target D Sectors)",
		reference: "OpenStreetMap Contributors (ODbL 1.0) Overpass API mapped to UNDRR Sendai Framework Target D 9 critical infrastructure sectors.",
		sourceUrl: "https://wiki.openstreetmap.org/wiki/Overpass_API",
		inputMeasure: "bbox_and_sendai_sectors_or_overpass_json",
		inputUnit: "WGS84_bbox_and_OSM_elements",
		outputMeasure: "sendai_sector_normalized_geojson_and_optional_overlay",
		outputUnit: "WGS84_GeoJSON_FeatureCollection",
		geography: "Global (crowdsourced completeness varies by region)",
		validRange: { min: 0, max: Infinity },
		license: "ODbL-1.0 (© OpenStreetMap contributors — attribution required)",
		productionStatus: "registered_screening_only",
		limitations: [
			"Interim open-source fallback only (verificationStatus='external_unverified', reportingEligibility='screening_only'); replace with authoritative national GIS / OGC API - Features or DELTA layers when available.",
			"Crowdsourced OSM completeness varies significantly in rural areas and buried utilities; absence of mapped features MUST NOT be interpreted as zero infrastructure (unknown !== 0).",
			"OSM provides facility locations (physical exposure D-2..D-4) but rarely encodes operational lifeline dependency graphs (dependsOn for D-6..D-8 cascades).",
		],
	},
	"assessment.humanitarian.severity_v1": {
		id: "assessment.humanitarian.severity_v1",
		version: "1.0",
		category: "humanitarian_severity_assessment",
		classification: "multi_factor_severity_index",
		name: "Multi-Factor Humanitarian Rapid Impact & Severity Assessment (JIAF/INFORM-Aligned Screening)",
		reference: "OCHA / IASC Joint Intersectoral Analysis Framework (JIAF 2.0) 1-5 Severity Scale & EU JRC INFORM Risk Index multi-pillar structure.",
		sourceUrl: "https://www.jiaf.info/",
		inputMeasure: "hazard_exposure_vulnerability_coping_capacity",
		inputUnit: "normalized_0_to_10_pillars",
		outputMeasure: "humanitarian_severity_phase_and_confidence",
		outputUnit: "phase_1_to_5_and_score_0_to_10",
		geography: "Global / Sub-national (ADM0..ADM2)",
		validRange: { min: 0, max: 10 },
		license: "Apache-2.0",
		productionStatus: "illustrative_baseline",
		limitations: [
			"Separates hazard intensity, exposure, baseline vulnerability, lack of coping capacity, and data confidence; never reduces humanitarian severity to hazard magnitude alone.",
			"Missing or unknown pillars are never coerced to 0 (R-02); missing dimensions reduce dataConfidence and are listed explicitly.",
			"Screening output is distinct from an official IASC/OCHA JIAF or IPC severity declaration and requires inter-cluster human review before operational publication.",
		],
	},
};

function getRegisteredMethod(methodId) {
	return MODEL_REGISTRY[methodId] || null;
}

function listRegisteredMethods() {
	return Object.values(MODEL_REGISTRY).map((m) => ({
		id: m.id,
		version: m.version,
		category: m.category,
		classification: m.classification,
		name: m.name,
		inputMeasure: m.inputMeasure,
		inputUnit: m.inputUnit,
		outputUnit: m.outputUnit,
		productionStatus: m.productionStatus,
	}));
}

/**
 * Check method registration, domain bounds, asset class validity, and production eligibility (R-04)
 */
function checkDomainApplicability(methodId, inputs = {}, options = {}) {
	const method = getRegisteredMethod(methodId);
	if (!method) {
		return {
			registered: false,
			applicable: false,
			productionAllowed: false,
			warnings: [],
			errors: [
				{
					code: "UNREGISTERED_METHOD",
					field: "methodId",
					message: `Method '${methodId}' is not in the scientific model registry.`,
				},
			],
		};
	}

	const warnings = [];
	const errors = [];
	const policy = options.outOfDomainPolicy || "warn"; // "warn" | "reject"
	const mode = options.mode || "exploratory"; // "exploratory" | "production"

	// Production gate for illustrative / screening models
	const isIllustrative =
		method.productionStatus === "illustrative_baseline" ||
		method.productionStatus === "illustrative_screening";
	const productionAllowed = !isIllustrative && method.productionStatus !== "registered_screening_only";

	if (mode === "production" && !productionAllowed) {
		errors.push({
			code: "ILLUSTRATIVE_METHOD_BLOCKED_IN_PRODUCTION",
			field: "methodId",
			message: `Method '${methodId}' has status '${method.productionStatus}' and is blocked for production publication without calibrated national parameters.`,
		});
	} else if (isIllustrative) {
		warnings.push({
			code: "ILLUSTRATIVE_PARAMETERS_WARNING",
			field: "methodId",
			message: `Method '${methodId}' uses illustrative baseline parameters (${method.productionStatus}); verify regional applicability before operational reliance.`,
		});
	}

	// Range checks
	if (inputs.value !== undefined && inputs.value !== null) {
		const v = Number(inputs.value);
		const r = method.validRange;
		let outOfDomain = false;
		if (!Number.isFinite(v)) {
			errors.push({
				code: "INVALID_NUMERIC_INPUT",
				field: "value",
				message: `Non-finite input '${inputs.value}' for method '${methodId}'.`,
			});
		} else {
			if (r.minExclusive !== undefined && v <= r.minExclusive) outOfDomain = true;
			if (r.min !== undefined && v < r.min) outOfDomain = true;
			if (r.max !== undefined && v > r.max) outOfDomain = true;

			if (outOfDomain) {
				const issue = {
					code: "OUT_OF_DOMAIN_INPUT",
					field: "value",
					message: `Input ${v} ${method.inputUnit} is outside registered domain [${r.min ?? `>${r.minExclusive}`}, ${r.max}] for '${methodId}'.`,
				};
				if (policy === "reject") errors.push(issue);
				else warnings.push(issue);
			}
		}
	}

	// Asset class check
	if (inputs.assetClass && Array.isArray(method.assetClasses)) {
		if (!method.assetClasses.includes(inputs.assetClass)) {
			const issue = {
				code: "UNREGISTERED_ASSET_CLASS",
				field: "assetClass",
				message: `Asset class '${inputs.assetClass}' is not registered for '${methodId}' (supported: ${method.assetClasses.join(", ")}).`,
			};
			if (policy === "reject" || options.strictAssetClass) errors.push(issue);
			else warnings.push(issue);
		}
	}

	return {
		registered: true,
		method: {
			id: method.id,
			version: method.version,
			classification: method.classification,
			reference: method.reference,
			sourceUrl: method.sourceUrl,
			productionStatus: method.productionStatus,
			limitations: method.limitations,
		},
		applicable: errors.length === 0,
		productionAllowed,
		warnings,
		errors,
	};
}

module.exports = {
	MODEL_REGISTRY,
	getRegisteredMethod,
	listRegisteredMethods,
	checkDomainApplicability,
};
