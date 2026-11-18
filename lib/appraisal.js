/**
 * Risk-Reduction Options Appraisal: Expected Annual Loss (EAL / AAL) &
 * Cost-Benefit Analysis (CBA) Module (R-15, P2)
 *
 * Enforces:
 * - EAL requires multiple exceedance frequencies / return periods (never conflates single scenario loss with EAL)
 * - Explicit currency and valuationYear
 * - Explicit tail extrapolation vs truncation assumption
 * - CBA separates quantitative metrics (NPV, BCR, residual risk, maintenance, sensitivity)
 *   from normative policy judgements.
 *
 * Pure Node.js standard library only.
 */

/**
 * Calculate Expected Annual Loss (EAL) by integrating a Loss-Exceedance Curve (AEP vs Loss)
 * @param {object} params - { points: [{ returnPeriodYears?: number, aep?: number, loss: number }], currency: string, valuationYear: number, tailHandling?: "truncate"|"flat_extrapolation" }
 * @returns {object} EAL calculation report
 */
function calculateExpectedAnnualLoss(params = {}) {
	const rawPoints = Array.isArray(params.points) ? params.points : [];
	if (rawPoints.length < 2) {
		throw new Error(
			"SINGLE_EVENT_CANNOT_ESTABLISH_EAL: Expected Annual Loss requires at least 2 distinct return periods / AEP points on a loss-exceedance curve.",
		);
	}
	if (!params.currency || !/^[A-Z]{3}$/.test(String(params.currency))) {
		throw new Error("MISSING_OR_INVALID_CURRENCY: Explicit 3-letter ISO currency code (e.g. 'USD') is required.");
	}
	if (!Number.isInteger(Number(params.valuationYear))) {
		throw new Error("MISSING_VALUATION_YEAR: Integer valuationYear is required.");
	}

	const normalized = rawPoints.map((pt, idx) => {
		let aep = pt.aep !== undefined && pt.aep !== null ? Number(pt.aep) : null;
		const rp = pt.returnPeriodYears !== undefined && pt.returnPeriodYears !== null ? Number(pt.returnPeriodYears) : null;
		if (aep === null && rp !== null && rp > 0) {
			aep = 1 / rp;
		}
		const loss = Number(pt.loss);
		if (!Number.isFinite(aep) || aep <= 0 || aep > 1) {
			throw new Error(`INVALID_AEP at points[${idx}]: AEP must be in (0, 1] or returnPeriodYears >= 1.`);
		}
		if (!Number.isFinite(loss) || loss < 0) {
			throw new Error(`INVALID_LOSS at points[${idx}]: loss must be a non-negative finite number.`);
		}
		return {
			returnPeriodYears: rp ?? parseFloat((1 / aep).toFixed(2)),
			aep,
			loss,
		};
	});

	// Sort descending by AEP (increasing return period: e.g. 2yr -> 10yr -> 100yr -> 500yr)
	normalized.sort((a, b) => b.aep - a.aep);

	for (let i = 1; i < normalized.length; i++) {
		if (Math.abs(normalized[i].aep - normalized[i - 1].aep) < 1e-12) {
			throw new Error("DUPLICATE_AEP_POINT: Exceedance curve cannot contain duplicate AEP / return periods.");
		}
		if (normalized[i].loss < normalized[i - 1].loss) {
			throw new Error("NON_MONOTONIC_LOSS_CURVE: Losses on an exceedance curve must be non-decreasing as return period increases.");
		}
	}

	// Trapezoidal integration across AEP intervals
	let interiorEal = 0;
	for (let i = 0; i < normalized.length - 1; i++) {
		const p1 = normalized[i];
		const p2 = normalized[i + 1];
		const dAep = p1.aep - p2.aep;
		interiorEal += 0.5 * (p1.loss + p2.loss) * dAep;
	}

	const tailHandling = params.tailHandling || "flat_extrapolation"; // "truncate" | "flat_extrapolation"
	const rarest = normalized[normalized.length - 1];
	const tailEal = tailHandling === "flat_extrapolation" ? rarest.loss * rarest.aep : 0;
	const totalEal = interiorEal + tailEal;

	return {
		valid: true,
		currency: String(params.currency),
		valuationYear: Number(params.valuationYear),
		pointCount: normalized.length,
		expectedAnnualLoss: parseFloat(totalEal.toFixed(2)),
		interiorCurveEal: parseFloat(interiorEal.toFixed(2)),
		tailContributionEal: parseFloat(tailEal.toFixed(2)),
		tailHandling,
		curveSummary: normalized,
		assumptions: [
			`Trapezoidal integration across ${normalized.length} return periods (${normalized[0].returnPeriodYears}y to ${rarest.returnPeriodYears}y).`,
			tailHandling === "flat_extrapolation"
				? `Tail beyond ${rarest.returnPeriodYears}-year event assumes constant max loss (${rarest.loss}).`
				: `Events rarer than ${rarest.returnPeriodYears}-year are truncated at zero additional tail risk.`,
		],
	};
}

/**
 * Evaluate Cost-Benefit Analysis (CBA) for a disaster risk reduction / mitigation option (R-15)
 */
