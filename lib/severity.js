/**
 * Multi-Factor Humanitarian Rapid Impact & Severity Assessment Engine
 *
 * Aligns with OCHA / IASC Joint Intersectoral Analysis Framework (JIAF 2.0) 1-5
 * severity phases and EU JRC INFORM multi-pillar risk structure while preserving
 * strict DRR governance:
 * - Explicitly separates hazard intensity, exposure, vulnerability, coping capacity deficit, and data confidence.
 * - Never reduces humanitarian severity to hazard magnitude alone.
 * - Never coerces missing/unknown dimensions to 0 (R-02).
 * - Bridges existing spatialReport, vulnerabilityReport, and infraOverlay outputs into rapid impact summaries.
 * - Emits SHA-256 provenance & C-03 governance metadata (screening_only, draft).
 *
 * Pure Node.js standard library only.
 */

const { computeSnapshotHash } = require("./contracts");
const { getRegisteredMethod } = require("./registry");

const SEVERITY_METHOD_ID = "assessment.humanitarian.severity_v1";

const DEFAULT_PILLAR_WEIGHTS = {
	hazardIntensity: 0.25,
	exposure: 0.30,
	vulnerability: 0.25,
	copingCapacityDeficit: 0.20,
};

const SEVERITY_PHASES = [
	{ phase: 1, label: "Minimal", minScore: 0, maxScore: 2.0, description: "Minimal or no humanitarian impact; routine local capacity sufficient." },
	{ phase: 2, label: "Stress", minScore: 2.0, maxScore: 4.0, description: "Localized stress on livelihoods or services; targeted local support." },
	{ phase: 3, label: "Severe", minScore: 4.0, maxScore: 6.0, description: "Significant humanitarian needs; coordinated multi-sector assistance required." },
	{ phase: 4, label: "Extreme", minScore: 6.0, maxScore: 8.0, description: "Widespread severe disruption, displacement, and lifeline failure; urgent scale-up." },
	{ phase: 5, label: "Catastrophic", minScore: 8.0, maxScore: 10.0, description: "Catastrophic multi-sector collapse and acute life-safety emergency." },
];

function clampScore(val) {
	if (val === null || val === undefined || val === "") return null;
	const n = Number(val);
	if (!Number.isFinite(n)) return null;
	return Number(Math.max(0, Math.min(10, n)).toFixed(3));
}

/**
 * Map a normalized 0-10 severity score to JIAF/OCHA 1-5 severity phase.
 */
function classifySeverityPhase(score) {
	if (score === null || score === undefined || !Number.isFinite(Number(score))) {
		return {
			phase: null,
			label: "Indeterminate",
			description: "Insufficient multi-pillar evidence to assign a humanitarian severity phase.",
		};
	}
	const s = Math.max(0, Math.min(10, Number(score)));
	for (let i = SEVERITY_PHASES.length - 1; i >= 0; i--) {
		if (s >= SEVERITY_PHASES[i].minScore) {
			return {
				phase: SEVERITY_PHASES[i].phase,
				label: SEVERITY_PHASES[i].label,
				description: SEVERITY_PHASES[i].description,
			};
		}
	}
	return SEVERITY_PHASES[0];
}

/**
 * Derive exposure score (0-10) from explicit pillar or from population/facility counts & spatialReport.
 */
