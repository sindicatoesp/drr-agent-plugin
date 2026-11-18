/**
 * GEM & HAZUS Illustrative Baseline Fragility & Vulnerability Curves
 * Implements lognormal fragility functions for structural damage states
 * and depth-damage functions for flood and cyclone wind screening.
 *
 * Note (C-06 / R-04): These curves use representative illustrative baseline parameters.
 * They are registered in lib/registry.js and must not be claimed as full locally calibrated
 * HAZUS production loss models without regional inventory & calibration verification.
 */

const { lognormalCdf } = require("./utils");
const { getRegisteredMethod, checkDomainApplicability } = require("./registry");
const { normalizeHazardIntensity } = require("./contracts");

/**
 * Structural taxonomy parameters for seismic fragility (illustrative GEM/HAZUS baseline)
 * Medians (theta, in g of Peak Ground Acceleration - PGA) and dispersion (beta)
 */
const SEISMIC_FRAGILITY_PARAMS = {
	URM: {
		name: "Unreinforced Masonry Bearing Wall (Low-Rise)",
		slight: { theta: 0.12, beta: 0.65 },
		moderate: { theta: 0.22, beta: 0.65 },
		extensive: { theta: 0.38, beta: 0.68 },
		complete: { theta: 0.65, beta: 0.70 },
	},
	C1_PRE_CODE: {
		name: "Concrete Moment Frame (Non-Ductile Pre-Code)",
		slight: { theta: 0.15, beta: 0.64 },
		moderate: { theta: 0.26, beta: 0.65 },
		extensive: { theta: 0.50, beta: 0.66 },
		complete: { theta: 0.85, beta: 0.68 },
	},
	C1_MODERATE_CODE: {
		name: "Concrete Moment Frame (Moderate-Code Ductile)",
		slight: { theta: 0.25, beta: 0.60 },
		moderate: { theta: 0.45, beta: 0.62 },
		extensive: { theta: 0.80, beta: 0.65 },
		complete: { theta: 1.30, beta: 0.65 },
	},
	C2: {
		name: "Concrete Shear Wall (Low-Rise)",
		slight: { theta: 0.28, beta: 0.60 },
		moderate: { theta: 0.52, beta: 0.62 },
		extensive: { theta: 0.95, beta: 0.64 },
		complete: { theta: 1.50, beta: 0.65 },
	},
	S1: {
		name: "Steel Moment Frame (Low-Rise)",
		slight: { theta: 0.22, beta: 0.60 },
		moderate: { theta: 0.40, beta: 0.62 },
		extensive: { theta: 0.75, beta: 0.64 },
		complete: { theta: 1.25, beta: 0.65 },
	},
	W1: {
		name: "Wood Light Frame (Residential)",
		slight: { theta: 0.18, beta: 0.55 },
		moderate: { theta: 0.35, beta: 0.58 },
		extensive: { theta: 0.70, beta: 0.60 },
		complete: { theta: 1.20, beta: 0.62 },
	},
};

/**
 * HAZUS Standard Damage Ratios (central damage factor / structural loss ratio per state)
 */
const DAMAGE_RATIO_WEIGHTS = {
	none: 0.0,
	slight: 0.05,
	moderate: 0.25,
	extensive: 0.60,
	complete: 1.0,
};

/**
 * Calculate seismic damage state probabilities for a given taxonomy and PGA (g)
 * @param {string} taxonomy - Building class key (e.g. 'URM', 'C1_PRE_CODE')
 * @param {number} pga - Peak Ground Acceleration in g (e.g. 0.35)
 * @param {object} options - { unit: 'g'|'m/s2'|'cm/s2'|'gal'|'%g', strict: boolean, mode: 'exploratory'|'production' }
 * @returns {object} Probabilities for each damage state, Mean Damage Ratio (MDR), and method provenance
 */
