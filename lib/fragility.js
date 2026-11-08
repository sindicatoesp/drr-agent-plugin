/**
 * GEM & HAZUS Fragility & Vulnerability Curves
 * Implements standard lognormal fragility functions for structural damage states
 * and depth-damage functions for flood and cyclone wind.
 */

const { lognormalCdf } = require("./utils");

/**
 * Structural taxonomy parameters for seismic fragility
 * Medians (theta, in g of Peak Ground Acceleration - PGA) and dispersion (beta)
 * Based on GEM Taxonomy v2.0 and HAZUS-MH 2.1 Technical Manual
 */
const SEISMIC_FRAGILITY_PARAMS = {
	// Unreinforced Masonry Bearing Walls (low-rise)
	URM: {
		name: "Unreinforced Masonry Bearing Wall (Low-Rise)",
		slight: { theta: 0.12, beta: 0.65 },
		moderate: { theta: 0.22, beta: 0.65 },
		extensive: { theta: 0.38, beta: 0.68 },
		complete: { theta: 0.65, beta: 0.70 },
	},
	// Concrete Moment-Resisting Frame (Low-Rise, Pre-Code / Non-Ductile)
	C1_PRE_CODE: {
		name: "Concrete Moment Frame (Non-Ductile Pre-Code)",
		slight: { theta: 0.15, beta: 0.64 },
		moderate: { theta: 0.26, beta: 0.65 },
		extensive: { theta: 0.50, beta: 0.66 },
		complete: { theta: 0.85, beta: 0.68 },
	},
	// Concrete Moment-Resisting Frame (Low-Rise, Moderate-Code / Ductile)
	C1_MODERATE_CODE: {
		name: "Concrete Moment Frame (Moderate-Code Ductile)",
		slight: { theta: 0.25, beta: 0.60 },
		moderate: { theta: 0.45, beta: 0.62 },
		extensive: { theta: 0.80, beta: 0.65 },
		complete: { theta: 1.30, beta: 0.65 },
	},
	// Concrete Shear Wall (Low-Rise)
	C2: {
		name: "Concrete Shear Wall (Low-Rise)",
		slight: { theta: 0.28, beta: 0.60 },
		moderate: { theta: 0.52, beta: 0.62 },
		extensive: { theta: 0.95, beta: 0.64 },
		complete: { theta: 1.50, beta: 0.65 },
	},
	// Steel Moment Frame (Low-Rise)
	S1: {
		name: "Steel Moment Frame (Low-Rise)",
		slight: { theta: 0.22, beta: 0.60 },
		moderate: { theta: 0.40, beta: 0.62 },
		extensive: { theta: 0.75, beta: 0.64 },
		complete: { theta: 1.25, beta: 0.65 },
	},
	// Light Wood Frame (Residential)
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
	slight: 0.05, // 2% - 10%
	moderate: 0.25, // 10% - 40%
	extensive: 0.60, // 40% - 80%
	complete: 1.0, // 100% replacement cost
};

/**
 * Calculate seismic damage state probabilities for a given taxonomy and PGA (g)
 * @param {string} taxonomy - Building class key (e.g. 'URM', 'C1_PRE_CODE')
 * @param {number} pga - Peak Ground Acceleration in g (e.g. 0.35)
 * @returns {object} Probabilities for each damage state and Mean Damage Ratio (MDR)
 */
