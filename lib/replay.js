/**
 * Deterministic Replay Validation & Regression Harness (R-05)
 *
 * Replays frozen inputs and verifies mathematical invariants, unit conversions,
 * missing-data semantics, model registry applicability, CAP XML structure,
 * and Sendai semantic rules.
 *
 * Clearly distinguishes synthetic_reference cases from historical hindcast_benchmark cases.
 */

const fs = require("fs");
const path = require("path");
const { lognormalCdf, normalCdf, haversineDistance } = require("./utils");
const {
	evaluateSeismicFragility,
	evaluateFloodDamage,
	evaluateWindDamage,
} = require("./fragility");
const { estimatePgaFromMmiDetailed } = require("./usgs");
const { evaluateVulnerabilityMatrix } = require("./vulnerability");
const { validateInputContract, computeSnapshotHash } = require("./contracts");
const { generateCapXml, validateCapXml } = require("./cap");
const { validateSendaiSubmission } = require("./sendai");
const { spatialExposureJoin } = require("./spatial");

function approxEqual(actual, expected, tolerance = 1e-4) {
	return Math.abs(actual - expected) <= tolerance;
}

/**
 * Run frozen-input reference validation suite
 * @param {object} options - { suite?: "all"|"synthetic_reference"|"hindcast_benchmark" }
 * @returns {object} Verification summary
 */