function evaluateSeismicFragility(taxonomy, pga, options = {}) {
	if (!taxonomy || typeof taxonomy !== "string") {
		throw new Error("MISSING_REQUIRED_INPUT: structural taxonomy is required (e.g. URM, C1_PRE_CODE, C2, S1, W1).");
	}
	const normInt = normalizeHazardIntensity("earthquake", pga, options.unit || options.intensityUnit || "g");
	if (!normInt.valid) {
		throw new Error(`${normInt.error.code}: ${normInt.error.message}`);
	}
	const pgaG = normInt.intensity;

	const normalizedKey = taxonomy.trim().toUpperCase();
	const params = SEISMIC_FRAGILITY_PARAMS[taxonomy] || SEISMIC_FRAGILITY_PARAMS[normalizedKey];
	if (!params) {
		throw new Error(
			`UNREGISTERED_ASSET_CLASS: Unknown seismic taxonomy '${taxonomy}'. Supported classes: ${Object.keys(SEISMIC_FRAGILITY_PARAMS).join(", ")}.`,
		);
	}

	const methodId = "fragility.seismic.gem_hazus_baseline";
	const appCheck = checkDomainApplicability(
		methodId,
		{ value: pgaG === 0 ? 0.0001 : pgaG, assetClass: normalizedKey },
		{ outOfDomainPolicy: options.strict ? "reject" : "warn", mode: options.mode || "exploratory" },
	);
	if (!appCheck.applicable) {
		throw new Error(appCheck.errors.map((e) => `${e.code}: ${e.message}`).join("; "));
	}

	// Zero-intensity behavior: 0 PGA => P(exceed) = 0, P(none) = 1, MDR = 0
	const pExceedSlight = pgaG === 0 ? 0 : lognormalCdf(pgaG, params.slight.theta, params.slight.beta);
	const pExceedModerate = pgaG === 0 ? 0 : lognormalCdf(pgaG, params.moderate.theta, params.moderate.beta);
	const pExceedExtensive = pgaG === 0 ? 0 : lognormalCdf(pgaG, params.extensive.theta, params.extensive.beta);
	const pExceedComplete = pgaG === 0 ? 0 : lognormalCdf(pgaG, params.complete.theta, params.complete.beta);

	const pNone = Math.max(0, 1.0 - pExceedSlight);
	const pSlight = Math.max(0, pExceedSlight - pExceedModerate);
	const pModerate = Math.max(0, pExceedModerate - pExceedExtensive);
	const pExtensive = Math.max(0, pExceedExtensive - pExceedComplete);
	const pComplete = Math.max(0, pExceedComplete);

	const meanDamageRatio =
		pNone * DAMAGE_RATIO_WEIGHTS.none +
		pSlight * DAMAGE_RATIO_WEIGHTS.slight +
		pModerate * DAMAGE_RATIO_WEIGHTS.moderate +
		pExtensive * DAMAGE_RATIO_WEIGHTS.extensive +
		pComplete * DAMAGE_RATIO_WEIGHTS.complete;

	const reg = getRegisteredMethod(methodId);

	return {
		taxonomy: normalizedKey,
		description: params.name,
		hazardIntensityPGA: pgaG,
		unit: "g",
		unitConversion: normInt.conversion,
		exceedanceProbabilities: {
			slight: parseFloat(pExceedSlight.toFixed(4)),
			moderate: parseFloat(pExceedModerate.toFixed(4)),
			extensive: parseFloat(pExceedExtensive.toFixed(4)),
			complete: parseFloat(pExceedComplete.toFixed(4)),
		},
		discreteProbabilities: {
			none: parseFloat(pNone.toFixed(4)),
			slight: parseFloat(pSlight.toFixed(4)),
			moderate: parseFloat(pModerate.toFixed(4)),
			extensive: parseFloat(pExtensive.toFixed(4)),
			complete: parseFloat(pComplete.toFixed(4)),
		},
		meanDamageRatio: parseFloat(meanDamageRatio.toFixed(4)),
		expectedDamagePercentage: parseFloat((meanDamageRatio * 100).toFixed(2)),
		method: {
			id: reg.id,
			version: reg.version,
			productionStatus: reg.productionStatus,
			reference: reg.reference,
			limitations: reg.limitations,
		},
		warnings: appCheck.warnings,
	};
}

const VALID_FLOOD_OCCUPANCIES = new Set(["residential_1story", "residential_2story", "commercial"]);

