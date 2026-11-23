const assert = require("assert");
const { classifySeverityPhase, evaluateHumanitarianSeverity } = require("../lib/severity");

console.log("Testing Multi-Factor Humanitarian Rapid Impact & Severity Assessment...");

// 1. Phase classification boundaries
assert.strictEqual(classifySeverityPhase(1.2).phase, 1);
assert.strictEqual(classifySeverityPhase(2.5).phase, 2);
assert.strictEqual(classifySeverityPhase(4.8).phase, 3);
assert.strictEqual(classifySeverityPhase(6.9).phase, 4);
assert.strictEqual(classifySeverityPhase(8.7).phase, 5);
assert.strictEqual(classifySeverityPhase(null).phase, null);

// 2. Full 4-pillar assessment (high confidence)
const full = evaluateHumanitarianSeverity({
	pcode: "TH9001",
	unitName: "Hat Yai",
	hazardType: "flood",
	hazardIntensity: 7.5,
	affectedPopulation: 42000,
	totalPopulation: 160000,
	vulnerability: 6.2,
	copingCapacityDeficit: 5.8,
	exposedFacilities: 14,
});
assert.strictEqual(full.mode, "single_assessment");
assert.strictEqual(full.dataConfidence, "high");
assert.strictEqual(full.hazardOnlyBlocked, false);
assert.strictEqual(full.missingDimensions.length, 0);
assert(full.severityPhase >= 3 && full.severityPhase <= 5);
assert.strictEqual(full.rapidImpactSummary.affectedPopulation, 42000);
assert.strictEqual(full.provenance.approvalStatus, "draft");
assert.strictEqual(full.provenance.reportingEligibility, "screening_only");

// 3. Hazard-only MUST be blocked (never reduce severity to hazard magnitude alone)
const hazardOnly = evaluateHumanitarianSeverity({
	hazardType: "earthquake",
	hazardIntensity: 9.0,
});
assert.strictEqual(hazardOnly.hazardOnlyBlocked, true);
assert.strictEqual(hazardOnly.compositeScore, null);
assert.strictEqual(hazardOnly.severityPhase, null);
assert.strictEqual(hazardOnly.dataConfidence, "insufficient");
assert.strictEqual(hazardOnly.missingDimensions.length, 3);

// 4. Partial pillars: missing pillars preserved (never coerced to 0) and confidence downgraded
const partial = evaluateHumanitarianSeverity({
	hazardIntensity: 8.0,
	exposure: 8.0,
});
assert.strictEqual(partial.hazardOnlyBlocked, false);
assert.strictEqual(partial.compositeScore, 8.0, "Missing pillars must not drag score down by coercing to 0");
assert.strictEqual(partial.dataConfidence, "low");
assert.deepStrictEqual(partial.missingDimensions, ["vulnerability", "copingCapacityDeficit"]);

// 5. Upstream integration (spatialReport, vulnerabilityReport, infraOverlay)
const integrated = evaluateHumanitarianSeverity({
	hazardIntensity: 6.5,
	spatialReport: { exposedCount: 5, totalExposedPopulation: 12000 },
	vulnerabilityReport: { averageMeanDamageRatio: 0.48, totalEstimatedEconomicLossUSD: 5400000 },
	infraOverlay: { summary: { totalFacilities: 10, exposedFacilities: 3, cascadingServiceRiskCount: 2 } },
});
assert.strictEqual(integrated.dataConfidence, "high");
assert.strictEqual(integrated.pillars.vulnerability.source, "derived_vulnerability_report_mdr");
assert.strictEqual(integrated.pillars.copingCapacityDeficit.source, "derived_infra_lifeline_disruption");
assert.strictEqual(integrated.rapidImpactSummary.estimatedDirectLossUsd, 5400000);
assert.strictEqual(integrated.rapidImpactSummary.cascadingServiceRiskCount, 2);

// 6. Multi-unit ADM2 priority ranking
const ranked = evaluateHumanitarianSeverity({
	units: [
		{ pcode: "TH9002", unitName: "Sadao", hazardIntensity: 3.0, exposure: 2.5, vulnerability: 3.0, copingCapacityDeficit: 2.0 },
		{ pcode: "TH9001", unitName: "Hat Yai", hazardIntensity: 8.0, exposure: 8.5, vulnerability: 7.0, copingCapacityDeficit: 6.5 },
	],
});
assert.strictEqual(ranked.mode, "multi_unit_ranking");
assert.strictEqual(ranked.unitCount, 2);
assert.strictEqual(ranked.peakUnitPcode, "TH9001");
assert.strictEqual(ranked.priorityRanking[0].pcode, "TH9001");
assert.strictEqual(ranked.priorityRanking[1].pcode, "TH9002");

console.log("✅ Multi-Factor Humanitarian Rapid Impact & Severity tests passed!");