function deriveExposurePillar(input = {}) {
	if (input.exposure !== undefined && input.exposure !== null) {
		return { score: clampScore(input.exposure), source: "explicit_pillar" };
	}
	const affectedPop =
		input.affectedPopulation !== undefined && input.affectedPopulation !== null
			? Number(input.affectedPopulation)
			: input.spatialReport && input.spatialReport.summary && input.spatialReport.summary.totalExposedPopulation !== undefined
				? Number(input.spatialReport.summary.totalExposedPopulation)
				: input.spatialReport && input.spatialReport.totalExposedPopulation !== undefined
					? Number(input.spatialReport.totalExposedPopulation)
					: null;
	const totalPop =
		input.totalPopulation !== undefined && input.totalPopulation !== null ? Number(input.totalPopulation) : null;

	const exposedFacilities =
		input.exposedFacilities !== undefined && input.exposedFacilities !== null
			? Number(input.exposedFacilities)
			: input.spatialReport && input.spatialReport.summary && input.spatialReport.summary.totalExposedAssets !== undefined
				? Number(input.spatialReport.summary.totalExposedAssets)
				: input.spatialReport && input.spatialReport.exposedCount !== undefined
					? Number(input.spatialReport.exposedCount)
					: input.infraOverlay && input.infraOverlay.summary && input.infraOverlay.summary.physicallyExposedCount !== undefined
						? Number(input.infraOverlay.summary.physicallyExposedCount)
						: input.infraOverlay && input.infraOverlay.summary && input.infraOverlay.summary.exposedFacilities !== undefined
							? Number(input.infraOverlay.summary.exposedFacilities)
							: null;

	if (affectedPop !== null && Number.isFinite(affectedPop) && totalPop !== null && Number.isFinite(totalPop) && totalPop > 0) {
		const share = Math.max(0, Math.min(1, affectedPop / totalPop));
		// Log-scaled share: 50%+ exposed -> ~10, 10% -> ~6.5, 1% -> ~3.0
		const score = clampScore(Math.min(10, Math.sqrt(share) * 14));
		return { score, source: "derived_population_share" };
	}
	if (affectedPop !== null && Number.isFinite(affectedPop) && affectedPop >= 0) {
		// Log10 scale for absolute exposed population (100 -> 4, 10k -> 8, 100k+ -> 10)
		const score = affectedPop === 0 ? 0 : clampScore(Math.min(10, Math.log10(affectedPop + 1) * 2));
		return { score, source: "derived_absolute_population" };
	}
	if (exposedFacilities !== null && Number.isFinite(exposedFacilities) && exposedFacilities >= 0) {
		const score = exposedFacilities === 0 ? 0 : clampScore(Math.min(10, Math.log10(exposedFacilities + 1) * 4.5));
		return { score, source: "derived_exposed_facilities" };
	}
	return { score: null, source: "missing" };
}

/**
 * Derive vulnerability score (0-10) from explicit pillar or vulnerabilityReport MDR.
 */
function deriveVulnerabilityPillar(input = {}) {
	if (input.vulnerability !== undefined && input.vulnerability !== null) {
		return { score: clampScore(input.vulnerability), source: "explicit_pillar" };
	}
	if (input.vulnerabilityReport) {
		const mdr =
			input.vulnerabilityReport.averageMeanDamageRatio !== undefined
				? Number(input.vulnerabilityReport.averageMeanDamageRatio)
				: input.vulnerabilityReport.meanDamageRatio !== undefined
					? Number(input.vulnerabilityReport.meanDamageRatio)
					: null;
		if (mdr !== null && Number.isFinite(mdr)) {
			return { score: clampScore(mdr * 10), source: "derived_vulnerability_report_mdr" };
		}
	}
	return { score: null, source: "missing" };
}

/**
 * Derive lack-of-coping-capacity score (0-10) from explicit pillar or infraOverlay cascade ratio.
 */
function deriveCopingDeficitPillar(input = {}) {
	if (input.copingCapacityDeficit !== undefined && input.copingCapacityDeficit !== null) {
		return { score: clampScore(input.copingCapacityDeficit), source: "explicit_pillar" };
	}
	if (input.copingCapacity !== undefined && input.copingCapacity !== null) {
		const cap = clampScore(input.copingCapacity);
		return { score: cap !== null ? clampScore(10 - cap) : null, source: "inverted_coping_capacity" };
	}
	if (input.infraOverlay && input.infraOverlay.summary) {
		const total = Number(input.infraOverlay.summary.totalFacilities || 0);
		const exposed = Number(
			input.infraOverlay.summary.physicallyExposedCount ?? input.infraOverlay.summary.exposedFacilities ?? 0,
		);
		const disrupted = exposed + Number(input.infraOverlay.summary.cascadingServiceRiskCount || 0);
		if (total > 0) {
			return { score: clampScore(Math.min(10, (disrupted / total) * 10)), source: "derived_infra_lifeline_disruption" };
		}
	}
	return { score: null, source: "missing" };
}