function runReplayValidation(options = {}) {
	const suiteFilter = options.suite || "all";
	const cases = [];

	function addCase(id, kind, fn) {
		if (suiteFilter !== "all" && kind !== suiteFilter) return;
		const start = Date.now();
		try {
			const details = fn();
			cases.push({
				id,
				classification: kind,
				passed: true,
				durationMs: Date.now() - start,
				details,
			});
		} catch (err) {
			cases.push({
				id,
				classification: kind,
				passed: false,
				durationMs: Date.now() - start,
				error: err.message,
			});
		}
	}

	// 1. Synthetic Reference: Normal & Lognormal CDF invariants
	addCase("ref_math_cdf_invariants", "synthetic_reference", () => {
		const n0 = normalCdf(0);
		const l1 = lognormalCdf(0.4, 0.4, 0.65);
		const lZero = lognormalCdf(0, 0.4, 0.65);
		if (!approxEqual(n0, 0.5, 1e-6)) throw new Error(`normalCdf(0) expected 0.5, got ${n0}`);
		if (!approxEqual(l1, 0.5, 1e-6)) throw new Error(`lognormalCdf(median, median, beta) expected 0.5, got ${l1}`);
		if (lZero !== 0) throw new Error(`lognormalCdf(0) expected 0, got ${lZero}`);
		const dist = haversineDistance(0, 0, 0, 1);
		if (!approxEqual(dist, 111.195, 0.5)) throw new Error(`haversine(1 deg eq) expected ~111.2km, got ${dist}`);
		return { normalCdf0: n0, lognormalCdfMedian: l1, equatorial1DegKm: parseFloat(dist.toFixed(3)) };
	});

	// 2. Synthetic Reference: Zero-intensity invariant & probability ordering
	addCase("ref_fragility_zero_and_ordering", "synthetic_reference", () => {
		const seisZero = evaluateSeismicFragility("URM", 0);
		if (seisZero.meanDamageRatio !== 0 || seisZero.discreteProbabilities.none !== 1) {
			throw new Error("Zero intensity seismic fragility must produce MDR=0 and none=1");
		}
		const seisMod = evaluateSeismicFragility("URM", 0.35);
		const probs = seisMod.exceedanceProbabilities;
		if (!(probs.slight >= probs.moderate && probs.moderate >= probs.extensive && probs.extensive >= probs.complete)) {
			throw new Error("Seismic exceedance probabilities must be monotonically non-increasing across damage states");
		}
		const sumDiscrete = Object.values(seisMod.discreteProbabilities).reduce((a, b) => a + b, 0);
		if (!approxEqual(sumDiscrete, 1.0, 1e-3)) {
			throw new Error(`Discrete damage state probabilities must sum to 1.0, got ${sumDiscrete}`);
		}
		const res2 = evaluateFloodDamage(1.5, "residential_2story");
		const comm = evaluateFloodDamage(1.5, "commercial");
		if (res2.structuralDamageRatio === comm.structuralDamageRatio) {
			throw new Error("residential_2story flood curve must remain distinct from commercial curve");
		}
		const windLow = evaluateWindDamage(50);
		if (windLow.meanDamageRatio !== 0) throw new Error("Sub-threshold wind speed must produce MDR=0");
		return { seismicZeroMdr: 0, seismic035Mdr: seisMod.meanDamageRatio, res2Mdr: res2.combinedMeanDamageRatio };
	});

	// 3. Synthetic Reference: Unit conversions & mismatch rejection
	addCase("ref_unit_conversions_and_rejection", "synthetic_reference", () => {
		const pgaMs2 = evaluateSeismicFragility("URM", 9.80665, { unit: "m/s2" });
		const pgaG = evaluateSeismicFragility("URM", 1.0, { unit: "g" });
		if (!approxEqual(pgaMs2.meanDamageRatio, pgaG.meanDamageRatio, 1e-4)) {
			throw new Error("1 g and 9.80665 m/s2 must produce identical fragility results");
		}
		const depthFt = evaluateFloodDamage(10, "residential_1story", { unit: "ft" });
		const depthM = evaluateFloodDamage(3.048, "residential_1story", { unit: "m" });
		if (!approxEqual(depthFt.combinedMeanDamageRatio, depthM.combinedMeanDamageRatio, 1e-3)) {
			throw new Error("10 ft and 3.048 m must produce identical flood damage ratios");
		}
		const mismatch = validateInputContract({ hazardType: "flood", intensity: 200, intensityUnit: "mm" });
		if (mismatch.valid || !mismatch.errors.some((e) => e.code === "UNIT_MISMATCH")) {
			throw new Error("Precipitation 'mm' passed as flood depth must be rejected with UNIT_MISMATCH");
		}
		return { unitConversionConsistent: true, mismatchRejected: true };
	});

	// 4. Synthetic Reference: Wald99 GMICE bounds & extrapolation flagging
	addCase("ref_wald99_gmice_bounds", "synthetic_reference", () => {
		const inBounds = estimatePgaFromMmiDetailed(6.5);
		if (inBounds.extrapolated !== false || inBounds.classification !== "GMICE") {
			throw new Error("MMI 6.5 must be classified as non-extrapolated GMICE");
		}
		const tooHigh = estimatePgaFromMmiDetailed(9.5);
		if (tooHigh.extrapolated !== true) {
			throw new Error("MMI 9.5 must be flagged as extrapolated beyond Wald99 MMI V-VIII range");
		}
		return { inBoundsPga: inBounds.pgaG, highExtrapolated: tooHigh.extrapolated };
	});

	// 5. Synthetic Reference: Missing data semantics (unknown !== 0)
	addCase("ref_missing_data_unknown_vs_zero", "synthetic_reference", () => {
		const report = evaluateVulnerabilityMatrix(
			{
				exposedAssets: [
					{ id: "a1", name: "Unknown Clinic", category: "healthcare", properties: { valueUsd: null, population: null } },
				],
			},
			{ type: "earthquake", intensity: 0.3 },
		);
		if (report.status !== "incomplete") throw new Error(`Expected 'incomplete' status, got ${report.status}`);
		if (report.topDamagedAssets[0].estimatedEconomicLossUsd !== null) {
			throw new Error("Unknown asset value must remain null, not 0");
		}
		if (report.topDamagedAssets[0].estimatedDisplacedPopulation !== null) {
			throw new Error("Unknown asset population must remain null, not 0");
		}
		return { status: report.status, snapshotHash: report.provenance.inputs.snapshotHash };
	});

	// 6. Synthetic Reference: CAP XML & Sendai Semantic Separation
	addCase("ref_cap_and_sendai_semantics", "synthetic_reference", () => {
		const capXml = generateCapXml({
			identifier: "REPLAY-TEST-001",
			sender: "replay@test.org",
			status: "Draft",
			msgType: "Alert",
			info: { category: "Geo", event: "Replay Test", urgency: "Immediate", severity: "Severe", certainty: "Observed" },
		});
		const capVal = validateCapXml(capXml);
		if (!capVal.isValid) throw new Error(`CAP replay validation failed: ${capVal.errors.join("; ")}`);

		const sendaiBad = validateSendaiSubmission({
			targetB: { estimatedDisplacedPopulation: 1000, b1DirectlyAffected: 1000, b1DerivedFromDisplacementOnly: true },
			targetD: { conflateDamageAndDisruption: true },
		});
		if (sendaiBad.valid || sendaiBad.reportingEligibility !== "ineligible") {
			throw new Error("Sendai validator must reject displacement-to-B1 conflation and damage/disruption conflation");
		}
		return { capValid: true, sendaiConflictDetected: true };
	});

	// 7. Historical Hindcast Benchmark: Southern Thailand Flood Scenario (if fixture exists)
	addCase("hindcast_thailand_flood_2017", "hindcast_benchmark", () => {
		const scenarioDir = path.join(__dirname, "../examples/thailand-flood-scenario");
		const hazardGeoJson = JSON.parse(fs.readFileSync(path.join(scenarioDir, "input-hazard.json"), "utf8"));
		const exposureGeoJson = JSON.parse(fs.readFileSync(path.join(scenarioDir, "input-exposure.json"), "utf8"));
		const spatial = spatialExposureJoin(hazardGeoJson, exposureGeoJson);
		const vuln = evaluateVulnerabilityMatrix(spatial, { type: "flood", intensity: 2.2 });
		const targetB = vuln.sendaiFrameworkMetrics.targetB_AffectedPeople;
		const targetC = vuln.sendaiFrameworkMetrics.targetC_DirectEconomicLoss;
		const targetD = vuln.sendaiFrameworkMetrics.targetD_CriticalInfrastructure;
		if (targetB.totalExposedPopulation !== 18610) throw new Error(`Expected 18610 exposed, got ${targetB.totalExposedPopulation}`);
		if (targetB.estimatedDisplacedPopulation !== 16749) throw new Error(`Expected 16749 displaced, got ${targetB.estimatedDisplacedPopulation}`);
		if (targetC.estimatedDirectEconomicLossUsd !== 127025600) throw new Error(`Expected 127025600 USD loss, got ${targetC.estimatedDirectEconomicLossUsd}`);
		if (targetD.totalDamagedFacilities !== 7) throw new Error(`Expected 7 damaged facilities, got ${targetD.totalDamagedFacilities}`);
		return {
			exposedPopulation: targetB.totalExposedPopulation,
			estimatedDisplacedPopulation: targetB.estimatedDisplacedPopulation,
			estimatedDirectEconomicLossUsd: targetC.estimatedDirectEconomicLossUsd,
			damagedFacilities: targetD.totalDamagedFacilities,
			snapshotHash: computeSnapshotHash({ hazardGeoJson, exposureGeoJson, depthM: 2.2 }),
		};
	});

	const passedCount = cases.filter((c) => c.passed).length;
	const failedCount = cases.length - passedCount;

	return {
		valid: failedCount === 0,
		suiteFilter,
		totalCases: cases.length,
		passedCount,
		failedCount,
		cases,
	};
}

module.exports = {
	runReplayValidation,
};