function evaluateMitigationCostBenefit(params = {}) {
	const baselineEal = Number(params.baselineEal);
	const mitigatedEal = Number(params.mitigatedEal);
	const capex = Number(params.capex);
	const annualOpex = Number(params.annualOpex ?? 0);
	const annualCoBenefits = Number(params.annualCoBenefits ?? 0);
	const discountRate = Number(params.discountRate);
	const horizonYears = parseInt(params.horizonYears, 10);

	if (
		!Number.isFinite(baselineEal) ||
		!Number.isFinite(mitigatedEal) ||
		!Number.isFinite(capex) ||
		!Number.isFinite(annualOpex) ||
		!Number.isFinite(discountRate) ||
		!Number.isInteger(horizonYears) ||
		horizonYears <= 0
	) {
		throw new Error(
			"MISSING_OR_INVALID_CBA_INPUTS: baselineEal, mitigatedEal, capex, discountRate, and positive integer horizonYears are required.",
		);
	}
	if (mitigatedEal > baselineEal) {
		throw new Error("INVALID_MITIGATION_CURVE: mitigatedEal cannot exceed baselineEal.");
	}
	if (!params.currency || !params.valuationYear) {
		throw new Error("MISSING_VALUATION_METADATA: currency and valuationYear are required.");
	}

	const annualAvoidedLoss = baselineEal - mitigatedEal;
	const residualRiskEal = mitigatedEal;

	function computeNpvBcr(rate, capMult = 1.0, benMult = 1.0) {
		let pvBenefits = 0;
		let pvOpex = 0;
		for (let t = 1; t <= horizonYears; t++) {
			const df = 1 / Math.pow(1 + rate, t);
			pvBenefits += (annualAvoidedLoss + annualCoBenefits) * benMult * df;
			pvOpex += annualOpex * df;
		}
		const pvTotalCost = capex * capMult + pvOpex;
		const npv = pvBenefits - pvTotalCost;
		const bcr = pvTotalCost > 0 ? pvBenefits / pvTotalCost : null;
		return { pvBenefits, pvTotalCost, npv, bcr };
	}

	const base = computeNpvBcr(discountRate, 1.0, 1.0);

	// Sensitivity matrix across discount rate +/- 3% (bounded >= 0), capex +25%, avoided loss -20%
	const lowRate = Math.max(0, discountRate - 0.03);
	const highRate = discountRate + 0.03;
	const sensitivityMatrix = {
		baseCase: { discountRate, npv: parseFloat(base.npv.toFixed(2)), bcr: parseFloat(base.bcr.toFixed(3)) },
		lowerDiscountRate: (() => {
			const s = computeNpvBcr(lowRate, 1.0, 1.0);
			return { discountRate: lowRate, npv: parseFloat(s.npv.toFixed(2)), bcr: parseFloat(s.bcr.toFixed(3)) };
		})(),
		higherDiscountRate: (() => {
			const s = computeNpvBcr(highRate, 1.0, 1.0);
			return { discountRate: highRate, npv: parseFloat(s.npv.toFixed(2)), bcr: parseFloat(s.bcr.toFixed(3)) };
		})(),
		capexOverrun25Pct: (() => {
			const s = computeNpvBcr(discountRate, 1.25, 1.0);
			return { discountRate, npv: parseFloat(s.npv.toFixed(2)), bcr: parseFloat(s.bcr.toFixed(3)) };
		})(),
		avoidedLossMinus20Pct: (() => {
			const s = computeNpvBcr(discountRate, 1.0, 0.8);
			return { discountRate, npv: parseFloat(s.npv.toFixed(2)), bcr: parseFloat(s.bcr.toFixed(3)) };
		})(),
	};

	return {
		valid: true,
		optionName: params.optionName || "DRR Mitigation Option",
		currency: params.currency,
		valuationYear: Number(params.valuationYear),
		quantitativeMetrics: {
			horizonYears,
			discountRate,
			baselineEal: parseFloat(baselineEal.toFixed(2)),
			residualRiskEal: parseFloat(residualRiskEal.toFixed(2)),
			annualAvoidedLoss: parseFloat(annualAvoidedLoss.toFixed(2)),
			riskReductionPercentage: baselineEal > 0 ? parseFloat(((annualAvoidedLoss / baselineEal) * 100).toFixed(2)) : 0,
			presentValueAvoidedLossAndCoBenefits: parseFloat(base.pvBenefits.toFixed(2)),
			presentValueTotalCosts: parseFloat(base.pvTotalCost.toFixed(2)),
			netPresentValue: parseFloat(base.npv.toFixed(2)),
			benefitCostRatio: base.bcr !== null ? parseFloat(base.bcr.toFixed(3)) : null,
			economicallyFavorableUnderBaselineAssumptions: base.npv > 0 && (base.bcr === null || base.bcr > 1),
		},
		sensitivityMatrix,
		policyJudgements: {
			equityAndDistributionalConsiderations: params.equityNotes || "Not supplied; BCR weights economic losses identically across income groups unless equity weights are documented.",
			residualRiskManagement: `Remaining residual EAL of ${residualRiskEal.toLocaleString()} ${params.currency}/yr requires preparedness, insurance, or land-use controls beyond physical protection.`,
			lifeSafetyAndNonMarketImpacts: params.nonMarketNotes || "Evaluated primarily on direct avoided physical loss; avoided mortality/morbidity and ecological values require separate multi-criteria decision analysis.",
		},
	};
}

module.exports = {
	calculateExpectedAnnualLoss,
	evaluateMitigationCostBenefit,
};
