/**
 * Uncertainty Propagation & Sensitivity Analysis Module (R-14, C-08)
 *
 * Supports:
 * - Deterministic min/central/max interval propagation
 * - One-at-a-time (OAT) parameter sensitivity ranking
 * - Reproducible seeded Monte Carlo simulation (Mulberry32 PRNG + Box-Muller Gaussian)
 *   with sourced distribution checks, correlation warnings, and split-half convergence checks.
 *
 * Pure Node.js standard library only.
 */

const { evaluateSeismicFragility, evaluateFloodDamage, evaluateWindDamage } = require("./fragility");

/**
 * Deterministic 32-bit PRNG (Mulberry32) for reproducible Monte Carlo simulations
 */
function createSeededRng(seed = 42) {
	let state = (Number(seed) >>> 0) || 1;
	return function nextRandom() {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function sampleStandardNormal(rng) {
	const u1 = Math.max(1e-12, rng());
	const u2 = rng();
	return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function sampleDistribution(dist = {}, rng) {
	const type = String(dist.type || "fixed").toLowerCase();
	if (type === "fixed") return Number(dist.value);
	if (type === "uniform") {
		return dist.min + (dist.max - dist.min) * rng();
	}
	if (type === "triangular") {
		const a = dist.min;
		const b = dist.max;
		const c = dist.mode ?? (a + b) / 2;
		const u = rng();
		const fc = (c - a) / (b - a);
		return u < fc
			? a + Math.sqrt(u * (b - a) * (c - a))
			: b - Math.sqrt((1 - u) * (b - a) * (b - c));
	}
	if (type === "normal") {
		const val = dist.mean + dist.sd * sampleStandardNormal(rng);
		return Math.max(dist.min ?? -Infinity, Math.min(dist.max ?? Infinity, val));
	}
	if (type === "lognormal") {
		const val = dist.median * Math.exp((dist.sigma || 0.2) * sampleStandardNormal(rng));
		return Math.max(dist.min ?? 0, Math.min(dist.max ?? Infinity, val));
	}
	throw new Error(`UNSUPPORTED_DISTRIBUTION: '${dist.type}' is not supported.`);
}

function evaluateCoreLoss(params) {
	const {
		hazardType,
		intensity,
		taxonomy = "URM",
		occupancy = "residential_1story",
		exposedValueUsd,
		valueMultiplier = 1.0,
		mdrMultiplier = 1.0,
	} = params;

	let baseMdr = 0;
	if (hazardType === "earthquake") {
		baseMdr = evaluateSeismicFragility(taxonomy, Math.max(0, intensity)).meanDamageRatio;
	} else if (hazardType === "flood") {
		baseMdr = evaluateFloodDamage(Math.max(0, intensity), occupancy).combinedMeanDamageRatio;
	} else if (hazardType === "wind") {
		baseMdr = evaluateWindDamage(Math.max(0, intensity)).meanDamageRatio;
	} else {
		throw new Error(`Unsupported hazardType '${hazardType}'`);
	}

	const adjustedMdr = Math.max(0, Math.min(1, baseMdr * mdrMultiplier));
	const lossUsd = exposedValueUsd * valueMultiplier * adjustedMdr;
	return { mdr: adjustedMdr, lossUsd };
}

function quantile(sortedArr, q) {
	if (sortedArr.length === 0) return null;
	const pos = (sortedArr.length - 1) * q;
	const base = Math.floor(pos);
	const rest = pos - base;
	if (sortedArr[base + 1] !== undefined) {
		return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
	}
	return sortedArr[base];
}

/**
 * Propagate uncertainty via deterministic bounds/OAT sensitivity and optional seeded Monte Carlo
 * @param {object} params
 * @returns {object} Uncertainty & sensitivity report
 */
function propagateUncertainty(params = {}) {
	const hazardType = params.hazardType || "earthquake";
	const centralIntensity = params.intensity;
	const exposedValueUsd = params.exposedValueUsd;

	if (!Number.isFinite(Number(centralIntensity)) || !Number.isFinite(Number(exposedValueUsd))) {
		throw new Error("MISSING_REQUIRED_INPUT: numeric intensity and exposedValueUsd are required.");
	}

	const intensityBounds = params.intensityBounds || {
		min: Math.max(0, centralIntensity * 0.8),
		max: centralIntensity * 1.2,
		sourced: false,
	};
	const valueMultiplierBounds = params.valueMultiplierBounds || {
		min: 0.85,
		max: 1.15,
		sourced: false,
	};
	const mdrMultiplierBounds = params.mdrMultiplierBounds || {
		min: 0.8,
		max: 1.2,
		sourced: false,
	};

	const taxonomy = params.taxonomy || "URM";
	const occupancy = params.occupancy || "residential_1story";

	// 1. Deterministic central & interval bounds
	const central = evaluateCoreLoss({
		hazardType,
		intensity: centralIntensity,
		taxonomy,
		occupancy,
		exposedValueUsd,
	});
	const low = evaluateCoreLoss({
		hazardType,
		intensity: intensityBounds.min,
		taxonomy,
		occupancy,
		exposedValueUsd,
		valueMultiplier: valueMultiplierBounds.min,
		mdrMultiplier: mdrMultiplierBounds.min,
	});
	const high = evaluateCoreLoss({
		hazardType,
		intensity: intensityBounds.max,
		taxonomy,
		occupancy,
		exposedValueUsd,
		valueMultiplier: valueMultiplierBounds.max,
		mdrMultiplier: mdrMultiplierBounds.max,
	});

	// 2. One-at-a-time (OAT) parameter sensitivity analysis
	const oatInputs = [
		{
			parameter: "hazardIntensity",
			lowLoss: evaluateCoreLoss({ hazardType, intensity: intensityBounds.min, taxonomy, occupancy, exposedValueUsd }).lossUsd,
			highLoss: evaluateCoreLoss({ hazardType, intensity: intensityBounds.max, taxonomy, occupancy, exposedValueUsd }).lossUsd,
		},
		{
			parameter: "exposedAssetValuation",
			lowLoss: evaluateCoreLoss({ hazardType, intensity: centralIntensity, taxonomy, occupancy, exposedValueUsd, valueMultiplier: valueMultiplierBounds.min }).lossUsd,
			highLoss: evaluateCoreLoss({ hazardType, intensity: centralIntensity, taxonomy, occupancy, exposedValueUsd, valueMultiplier: valueMultiplierBounds.max }).lossUsd,
		},
		{
			parameter: "fragilityCurveMdr",
			lowLoss: evaluateCoreLoss({ hazardType, intensity: centralIntensity, taxonomy, occupancy, exposedValueUsd, mdrMultiplier: mdrMultiplierBounds.min }).lossUsd,
			highLoss: evaluateCoreLoss({ hazardType, intensity: centralIntensity, taxonomy, occupancy, exposedValueUsd, mdrMultiplier: mdrMultiplierBounds.max }).lossUsd,
		},
	];

	const totalSwing = oatInputs.reduce((acc, item) => acc + Math.abs(item.highLoss - item.lowLoss), 0);
	const sensitivityRanking = oatInputs
		.map((item) => {
			const swing = Math.abs(item.highLoss - item.lowLoss);
			return {
				parameter: item.parameter,
				lowLossUsd: parseFloat(item.lowLoss.toFixed(2)),
				highLossUsd: parseFloat(item.highLoss.toFixed(2)),
				swingUsd: parseFloat(swing.toFixed(2)),
				contributionPercentage: totalSwing > 0 ? parseFloat(((swing / totalSwing) * 100).toFixed(1)) : 0,
			};
		})
		.sort((a, b) => b.swingUsd - a.swingUsd);

	const mode = params.mode || "deterministic_bounds";
	const warnings = [];
	let monteCarlo = null;

	if (mode === "monte_carlo") {
		const distributions = params.distributions || null;
		const allowIllustrative = params.allowIllustrativeDistributions === true;
		if (!distributions && !allowIllustrative) {
			throw new Error(
				"UNSOURCED_DISTRIBUTIONS: Monte Carlo mode requires explicit 'distributions' metadata or { allowIllustrativeDistributions: true } flag.",
			);
		}
		if (allowIllustrative && !distributions) {
			warnings.push({
				code: "ILLUSTRATIVE_MONTE_CARLO_DISTRIBUTIONS",
				message: "Using uncalibrated illustrative triangular distributions for sensitivity exploration only.",
			});
		}

		const seed = params.seed !== undefined ? Number(params.seed) : 42;
		const iterations = Math.min(Math.max(parseInt(params.iterations || 1000, 10), 100), 20000);
		const rng = createSeededRng(seed);

		const intDist = distributions?.intensity || {
			type: "triangular",
			min: intensityBounds.min,
			mode: centralIntensity,
			max: intensityBounds.max,
		};
		const valDist = distributions?.valueMultiplier || {
			type: "triangular",
			min: valueMultiplierBounds.min,
			mode: 1.0,
			max: valueMultiplierBounds.max,
		};
		const mdrDist = distributions?.mdrMultiplier || {
			type: "triangular",
			min: mdrMultiplierBounds.min,
			mode: 1.0,
			max: mdrMultiplierBounds.max,
		};

		const samples = [];
		for (let i = 0; i < iterations; i++) {
			const sInt = Math.max(0, sampleDistribution(intDist, rng));
			const sVal = Math.max(0, sampleDistribution(valDist, rng));
			const sMdr = Math.max(0, sampleDistribution(mdrDist, rng));
			samples.push(
				evaluateCoreLoss({
					hazardType,
					intensity: sInt,
					taxonomy,
					occupancy,
					exposedValueUsd,
					valueMultiplier: sVal,
					mdrMultiplier: sMdr,
				}).lossUsd,
			);
		}

		const half = Math.floor(samples.length / 2);
		const mean1 = samples.slice(0, half).reduce((a, b) => a + b, 0) / half;
		const mean2 = samples.slice(half).reduce((a, b) => a + b, 0) / (samples.length - half);
		const overallMean = samples.reduce((a, b) => a + b, 0) / samples.length;
		const variance = samples.reduce((a, b) => a + (b - overallMean) ** 2, 0) / samples.length;
		const splitHalfRelDiff = overallMean > 0 ? Math.abs(mean1 - mean2) / overallMean : 0;

		const sorted = samples.slice().sort((a, b) => a - b);
		if (!params.correlationMatrix) {
			warnings.push({
				code: "INDEPENDENCE_ASSUMED",
				message: "Monte Carlo parameters sampled independently; spatial/vulnerability correlations may widen tail losses.",
			});
		}

		monteCarlo = {
			seed,
			iterations,
			distributionProvenance: distributions ? "user_supplied_distributions" : "illustrative_sensitivity_only",
			meanLossUsd: parseFloat(overallMean.toFixed(2)),
			stdDevUsd: parseFloat(Math.sqrt(variance).toFixed(2)),
			percentilesUsd: {
				p5: parseFloat(quantile(sorted, 0.05).toFixed(2)),
				p25: parseFloat(quantile(sorted, 0.25).toFixed(2)),
				p50: parseFloat(quantile(sorted, 0.5).toFixed(2)),
				p75: parseFloat(quantile(sorted, 0.75).toFixed(2)),
				p95: parseFloat(quantile(sorted, 0.95).toFixed(2)),
			},
			convergenceCheck: {
				firstHalfMeanUsd: parseFloat(mean1.toFixed(2)),
				secondHalfMeanUsd: parseFloat(mean2.toFixed(2)),
				splitHalfRelativeDiff: parseFloat(splitHalfRelDiff.toFixed(5)),
				converged: splitHalfRelDiff < 0.05,
			},
		};
	}

	return {
		mode,
		hazardType,
		centralEstimate: {
			meanDamageRatio: central.mdr,
			lossUsd: parseFloat(central.lossUsd.toFixed(2)),
		},
		deterministicBounds: {
			lowLossUsd: parseFloat(low.lossUsd.toFixed(2)),
			centralLossUsd: parseFloat(central.lossUsd.toFixed(2)),
			highLossUsd: parseFloat(high.lossUsd.toFixed(2)),
		},
		sensitivityRanking,
		monteCarlo,
		warnings,
	};
}

module.exports = {
	createSeededRng,
	propagateUncertainty,
};