/**
 * Flood Depth-Damage Function (Illustrative FIA / HAZUS Depth-Damage Baseline)
 * @param {number} depthMeters - Inundation depth in meters above ground/first floor
 * @param {string} occupancy - 'residential_1story', 'residential_2story', 'commercial'
 * @param {object} options - { unit: 'm'|'cm'|'ft', strict: boolean, mode: 'exploratory'|'production' }
 * @returns {object} Mean damage ratio and estimated structure/content loss
 */
function evaluateFloodDamage(depthMeters, occupancy = "residential_1story", options = {}) {
	const normInt = normalizeHazardIntensity("flood", depthMeters, options.unit || options.intensityUnit || "m");
	if (!normInt.valid) {
		throw new Error(`${normInt.error.code}: ${normInt.error.message}`);
	}
	const d = normInt.intensity;
	const occ = occupancy || "residential_1story";

	if (!VALID_FLOOD_OCCUPANCIES.has(occ)) {
		throw new Error(
			`UNREGISTERED_ASSET_CLASS: Unsupported flood occupancy '${occ}'. Supported: ${Array.from(VALID_FLOOD_OCCUPANCIES).join(", ")}.`,
		);
	}

	const methodId = "fragility.flood.fia_hazus_baseline";
	const appCheck = checkDomainApplicability(
		methodId,
		{ value: d, assetClass: occ },
		{ outOfDomainPolicy: options.strict ? "reject" : "warn", mode: options.mode || "exploratory" },
	);
	if (!appCheck.applicable) {
		throw new Error(appCheck.errors.map((e) => `${e.code}: ${e.message}`).join("; "));
	}

	let structuralDamageRatio = 0.0;
	let contentDamageRatio = 0.0;

	if (d === 0) {
		structuralDamageRatio = 0.0;
		contentDamageRatio = 0.0;
	} else if (occ === "residential_1story") {
		if (d <= 0.3) {
			structuralDamageRatio = 0.08 + (d / 0.3) * 0.06; // 8% - 14%
			contentDamageRatio = 0.12 + (d / 0.3) * 0.12;
		} else if (d <= 1.0) {
			structuralDamageRatio = 0.14 + ((d - 0.3) / 0.7) * 0.22; // 14% - 36%
			contentDamageRatio = 0.24 + ((d - 0.3) / 0.7) * 0.30;
		} else if (d <= 2.5) {
			structuralDamageRatio = 0.36 + ((d - 1.0) / 1.5) * 0.24; // 36% - 60%
			contentDamageRatio = 0.54 + ((d - 1.0) / 1.5) * 0.26;
		} else {
			structuralDamageRatio = Math.min(0.85, 0.6 + (d - 2.5) * 0.08);
			contentDamageRatio = Math.min(0.95, 0.8 + (d - 2.5) * 0.05);
		}
	} else if (occ === "residential_2story") {
		// Two-story residential: second story reduces fractional structural & content exposure at low-to-mid depths
		if (d <= 0.3) {
			structuralDamageRatio = 0.05 + (d / 0.3) * 0.05; // 5% - 10%
			contentDamageRatio = 0.08 + (d / 0.3) * 0.08;
		} else if (d <= 1.5) {
			structuralDamageRatio = 0.10 + ((d - 0.3) / 1.2) * 0.18; // 10% - 28%
			contentDamageRatio = 0.16 + ((d - 0.3) / 1.2) * 0.24;
		} else if (d <= 3.0) {
			structuralDamageRatio = 0.28 + ((d - 1.5) / 1.5) * 0.22; // 28% - 50%
			contentDamageRatio = 0.40 + ((d - 1.5) / 1.5) * 0.28;
		} else {
			structuralDamageRatio = Math.min(0.80, 0.50 + (d - 3.0) * 0.07);
			contentDamageRatio = Math.min(0.92, 0.68 + (d - 3.0) * 0.06);
		}
	} else {
		// commercial
		if (d <= 0.5) {
			structuralDamageRatio = (d / 0.5) * 0.18;
			contentDamageRatio = (d / 0.5) * 0.35;
		} else if (d <= 2.0) {
			structuralDamageRatio = 0.18 + ((d - 0.5) / 1.5) * 0.35;
			contentDamageRatio = 0.35 + ((d - 0.5) / 1.5) * 0.45;
		} else {
			structuralDamageRatio = Math.min(0.75, 0.53 + (d - 2.0) * 0.07);
			contentDamageRatio = Math.min(0.95, 0.8 + (d - 2.0) * 0.05);
		}
	}

	const reg = getRegisteredMethod(methodId);

	return {
		occupancy: occ,
		inundationDepthMeters: d,
		unit: "m",
		unitConversion: normInt.conversion,
		structuralDamageRatio: parseFloat(structuralDamageRatio.toFixed(4)),
		contentDamageRatio: parseFloat(contentDamageRatio.toFixed(4)),
		combinedMeanDamageRatio: parseFloat(
			(structuralDamageRatio * 0.6 + contentDamageRatio * 0.4).toFixed(4),
		),
		method: {
			id: reg.id,
			version: reg.version,
			productionStatus: reg.productionStatus,
			reference: reg.reference,
			limitations: reg.limitations,
		},
		warnings: appCheck.warnings,
	};
}