/**
 * Evaluate a single humanitarian severity & rapid impact assessment.
 */
function evaluateSingleSeverity(input = {}, weights = DEFAULT_PILLAR_WEIGHTS) {
	const hazardScore = clampScore(input.hazardIntensity);
	const exposureDerived = deriveExposurePillar(input);
	const vulnerabilityDerived = deriveVulnerabilityPillar(input);
	const copingDerived = deriveCopingDeficitPillar(input);

	const pillars = {
		hazardIntensity: { score: hazardScore, source: hazardScore !== null ? "explicit_pillar" : "missing" },
		exposure: exposureDerived,
		vulnerability: vulnerabilityDerived,
		copingCapacityDeficit: copingDerived,
	};

	const availableKeys = Object.keys(pillars).filter((k) => pillars[k].score !== null);
	const missingDimensions = Object.keys(pillars).filter((k) => pillars[k].score === null);

	const warnings = [];
	const nonHazardAvailable = availableKeys.filter((k) => k !== "hazardIntensity");
	const hazardOnly = availableKeys.length === 1 && availableKeys[0] === "hazardIntensity";

	let dataConfidence = "insufficient";
	if (availableKeys.length === 4) dataConfidence = "high";
	else if (availableKeys.length === 3) dataConfidence = "medium";
	else if (availableKeys.length === 2 && nonHazardAvailable.length >= 1) dataConfidence = "low";
	else dataConfidence = "insufficient";

	let compositeScore = null;
	if (hazardOnly) {
		warnings.push(
			"Severity MUST NOT be reduced to hazard magnitude alone: supply at least exposure, vulnerability, or copingCapacityDeficit.",
		);
	} else if (availableKeys.length === 0) {
		warnings.push("No valid severity pillars provided; all dimensions are missing.");
	} else {
		let weightedSum = 0;
		let totalWeight = 0;
		for (const key of availableKeys) {
			const w = Number(weights[key]) > 0 ? Number(weights[key]) : DEFAULT_PILLAR_WEIGHTS[key];
			weightedSum += pillars[key].score * w;
			totalWeight += w;
		}
		compositeScore = totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(3)) : null;
	}

	if (missingDimensions.length > 0) {
		warnings.push(
			`Missing pillar(s): ${missingDimensions.join(", ")} (preserved as unknown, never coerced to 0; dataConfidence='${dataConfidence}').`,
		);
	}

	const classification = classifySeverityPhase(compositeScore);

	// Assemble Rapid Impact Summary from provided or upstream reports
	const affectedPopulation =
		input.affectedPopulation !== undefined && input.affectedPopulation !== null
			? Number(input.affectedPopulation)
			: input.spatialReport && input.spatialReport.totalExposedPopulation !== undefined
				? Number(input.spatialReport.totalExposedPopulation)
				: null;

	const exposedFacilities =
		input.exposedFacilities !== undefined && input.exposedFacilities !== null
			? Number(input.exposedFacilities)
			: input.infraOverlay && input.infraOverlay.summary
				? input.infraOverlay.summary.exposedFacilities
				: input.spatialReport && input.spatialReport.exposedCount !== undefined
					? input.spatialReport.exposedCount
					: null;

	const cascadingServiceRiskCount =
		input.infraOverlay && input.infraOverlay.summary
			? input.infraOverlay.summary.cascadingServiceRiskCount
			: null;

	const estimatedDirectLossUsd =
		input.vulnerabilityReport && input.vulnerabilityReport.totalEstimatedEconomicLossUSD !== undefined
			? input.vulnerabilityReport.totalEstimatedEconomicLossUSD
			: null;

	const missingDataList = [...missingDimensions];
	if (affectedPopulation === null) missingDataList.push("affectedPopulation");
	if (exposedFacilities === null) missingDataList.push("exposedFacilities");

	return {
		pcode: input.pcode || null,
		unitName: input.unitName || input.name || null,
		hazardType: input.hazardType || null,
		pillars,
		compositeScore,
		severityPhase: classification.phase,
		severityLabel: classification.label,
		severityDescription: classification.description,
		dataConfidence,
		hazardOnlyBlocked: hazardOnly,
		missingDimensions,
		rapidImpactSummary: {
			affectedPopulation,
			exposedFacilities,
			cascadingServiceRiskCount,
			estimatedDirectLossUsd,
			missingDataList,
		},
		warnings,
	};
}