function evaluateSeismicFragility(taxonomy, pga) {
	const params =
		SEISMIC_FRAGILITY_PARAMS[taxonomy] ||
		SEISMIC_FRAGILITY_PARAMS[taxonomy.toUpperCase()] ||
		SEISMIC_FRAGILITY_PARAMS.C1_PRE_CODE;

	// Exceedance probabilities: P(DS >= ds | PGA)
	const pExceedSlight = lognormalCdf(
		pga,
		params.slight.theta,
		params.slight.beta,
	);
	const pExceedModerate = lognormalCdf(
		pga,
		params.moderate.theta,
		params.moderate.beta,
	);
	const pExceedExtensive = lognormalCdf(
		pga,
		params.extensive.theta,
		params.extensive.beta,
	);
	const pExceedComplete = lognormalCdf(
		pga,
		params.complete.theta,
		params.complete.beta,
	);

	// Discrete damage state probabilities: P(DS == ds)
	const pNone = Math.max(0, 1.0 - pExceedSlight);
	const pSlight = Math.max(0, pExceedSlight - pExceedModerate);
	const pModerate = Math.max(0, pExceedModerate - pExceedExtensive);
	const pExtensive = Math.max(0, pExceedExtensive - pExceedComplete);
	const pComplete = Math.max(0, pExceedComplete);

	// Mean Damage Ratio (MDR): Expected loss ratio as percentage of replacement value
	const meanDamageRatio =
		pNone * DAMAGE_RATIO_WEIGHTS.none +
		pSlight * DAMAGE_RATIO_WEIGHTS.slight +
		pModerate * DAMAGE_RATIO_WEIGHTS.moderate +
		pExtensive * DAMAGE_RATIO_WEIGHTS.extensive +
		pComplete * DAMAGE_RATIO_WEIGHTS.complete;

	return {
		taxonomy: taxonomy,
		description: params.name,
		hazardIntensityPGA: pga,
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
	};
}

/**
 * Flood Depth-Damage Function (FEMA FIA / HAZUS Depth-Damage Curve)
 * @param {number} depthMeters - Inundation depth in meters above ground level
 * @param {string} occupancy - 'residential_1story', 'residential_2story', 'commercial'
 * @returns {object} Mean damage ratio and estimated structure/content loss
 */
function evaluateFloodDamage(depthMeters, occupancy = "residential_1story") {
	const d = Math.max(0, depthMeters);

	// Depth to structural damage ratio lookup / polynomial approximation
	let structuralDamageRatio = 0.0;
	let contentDamageRatio = 0.0;

	if (occupancy === "residential_1story") {
		if (d === 0) {
			structuralDamageRatio = 0.0;
		} else if (d <= 0.3) {
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
	} else {
		// Commercial / generic infrastructure
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

	return {
		occupancy,
		inundationDepthMeters: depthMeters,
		structuralDamageRatio: parseFloat(structuralDamageRatio.toFixed(4)),
		contentDamageRatio: parseFloat(contentDamageRatio.toFixed(4)),
		combinedMeanDamageRatio: parseFloat(
			(structuralDamageRatio * 0.6 + contentDamageRatio * 0.4).toFixed(4),
		),
	};
}

/**
 * Tropical Cyclone / Wind Damage (HAZUS Hurricane Model)
 * @param {number} windSpeedKmh - Max sustained wind speed in km/h
 * @returns {object} Saffir-Simpson category and damage ratios
 */
function evaluateWindDamage(windSpeedKmh) {
	let category = 0;
	let damageState = "None";
	let meanDamageRatio = 0.0;

	if (windSpeedKmh < 119) {
		category = 0;
		damageState = "Tropical Storm";
		meanDamageRatio = 0.02;
	} else if (windSpeedKmh < 154) {
		category = 1;
		damageState = "Category 1 Hurricane";
		meanDamageRatio = 0.08;
	} else if (windSpeedKmh < 178) {
		category = 2;
		damageState = "Category 2 Hurricane";
		meanDamageRatio = 0.22;
	} else if (windSpeedKmh < 209) {
		category = 3;
		damageState = "Category 3 Major Hurricane";
		meanDamageRatio = 0.45;
	} else if (windSpeedKmh < 252) {
		category = 4;
		damageState = "Category 4 Catastrophic Hurricane";
		meanDamageRatio = 0.72;
	} else {
		category = 5;
		damageState = "Category 5 Catastrophic Hurricane";
		meanDamageRatio = 0.92;
	}

	return {
		windSpeedKmh,
		windSpeedMps: parseFloat((windSpeedKmh / 3.6).toFixed(1)),
		saffirSimpsonCategory: category,
		intensityLabel: damageState,
		meanDamageRatio: parseFloat(meanDamageRatio.toFixed(4)),
		expectedDamagePercentage: parseFloat((meanDamageRatio * 100).toFixed(1)),
	};
}

module.exports = {
	SEISMIC_FRAGILITY_PARAMS,
	DAMAGE_RATIO_WEIGHTS,
	evaluateSeismicFragility,
	evaluateFloodDamage,
	evaluateWindDamage,
};
