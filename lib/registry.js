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
