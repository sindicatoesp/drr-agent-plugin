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
	SEISMIC_FRAGILITY_PARAMS,
	DAMAGE_RATIO_WEIGHTS,
} = require("./fragility");
const { estimatePgaFromMmiDetailed } = require("./usgs");
const { evaluateVulnerabilityMatrix } = require("./vulnerability");
const { validateInputContract, computeSnapshotHash } = require("./contracts");
const { generateCapXml, validateCapXml } = require("./cap");
const { validateSendaiSubmission } = require("./sendai");
const { spatialExposureJoin, computeRasterZonalStats } = require("./spatial");
const { calculateExpectedAnnualLoss, evaluateMitigationCostBenefit } = require("./appraisal");
const { propagateUncertainty } = require("./uncertainty");
const { analyzeFloodRisk } = require("./openmeteo");
const { overlayCriticalInfraOnHazard } = require("./infra-overlay");
const { evaluateHumanitarianSeverity } = require("./severity");

function approxEqual(actual, expected, tolerance = 1e-4) {
	return Math.abs(actual - expected) <= tolerance;
}

/**
 * Run frozen-input reference, model verification (L2), and historical hindcast (L3) validation suite
 * @param {object} options - { suite?: "all"|"synthetic_reference"|"reference_model"|"hindcast_benchmark" }
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

	// =========================================================================
	// L0 / L1: Synthetic Reference Invariants
	// =========================================================================

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

	// =========================================================================
	// L2: Reference Model Verification (Golden Analytical & Standards Checks)
	// =========================================================================

	// 7. L2 Reference Model: Wald et al. (1999) GMICE Table Verification
	addCase("l2_wald99_reference_table", "reference_model", () => {
		// Exact analytical Wald et al. (1999) branch points:
		// MMI < 5:  log10(PGA_cm/s2) = (MMI + 0.22) / 2.20
		// MMI >= 5: log10(PGA_cm/s2) = (MMI + 1.66) / 3.66
		const tablePoints = [
			{ mmi: 4.0, expectedPgaG: Math.pow(10, (4.0 + 0.22) / 2.2) / 980.665, expectedExtrapolated: true },
			{ mmi: 5.0, expectedPgaG: Math.pow(10, (5.0 + 1.66) / 3.66) / 980.665, expectedExtrapolated: false },
			{ mmi: 6.0, expectedPgaG: Math.pow(10, (6.0 + 1.66) / 3.66) / 980.665, expectedExtrapolated: false },
			{ mmi: 7.0, expectedPgaG: Math.pow(10, (7.0 + 1.66) / 3.66) / 980.665, expectedExtrapolated: false },
			{ mmi: 8.0, expectedPgaG: Math.pow(10, (8.0 + 1.66) / 3.66) / 980.665, expectedExtrapolated: false },
			{ mmi: 9.0, expectedPgaG: Math.pow(10, (9.0 + 1.66) / 3.66) / 980.665, expectedExtrapolated: true },
		];

		let maxAbsErrorG = 0;
		for (const pt of tablePoints) {
			const res = estimatePgaFromMmiDetailed(pt.mmi);
			if (!res.valid) throw new Error(`Wald99 failed for MMI ${pt.mmi}`);
			const absErr = Math.abs(res.pgaG - pt.expectedPgaG);
			if (absErr > maxAbsErrorG) maxAbsErrorG = absErr;
			if (!approxEqual(res.pgaG, pt.expectedPgaG, 5e-4)) {
				throw new Error(`Wald99 MMI ${pt.mmi}: expected ${pt.expectedPgaG.toFixed(4)}g, got ${res.pgaG}g`);
			}
			if (res.extrapolated !== pt.expectedExtrapolated) {
				throw new Error(`Wald99 MMI ${pt.mmi}: expected extrapolated=${pt.expectedExtrapolated}, got ${res.extrapolated}`);
			}
		}

		return {
			pointsVerified: tablePoints.length,
			maxAbsErrorG: parseFloat(maxAbsErrorG.toFixed(6)),
		};
	});

	// 8. L2 Reference Model: Lognormal Fragility & HAZUS Central Damage Factor Closed-Form Check
	addCase("l2_fragility_lognormal_closed_form", "reference_model", () => {
		const taxonomies = Object.keys(SEISMIC_FRAGILITY_PARAMS);
		const PHI_PLUS_1 = 0.841344746;
		const PHI_MINUS_1 = 0.158655254;
		let maxProbError = 0;
		let maxMdrError = 0;

		for (const tax of taxonomies) {
			const p = SEISMIC_FRAGILITY_PARAMS[tax];
			// At IM = theta_moderate, P(DS >= moderate) must equal Phi(0) = 0.5000
			const atMedian = evaluateSeismicFragility(tax, p.moderate.theta);
			const err0 = Math.abs(atMedian.exceedanceProbabilities.moderate - 0.5);
			if (err0 > maxProbError) maxProbError = err0;
			if (!approxEqual(atMedian.exceedanceProbabilities.moderate, 0.5, 1e-3)) {
				throw new Error(`${tax} at theta_moderate: expected P(moderate)=0.5, got ${atMedian.exceedanceProbabilities.moderate}`);
			}

			// At IM = theta_moderate * exp(+beta_moderate), P(DS >= moderate) = Phi(+1) ~= 0.8413
			const atPlus1 = evaluateSeismicFragility(tax, p.moderate.theta * Math.exp(p.moderate.beta));
			const errP1 = Math.abs(atPlus1.exceedanceProbabilities.moderate - PHI_PLUS_1);
			if (errP1 > maxProbError) maxProbError = errP1;
			if (!approxEqual(atPlus1.exceedanceProbabilities.moderate, PHI_PLUS_1, 1e-3)) {
				throw new Error(`${tax} at +1 sigma: expected ${PHI_PLUS_1.toFixed(4)}, got ${atPlus1.exceedanceProbabilities.moderate}`);
			}

			// At IM = theta_moderate * exp(-beta_moderate), P(DS >= moderate) = Phi(-1) ~= 0.1587
			const atMinus1 = evaluateSeismicFragility(tax, p.moderate.theta * Math.exp(-p.moderate.beta));
			const errM1 = Math.abs(atMinus1.exceedanceProbabilities.moderate - PHI_MINUS_1);
			if (errM1 > maxProbError) maxProbError = errM1;
			if (!approxEqual(atMinus1.exceedanceProbabilities.moderate, PHI_MINUS_1, 1e-3)) {
				throw new Error(`${tax} at -1 sigma: expected ${PHI_MINUS_1.toFixed(4)}, got ${atMinus1.exceedanceProbabilities.moderate}`);
			}

			// Verify MDR matches exact HAZUS central damage factor weighted sum
			const d = atMedian.discreteProbabilities;
			const expectedMdr =
				d.none * DAMAGE_RATIO_WEIGHTS.none +
				d.slight * DAMAGE_RATIO_WEIGHTS.slight +
				d.moderate * DAMAGE_RATIO_WEIGHTS.moderate +
				d.extensive * DAMAGE_RATIO_WEIGHTS.extensive +
				d.complete * DAMAGE_RATIO_WEIGHTS.complete;
			const mdrErr = Math.abs(atMedian.meanDamageRatio - expectedMdr);
			if (mdrErr > maxMdrError) maxMdrError = mdrErr;
			if (!approxEqual(atMedian.meanDamageRatio, expectedMdr, 1e-3)) {
				throw new Error(`${tax} MDR mismatch: expected ${expectedMdr.toFixed(4)}, got ${atMedian.meanDamageRatio}`);
			}
		}

		// Verify seismic code vulnerability ordering at 0.40g: URM > C1_PRE_CODE > C1_MODERATE_CODE > C2
		const mdrUrm = evaluateSeismicFragility("URM", 0.40).meanDamageRatio;
		const mdrPre = evaluateSeismicFragility("C1_PRE_CODE", 0.40).meanDamageRatio;
		const mdrMod = evaluateSeismicFragility("C1_MODERATE_CODE", 0.40).meanDamageRatio;
		const mdrC2 = evaluateSeismicFragility("C2", 0.40).meanDamageRatio;
		if (!(mdrUrm > mdrPre && mdrPre > mdrMod && mdrMod > mdrC2)) {
			throw new Error(`Expected seismic vulnerability ordering URM(${mdrUrm}) > C1_PRE(${mdrPre}) > C1_MOD(${mdrMod}) > C2(${mdrC2})`);
		}

		return {
			taxonomiesVerified: taxonomies.length,
			maxProbError: parseFloat(maxProbError.toFixed(6)),
			maxMdrError: parseFloat(maxMdrError.toFixed(6)),
			codeOrderingAt040g: { URM: mdrUrm, C1_PRE_CODE: mdrPre, C1_MODERATE_CODE: mdrMod, C2: mdrC2 },
		};
	});

	// 9. L2 Reference Model: Trapezoidal AEP Expected Annual Loss & CBA Analytical Verification
	addCase("l2_appraisal_eal_analytical_integral", "reference_model", () => {
		// Exact closed-form trapezoidal integral for 3 points:
		// RP=10 (AEP=0.10, L=100,000), RP=50 (AEP=0.02, L=500,000), RP=200 (AEP=0.005, L=1,000,000)
		// Interval 1: 0.5*(100k+500k)*(0.10-0.02) = 300k * 0.08 = 24,000
		// Interval 2: 0.5*(500k+1000k)*(0.02-0.005) = 750k * 0.015 = 11,250
		// Interior EAL = 35,250; Flat tail = 1,000,000 * 0.005 = 5,000; Total flat = 40,250
		const curve = [
			{ returnPeriodYears: 10, loss: 100000 },
			{ returnPeriodYears: 50, loss: 500000 },
			{ returnPeriodYears: 200, loss: 1000000 },
		];
		const flatRes = calculateExpectedAnnualLoss({
			points: curve,
			currency: "USD",
			valuationYear: 2026,
			tailHandling: "flat_extrapolation",
		});
		const truncRes = calculateExpectedAnnualLoss({
			points: curve,
			currency: "USD",
			valuationYear: 2026,
			tailHandling: "truncate",
		});
		if (!approxEqual(flatRes.expectedAnnualLoss, 40250, 0.01)) {
			throw new Error(`Expected flat EAL=40250, got ${flatRes.expectedAnnualLoss}`);
		}
		if (!approxEqual(truncRes.expectedAnnualLoss, 35250, 0.01)) {
			throw new Error(`Expected truncated EAL=35250, got ${truncRes.expectedAnnualLoss}`);
		}

		// Verify CBA present-value annuity factor at r=5%, n=10yr: (1 - 1.05^-10)/0.05 = 7.72173493
		const pvFactor = (1 - Math.pow(1.05, -10)) / 0.05;
		const cba = evaluateMitigationCostBenefit({
			baselineEal: 40250,
			mitigatedEal: 10250,
			capex: 150000,
			annualOpex: 2000,
			discountRate: 0.05,
			horizonYears: 10,
			currency: "USD",
			valuationYear: 2026,
		});
		const expectedPvBenefits = 30000 * pvFactor;
		const expectedPvCosts = 150000 + 2000 * pvFactor;
		const expectedNpv = expectedPvBenefits - expectedPvCosts;
		if (!approxEqual(cba.quantitativeMetrics.netPresentValue, expectedNpv, 1.0)) {
			throw new Error(`CBA NPV mismatch: expected ${expectedNpv.toFixed(2)}, got ${cba.quantitativeMetrics.netPresentValue}`);
		}

		return {
			flatEalUsd: flatRes.expectedAnnualLoss,
			truncatedEalUsd: truncRes.expectedAnnualLoss,
			cbaNpvUsd: cba.quantitativeMetrics.netPresentValue,
			cbaBcr: cba.quantitativeMetrics.benefitCostRatio,
		};
	});

	// 10. L2 Reference Model: OASIS CAP v1.2 Canonical Payloads & Negative Rejection Suite
	addCase("l2_oasis_cap12_canonical_examples", "reference_model", () => {
		const canonicalAlert = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>KSTO1055887203</identifier>
  <sender>KSTO@NWS.NOAA.GOV</sender>
  <sent>2003-06-17T14:57:00-07:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <category>Met</category>
    <event>SEVERE THUNDERSTORM</event>
    <urgency>Immediate</urgency>
    <severity>Severe</severity>
    <certainty>Observed</certainty>
    <headline>SEVERE THUNDERSTORM WARNING</headline>
    <area>
      <areaDesc>U.S. nationwide and surrounding waters</areaDesc>
      <polygon>38.47,-120.14 38.34,-119.95 38.52,-119.74 38.62,-119.89 38.47,-120.14</polygon>
    </area>
  </info>
</alert>`;

		const canonicalUpdate = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>DHS-UPDATE-002</identifier>
  <sender>hsas@dhs.gov</sender>
  <sent>2003-04-02T14:39:01-05:00</sent>
  <status>Actual</status>
  <msgType>Update</msgType>
  <scope>Private</scope>
  <addresses>eoc-ops@agency.gov</addresses>
  <references>hsas@dhs.gov,DHS-INIT-001,2003-04-02T10:00:00-05:00</references>
  <info>
    <category>Security</category>
    <event>Homeland Security Advisory System Update</event>
    <urgency>Immediate</urgency>
    <severity>Severe</severity>
    <certainty>Likely</certainty>
    <headline>Homeland Security Advisory System Update</headline>
  </info>
</alert>`;

		const invalidUpdateMissingRefs = canonicalUpdate.replace(/<references>[\s\S]*?<\/references>/, "");
		const invalidPrivateMissingAddresses = canonicalUpdate.replace(/<addresses>[\s\S]*?<\/addresses>/, "");
		const xxePayload = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${canonicalAlert.replace(/<\?xml[\s\S]*?\?>/, "")}`;

		const v1 = validateCapXml(canonicalAlert);
		const v2 = validateCapXml(canonicalUpdate);
		const v3 = validateCapXml(invalidUpdateMissingRefs);
		const v4 = validateCapXml(invalidPrivateMissingAddresses);
		const v5 = validateCapXml(xxePayload);

		if (!v1.isValid) throw new Error(`Canonical CAP 1.2 Alert rejected: ${v1.errors.join("; ")}`);
		if (!v2.isValid) throw new Error(`Canonical CAP 1.2 Update/Private rejected: ${v2.errors.join("; ")}`);
		if (v3.isValid) throw new Error("CAP Update without <references> must be rejected");
		if (v4.isValid) throw new Error("CAP Private scope without <addresses> must be rejected");
		if (v5.isValid) throw new Error("CAP XXE <!DOCTYPE>/<!ENTITY> payload must be rejected");

		return {
			canonicalValidCount: 2,
			malformedRejectedCount: 3,
		};
	});

	// =========================================================================
	// L3: Historical Hindcast & Anticipatory-Action Verification Benchmarks
	// =========================================================================

	// 11. Historical Hindcast Regression: Southern Thailand Flood Scenario (fixture)
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

	// 12. L3 Multi-Event Historical Hindcast Corpus (Accuracy & Uncertainty Interval Coverage)
	addCase("hindcast_multi_event_historical_corpus", "hindcast_benchmark", () => {
		const corpusPath = path.join(__dirname, "../tests/validation/historical-hindcasts.json");
		const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
		const events = corpus.impactEvents || [];
		if (events.length < 6) throw new Error(`Expected >= 6 historical hindcast events, found ${events.length}`);

		let withinBandCount = 0;
		let uncertaintyCoveredCount = 0;
		let absMdrErrorSum = 0;
		const perEventResults = [];

		for (const ev of events) {
			let modelledMdr = null;
			let intensityForUnc = null;
			let gmiceCheck = null;
			let codeDiffCheck = null;

			if (ev.hazardType === "earthquake") {
				const gmice = estimatePgaFromMmiDetailed(ev.inputs.observedMmi);
				const [pgaMin, pgaMax] = ev.observedOutcome.pgaBandG;
				const pgaInBand = gmice.pgaG >= pgaMin && gmice.pgaG <= pgaMax;
				if (!pgaInBand) {
					throw new Error(`${ev.id}: Wald99 PGA ${gmice.pgaG}g outside observed band [${pgaMin}, ${pgaMax}]g`);
				}
				if (gmice.extrapolated !== ev.observedOutcome.expectedExtrapolated) {
					throw new Error(`${ev.id}: expected extrapolated=${ev.observedOutcome.expectedExtrapolated}, got ${gmice.extrapolated}`);
				}
				gmiceCheck = { pgaG: gmice.pgaG, extrapolated: gmice.extrapolated, pgaInBand };

				const frag = evaluateSeismicFragility(ev.inputs.taxonomy, ev.inputs.intensityPgaG);
				modelledMdr = frag.meanDamageRatio;
				intensityForUnc = ev.inputs.intensityPgaG;

				if (ev.inputs.comparisonTaxonomy && ev.observedOutcome.expectedCodeDifferentialMin) {
					const comp = evaluateSeismicFragility(ev.inputs.comparisonTaxonomy, ev.inputs.intensityPgaG);
					const diff = modelledMdr - comp.meanDamageRatio;
					if (diff < ev.observedOutcome.expectedCodeDifferentialMin) {
						throw new Error(`${ev.id}: code differential ${diff.toFixed(3)} < ${ev.observedOutcome.expectedCodeDifferentialMin}`);
					}
					codeDiffCheck = {
						primaryMdr: modelledMdr,
						comparisonMdr: comp.meanDamageRatio,
						differential: parseFloat(diff.toFixed(4)),
					};
				}
			} else if (ev.hazardType === "flood") {
				const flood = evaluateFloodDamage(ev.inputs.intensityDepthM, ev.inputs.occupancy);
				modelledMdr = flood.combinedMeanDamageRatio;
				intensityForUnc = ev.inputs.intensityDepthM;
			} else if (ev.hazardType === "cyclone") {
				const wind = evaluateWindDamage(ev.inputs.intensityWindKmh);
				modelledMdr = wind.meanDamageRatio;
				intensityForUnc = ev.inputs.intensityWindKmh;
			} else {
				throw new Error(`Unsupported hindcast hazardType '${ev.hazardType}' in ${ev.id}`);
			}

			const [mdrMin, mdrMax] = ev.observedOutcome.mdrBand;
			const inBand = modelledMdr >= mdrMin && modelledMdr <= mdrMax;
			if (!inBand) {
				throw new Error(`${ev.id}: modelled MDR ${modelledMdr} outside observed band [${mdrMin}, ${mdrMax}]`);
			}
			withinBandCount++;
			const absErr = Math.abs(modelledMdr - ev.observedOutcome.mdrMidpoint);
			absMdrErrorSum += absErr;

			// Uncertainty interval coverage check against observed midpoint loss
			const uncHazardType = ev.hazardType === "cyclone" ? "wind" : ev.hazardType;
			const unc = propagateUncertainty({
				hazardType: uncHazardType,
				intensity: intensityForUnc,
				exposedValueUsd: ev.inputs.exposedValueUsd,
				taxonomy: ev.inputs.taxonomy || "URM",
				occupancy: ev.inputs.occupancy || "residential_1story",
				intensityBounds: ev.inputs.intensityBounds,
				mode: "bounds",
			});
			const observedMidLoss = ev.observedOutcome.mdrMidpoint * ev.inputs.exposedValueUsd;
			const covered =
				observedMidLoss >= unc.deterministicBounds.lowLossUsd &&
				observedMidLoss <= unc.deterministicBounds.highLossUsd;
			if (covered) uncertaintyCoveredCount++;

			perEventResults.push({
				id: ev.id,
				hazardType: ev.hazardType,
				iso3: ev.iso3,
				year: ev.year,
				modelledMdr,
				observedMdrBand: ev.observedOutcome.mdrBand,
				inObservedBand: inBand,
				absMdrError: parseFloat(absErr.toFixed(4)),
				uncertaintyIntervalCovered: covered,
				gmiceCheck,
				codeDiffCheck,
			});
		}

		const withinObservedBandRate = parseFloat((withinBandCount / events.length).toFixed(4));
		const uncertaintyCoverageRate = parseFloat((uncertaintyCoveredCount / events.length).toFixed(4));
		const meanAbsoluteMdrError = parseFloat((absMdrErrorSum / events.length).toFixed(4));

		if (uncertaintyCoverageRate < 0.75) {
			throw new Error(`Uncertainty interval coverage ${uncertaintyCoverageRate} below 0.75 minimum threshold`);
		}

		return {
			eventsEvaluated: events.length,
			withinObservedBandCount: withinBandCount,
			withinObservedBandRate,
			uncertaintyCoveredCount,
			uncertaintyCoverageRate,
			meanAbsoluteMdrError,
			corpusSnapshotHash: computeSnapshotHash(corpus),
			perEventResults,
		};
	});

	// 13. L3 Anticipatory-Action / FbF Trigger Skill Verification (2x2 Contingency Table)
	addCase("hindcast_fbf_trigger_skill_verification", "hindcast_benchmark", () => {
		const corpusPath = path.join(__dirname, "../tests/validation/historical-hindcasts.json");
		const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
		const fbfCases = corpus.fbfTriggerCases || [];
		if (fbfCases.length < 4) throw new Error(`Expected >= 4 FbF trigger cases, found ${fbfCases.length}`);

		let hits = 0;
		let misses = 0;
		let falseAlarms = 0;
		let correctNegatives = 0;
		const caseResults = [];

		for (const fc of fbfCases) {
			const res = analyzeFloodRisk(fc.weatherData, fc.options);
			const aa = res.anticipatoryAction || {};
			// C-05 invariant: rainfall screening must never fabricate flood depth
			if (aa.depthStatus !== "depth_unavailable" || aa.estimatedInundationDepthMeters !== null) {
				throw new Error(`${fc.id}: C-05 violation — rainfall screening fabricated flood depth`);
			}
			const predicted = Boolean(aa.triggerActivated);
			const expected = Boolean(fc.expectedTriggerActivated);

			if (predicted && expected) hits++;
			else if (!predicted && expected) misses++;
			else if (predicted && !expected) falseAlarms++;
			else correctNegatives++;

			if (predicted !== expected) {
				throw new Error(`${fc.id}: expected triggerActivated=${expected}, got ${predicted}`);
			}

			caseResults.push({
				id: fc.id,
				iso3: fc.iso3,
				predicted,
				expected,
				floodAlertColor: aa.alertColor,
				persistenceSatisfied: res.persistenceCheck ? res.persistenceCheck.persistent : null,
			});
		}

		const pod = hits + misses > 0 ? parseFloat((hits / (hits + misses)).toFixed(4)) : null;
		const far = hits + falseAlarms > 0 ? parseFloat((falseAlarms / (hits + falseAlarms)).toFixed(4)) : 0;
		const csi = hits + misses + falseAlarms > 0 ? parseFloat((hits / (hits + misses + falseAlarms)).toFixed(4)) : null;
		const accuracy = parseFloat(((hits + correctNegatives) / fbfCases.length).toFixed(4));

		return {
			casesEvaluated: fbfCases.length,
			contingencyTable: { hits, misses, falseAlarms, correctNegatives },
			skillMetrics: { pod, far, csi, accuracy },
			caseResults,
		};
	});

	// 14. L3 End-to-End Geospatial Historical Event Replays (Spatial + Infra + Fragility + Severity + Sendai)
	addCase("hindcast_geospatial_end_to_end_replays", "hindcast_benchmark", () => {
		const replayFixturePath = path.join(__dirname, "../tests/validation/geospatial-event-replays.json");
		const fixture = JSON.parse(fs.readFileSync(replayFixturePath, "utf8"));
		const replays = fixture.replays || [];
		if (replays.length < 2) {
			throw new Error("Expected at least 2 end-to-end geospatial historical event replays");
		}

		const eventResults = [];
		for (const ev of replays) {
			const spatial = spatialExposureJoin(ev.hazardGeoJSON, ev.exposureGeoJSON);
			const spatialRepeat = spatialExposureJoin(ev.hazardGeoJSON, ev.exposureGeoJSON);
			const reproducible = computeSnapshotHash(spatial.summary) === computeSnapshotHash(spatialRepeat.summary);
			if (!reproducible) {
				throw new Error(`${ev.id}: spatialExposureJoin failed deterministic reproducibility check`);
			}

			const actualIds = new Set(
				(spatial.exposedAssets || []).map((a) => a.id || (a.properties && a.properties.id)).filter(Boolean),
			);
			const expectedIds = new Set(ev.referenceOutcome.expectedExposedFeatureIds || []);
			const excludedIds = new Set(ev.referenceOutcome.expectedExcludedFeatureIds || []);

			let tp = 0;
			let fp = 0;
			let fn = 0;
			for (const id of actualIds) {
				if (expectedIds.has(id)) tp++;
				else fp++;
			}
			for (const id of expectedIds) {
				if (!actualIds.has(id)) fn++;
			}
			for (const id of excludedIds) {
				if (actualIds.has(id)) {
					throw new Error(`${ev.id}: control asset '${id}' outside hazard footprint was falsely marked exposed`);
				}
			}

			const precision = tp + fp > 0 ? parseFloat((tp / (tp + fp)).toFixed(4)) : 0;
			const recall = tp + fn > 0 ? parseFloat((tp / (tp + fn)).toFixed(4)) : 0;
			if (precision < 1 || recall < 1) {
				throw new Error(`${ev.id}: spatial precision=${precision}, recall=${recall} (expected 1.0/1.0)`);
			}

			const estPop = Number(spatial.summary.totalExposedPopulation || 0);
			const refPop = Number(ev.referenceOutcome.referenceExposedPopulation || 0);
			const popMae = Math.abs(estPop - refPop);
			const popApePct = refPop > 0 ? parseFloat(((popMae / refPop) * 100).toFixed(2)) : 0;
			if (popApePct > ev.referenceOutcome.maxPopulationApePct) {
				throw new Error(`${ev.id}: population APE ${popApePct}% exceeded max ${ev.referenceOutcome.maxPopulationApePct}%`);
			}

			const infra = overlayCriticalInfraOnHazard(ev.hazardGeoJSON, ev.exposureGeoJSON, { audience: "eoc_internal" });
			if (infra.summary.physicallyExposedCount !== expectedIds.size) {
				throw new Error(
					`${ev.id}: infra overlay exposed count ${infra.summary.physicallyExposedCount} !== ${expectedIds.size}`,
				);
			}

			const vuln = evaluateVulnerabilityMatrix(spatial, {
				hazardType: ev.hazardType === "cyclone" ? "wind" : ev.hazardType,
				intensity: ev.intensity,
				unit: ev.intensityUnit,
				currency: "USD",
				valuationYear: ev.year,
			});
			const mdr = parseFloat(
				(Number(vuln.sendaiFrameworkMetrics.targetC_DirectEconomicLoss.aggregateLossRatioPercentage) / 100).toFixed(4),
			);
			const [mdrMin, mdrMax] = ev.referenceOutcome.expectedMdrBand;
			if (mdr < mdrMin || mdr > mdrMax) {
				throw new Error(`${ev.id}: portfolio MDR ${mdr} outside observed band [${mdrMin}, ${mdrMax}]`);
			}

			// Sendai C-01/C-02 semantic validation
			if (vuln.sendaiFrameworkMetrics.targetB_AffectedPeople.b1DirectlyAffected !== null) {
				throw new Error(`${ev.id}: C-01 violation — modelled displacement conflated into b1DirectlyAffected`);
			}
			const sendaiCheck = validateSendaiSubmission(vuln.sendaiFrameworkMetrics, {
				referencePopulation: refPop,
			});
			if (!sendaiCheck.valid) {
				throw new Error(`${ev.id}: Sendai validation failed: ${sendaiCheck.errors.join("; ")}`);
			}

			const severity = evaluateHumanitarianSeverity({
				pcode: ev.iso3,
				unitName: ev.eventName,
				hazardType: ev.hazardType,
				hazardIntensity: 8.5,
				spatialReport: spatial,
				vulnerabilityReport: vuln,
				infraOverlay: infra,
				copingCapacityDeficit: 6.5,
			});
			if (!severity.severityPhase || severity.severityPhase < ev.referenceOutcome.expectedSeverityPhaseMin) {
				throw new Error(
					`${ev.id}: severity phase ${severity.severityPhase} below expected minimum ${ev.referenceOutcome.expectedSeverityPhaseMin}`,
				);
			}

			eventResults.push({
				id: ev.id,
				iso3: ev.iso3,
				hazardType: ev.hazardType,
				spatialPrecision: precision,
				spatialRecall: recall,
				exposedPopulation: estPop,
				referencePopulation: refPop,
				populationMae: popMae,
				populationApePct: popApePct,
				exposedInfraCount: infra.summary.physicallyExposedCount,
				portfolioMdr: mdr,
				observedMdrBand: ev.referenceOutcome.expectedMdrBand,
				severityPhase: severity.severityPhase,
				reproducible,
				snapshotHash: computeSnapshotHash({
					spatial: spatial.summary,
					vuln: vuln.sendaiFrameworkMetrics,
					infra: infra.summary,
				}),
			});
		}

		const meanSpatialPrecision = parseFloat(
			(eventResults.reduce((s, r) => s + r.spatialPrecision, 0) / eventResults.length).toFixed(4),
		);
		const meanSpatialRecall = parseFloat(
			(eventResults.reduce((s, r) => s + r.spatialRecall, 0) / eventResults.length).toFixed(4),
		);
		const meanPopulationApePct = parseFloat(
			(eventResults.reduce((s, r) => s + r.populationApePct, 0) / eventResults.length).toFixed(2),
		);

		return {
			eventsEvaluated: eventResults.length,
			meanSpatialPrecision,
			meanSpatialRecall,
			meanPopulationApePct,
			allReproducible: eventResults.every((r) => r.reproducible),
			eventResults,
		};
	});

	// 15. L3 Real-Event Extreme-Heat Reanalysis Replay: April 2024 Luzon WBGT (Copernicus C3S ERA5)
	addCase("hindcast_era5_luzon_wbgt_heatwave_2024", "hindcast_benchmark", () => {
		const fixturePath = path.join(__dirname, "../tests/validation/era5-luzon-wbgt-2024-04.json");
		const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
		const outdoorGrid = fixture.outdoorPeakGrid;
		const indoorGrid = fixture.indoorPeakGrid;
		const ref = fixture.referenceOutcome;

		const zoneResults = [];
		for (const z of fixture.zones) {
			const feature = { type: "Feature", properties: { id: z.id, pcode: z.pcode, name: z.name }, geometry: z.geometry };
			const outStats = computeRasterZonalStats(outdoorGrid, feature);
			const outRepeat = computeRasterZonalStats(outdoorGrid, feature);
			const inStats = computeRasterZonalStats(indoorGrid, feature);

			if (computeSnapshotHash(outStats.stats) !== computeSnapshotHash(outRepeat.stats)) {
				throw new Error(`${z.id}: computeRasterZonalStats failed deterministic reproducibility check`);
			}
			// Continuous raster semantics invariant: temperatures must never be summed
			if (outStats.stats.integratedTotal !== null || outStats.stats.rawCellSum !== null) {
				throw new Error(`${z.id}: continuous raster semantics violated (temperature cells were summed)`);
			}

			const outMean = Number(outStats.stats.meanCellValue);
			const outMax = Number(outStats.stats.maxCellValue);
			const inMean = Number(inStats.stats.meanCellValue);
			const solarDelta = parseFloat((outMean - inMean).toFixed(2));

			const [oMin, oMax] = z.expectedOutdoorMeanRangeC;
			const [iMin, iMax] = z.expectedIndoorMeanRangeC;
			if (outMean < oMin || outMean > oMax) {
				throw new Error(`${z.id}: outdoor WBGT mean ${outMean}C outside expected [${oMin}, ${oMax}]C`);
			}
			if (inMean < iMin || inMean > iMax) {
				throw new Error(`${z.id}: indoor WBGT mean ${inMean}C outside expected [${iMin}, ${iMax}]C`);
			}
			if (solarDelta < ref.minSolarLoadDeltaC) {
				throw new Error(`${z.id}: outdoor-indoor solar delta ${solarDelta}C below ${ref.minSolarLoadDeltaC}C`);
			}
			if (z.role !== "highland_control" && outMean < ref.extremeOutdoorWbgtThresholdC) {
				throw new Error(`${z.id}: lowland outdoor WBGT ${outMean}C below extreme heat threshold ${ref.extremeOutdoorWbgtThresholdC}C`);
			}

			zoneResults.push({
				id: z.id,
				pcode: z.pcode,
				role: z.role,
				validCells: outStats.stats.validCells,
				outdoorMeanC: outMean,
				outdoorMaxC: outMax,
				indoorMeanC: inMean,
				solarLoadDeltaC: solarDelta,
			});
		}

		const cagayan = zoneResults.find((r) => r.id === "phl_cagayan_valley");
		const cordillera = zoneResults.find((r) => r.id === "phl_cordillera_highlands");
		const highlandCoolingDeltaC = parseFloat((cagayan.outdoorMeanC - cordillera.outdoorMeanC).toFixed(2));
		if (highlandCoolingDeltaC < ref.minHighlandCoolingDeltaC) {
			throw new Error(`Highland cooling gradient ${highlandCoolingDeltaC}C below expected ${ref.minHighlandCoolingDeltaC}C`);
		}

		const severity = evaluateHumanitarianSeverity({
			pcode: "PH02",
			unitName: "Cagayan Valley (April 2024 Heatwave Peak)",
			hazardType: "heatwave",
			hazardIntensity: 9.0,
			affectedPopulation: 3685000,
			totalPopulation: 3685000,
			vulnerability: 6.2,
			copingCapacityDeficit: 5.5,
		});
		if (!severity.severityPhase || severity.severityPhase < ref.expectedSeverityPhaseMin) {
			throw new Error(`Severity phase ${severity.severityPhase} below expected minimum ${ref.expectedSeverityPhaseMin}`);
		}

		return {
			eventId: fixture.id,
			peakDatetimeUtc: fixture.peakDatetimeUtc,
			zonesEvaluated: zoneResults.length,
			peakOutdoorWbgtC: Math.max(...zoneResults.map((z) => z.outdoorMaxC)),
			highlandCoolingDeltaC,
			severityPhase: severity.severityPhase,
			continuousSemanticsPreserved: true,
			snapshotHash: computeSnapshotHash(zoneResults),
			zoneResults,
		};
	});

	const passedCount = cases.filter((c) => c.passed).length;
	const failedCount = cases.length - passedCount;

	const countByKind = (kind) => {
		const subset = cases.filter((c) => c.classification === kind);
		return {
			total: subset.length,
			passed: subset.filter((c) => c.passed).length,
			failed: subset.filter((c) => !c.passed).length,
		};
	};

	return {
		valid: failedCount === 0,
		suiteFilter,
		totalCases: cases.length,
		passedCount,
		failedCount,
		maturitySummary: {
			L0_L1_synthetic_reference: countByKind("synthetic_reference"),
			L2_reference_model: countByKind("reference_model"),
			L3_hindcast_benchmark: countByKind("hindcast_benchmark"),
		},
		cases,
	};
}

module.exports = {
	runReplayValidation,
};