/**
 * Evaluate Humanitarian Rapid Impact & Severity Assessment (single area or ranked admin units).
 */
function evaluateHumanitarianSeverity(input = {}) {
	if (!input || typeof input !== "object") {
		throw new Error("evaluateHumanitarianSeverity requires an input object.");
	}
	const method = getRegisteredMethod(SEVERITY_METHOD_ID);
	const weights = { ...DEFAULT_PILLAR_WEIGHTS, ...(input.weights || {}) };

	let result;
	if (Array.isArray(input.units) && input.units.length > 0) {
		const assessedUnits = input.units.map((u) => evaluateSingleSeverity(u, weights));
		const rankedUnits = [...assessedUnits].sort((a, b) => {
			const sa = a.compositeScore === null ? -1 : a.compositeScore;
			const sb = b.compositeScore === null ? -1 : b.compositeScore;
			return sb - sa;
		});
		const validScores = rankedUnits.map((u) => u.compositeScore).filter((s) => s !== null);
		const peakUnit = rankedUnits.find((u) => u.compositeScore !== null) || null;
		const avgScore =
			validScores.length > 0
				? Number((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(3))
				: null;

		result = {
			mode: "multi_unit_ranking",
			unitCount: rankedUnits.length,
			peakSeverityPhase: peakUnit ? peakUnit.severityPhase : null,
			peakSeverityLabel: peakUnit ? peakUnit.severityLabel : "Indeterminate",
			peakUnitPcode: peakUnit ? peakUnit.pcode : null,
			meanCompositeScore: avgScore,
			priorityRanking: rankedUnits,
			warnings: rankedUnits.flatMap((u) => u.warnings),
		};
	} else {
		result = {
			mode: "single_assessment",
			...evaluateSingleSeverity(input, weights),
		};
	}

	const snapshotHash = computeSnapshotHash({
		mode: result.mode,
		compositeScore: result.compositeScore ?? result.meanCompositeScore,
		severityPhase: result.severityPhase ?? result.peakSeverityPhase,
		missingDimensions: result.missingDimensions || [],
	});

	return {
		method: method
			? { id: method.id, version: method.version, productionStatus: method.productionStatus }
			: { id: SEVERITY_METHOD_ID, version: "1.0", productionStatus: "illustrative_baseline" },
		weightsUsed: weights,
		...result,
		provenance: {
			assessedAt: new Date().toISOString(),
			snapshotHash,
			evidenceBasis: "modelled",
			verificationStatus: "unverified",
			approvalStatus: "draft",
			reportingEligibility: "screening_only",
		},
	};
}

module.exports = {
	SEVERITY_METHOD_ID,
	DEFAULT_PILLAR_WEIGHTS,
	SEVERITY_PHASES,
	classifySeverityPhase,
	evaluateHumanitarianSeverity,
};