/**
 * Tropical Cyclone / Wind Damage Screening (Saffir-Simpson Screening Table)
 * @param {number} windSpeedKmh - Max sustained wind speed in km/h
 * @param {object} options - { unit: 'km/h'|'m/s'|'kt'|'mph', strict: boolean, mode: 'exploratory'|'production' }
 * @returns {object} Saffir-Simpson category, damage ratios, and method provenance
 */
function evaluateWindDamage(windSpeedKmh, options = {}) {
	const normInt = normalizeHazardIntensity("wind", windSpeedKmh, options.unit || options.intensityUnit || "km/h");
	if (!normInt.valid) {
		throw new Error(`${normInt.error.code}: ${normInt.error.message}`);
	}
	const w = normInt.intensity;

	const methodId = "fragility.wind.saffir_simpson_screening";
	const appCheck = checkDomainApplicability(
		methodId,
		{ value: w },
		{ outOfDomainPolicy: options.strict ? "reject" : "warn", mode: options.mode || "exploratory" },
	);
	if (!appCheck.applicable) {
		throw new Error(appCheck.errors.map((e) => `${e.code}: ${e.message}`).join("; "));
	}

	let category = 0;
	let damageState = "None";
	let meanDamageRatio = 0.0;

	if (w === 0) {
		category = 0;
		damageState = "Calm / No Wind";
		meanDamageRatio = 0.0;
	} else if (w < 63) {
		category = 0;
		damageState = "Below Tropical Storm";
		meanDamageRatio = 0.0;
	} else if (w < 119) {
		category = 0;
		damageState = "Tropical Storm";
		meanDamageRatio = 0.02;
	} else if (w < 154) {
		category = 1;
		damageState = "Category 1 Hurricane";
		meanDamageRatio = 0.08;
	} else if (w < 178) {
		category = 2;
		damageState = "Category 2 Hurricane";
		meanDamageRatio = 0.22;
	} else if (w < 209) {
		category = 3;
		damageState = "Category 3 Major Hurricane";
		meanDamageRatio = 0.45;
	} else if (w < 252) {
		category = 4;
		damageState = "Category 4 Catastrophic Hurricane";
		meanDamageRatio = 0.72;
	} else {
		category = 5;
		damageState = "Category 5 Catastrophic Hurricane";
		meanDamageRatio = 0.92;
	}

	const reg = getRegisteredMethod(methodId);

	return {
		windSpeedKmh: w,
		windSpeedMps: parseFloat((w / 3.6).toFixed(1)),
		unit: "km/h",
		unitConversion: normInt.conversion,
		saffirSimpsonCategory: category,
		intensityLabel: damageState,
		meanDamageRatio: parseFloat(meanDamageRatio.toFixed(4)),
		expectedDamagePercentage: parseFloat((meanDamageRatio * 100).toFixed(1)),
		method: {
			id: reg.id,
			version: reg.version,
			productionStatus: reg.productionStatus,
			reference: reg.reference,
			limitations: reg.limitations,
		},
		warnings: appCheck.warnings,
	};
}

module.exports = {
	SEISMIC_FRAGILITY_PARAMS,
	DAMAGE_RATIO_WEIGHTS,
	VALID_FLOOD_OCCUPANCIES,
	evaluateSeismicFragility,
	evaluateFloodDamage,
	evaluateWindDamage,
};
