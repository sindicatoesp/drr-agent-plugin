const assert = require("assert");
const { runReplayValidation } = require("../lib/replay");

console.log("Testing L2 Reference Model Verification & L3 Multi-Event Historical Hindcast Suite...");

// 1. L2 Reference Model Suite
const l2 = runReplayValidation({ suite: "reference_model" });
assert.strictEqual(l2.valid, true, `L2 reference_model suite failed: ${JSON.stringify(l2.cases.filter((c) => !c.passed))}`);
assert.strictEqual(l2.totalCases, 4, "Expected 4 L2 reference_model cases");
assert(l2.cases.every((c) => c.classification === "reference_model"));

const waldCase = l2.cases.find((c) => c.id === "l2_wald99_reference_table");
assert(waldCase && waldCase.passed && waldCase.details.pointsVerified === 6);
assert(waldCase.details.maxAbsErrorG < 1e-4, `Wald99 max error too high: ${waldCase.details.maxAbsErrorG}`);

const fragCase = l2.cases.find((c) => c.id === "l2_fragility_lognormal_closed_form");
assert(fragCase && fragCase.passed && fragCase.details.taxonomiesVerified === 6);
assert(fragCase.details.maxProbError < 1e-3);
assert(fragCase.details.maxMdrError < 1e-3);

const ealCase = l2.cases.find((c) => c.id === "l2_appraisal_eal_analytical_integral");
assert(ealCase && ealCase.passed);
assert.strictEqual(ealCase.details.flatEalUsd, 40250);
assert.strictEqual(ealCase.details.truncatedEalUsd, 35250);

const capCase = l2.cases.find((c) => c.id === "l2_oasis_cap12_canonical_examples");
assert(capCase && capCase.passed);
assert.strictEqual(capCase.details.canonicalValidCount, 2);
assert.strictEqual(capCase.details.malformedRejectedCount, 3);

// 2. L3 Historical Hindcast & FbF Trigger Skill Suite
const l3 = runReplayValidation({ suite: "hindcast_benchmark" });
assert.strictEqual(l3.valid, true, `L3 hindcast_benchmark suite failed: ${JSON.stringify(l3.cases.filter((c) => !c.passed))}`);
assert.strictEqual(l3.totalCases, 3, "Expected 3 L3 hindcast_benchmark cases");
assert(l3.cases.every((c) => c.classification === "hindcast_benchmark"));

const corpusCase = l3.cases.find((c) => c.id === "hindcast_multi_event_historical_corpus");
assert(corpusCase && corpusCase.passed);
assert.strictEqual(corpusCase.details.eventsEvaluated, 8, "Expected 8 historical disaster events");
assert.strictEqual(corpusCase.details.withinObservedBandRate, 1, "Expected all 8 events within observed bands");
assert(corpusCase.details.uncertaintyCoverageRate >= 0.75, "Expected >= 75% uncertainty interval coverage");
assert(corpusCase.details.meanAbsoluteMdrError < 0.1, `Mean absolute MDR error too high: ${corpusCase.details.meanAbsoluteMdrError}`);

const fbfCase = l3.cases.find((c) => c.id === "hindcast_fbf_trigger_skill_verification");
assert(fbfCase && fbfCase.passed);
assert.strictEqual(fbfCase.details.casesEvaluated, 4);
assert.strictEqual(fbfCase.details.contingencyTable.hits, 2);
assert.strictEqual(fbfCase.details.contingencyTable.misses, 0);
assert.strictEqual(fbfCase.details.contingencyTable.falseAlarms, 0);
assert.strictEqual(fbfCase.details.contingencyTable.correctNegatives, 2);
assert.strictEqual(fbfCase.details.skillMetrics.pod, 1);
assert.strictEqual(fbfCase.details.skillMetrics.far, 0);
assert.strictEqual(fbfCase.details.skillMetrics.csi, 1);
assert.strictEqual(fbfCase.details.skillMetrics.accuracy, 1);

// 3. Full Suite Maturity Summary
const all = runReplayValidation({ suite: "all" });
assert.strictEqual(all.valid, true);
assert.strictEqual(all.totalCases, 13);
assert.strictEqual(all.maturitySummary.L0_L1_synthetic_reference.passed, 6);
assert.strictEqual(all.maturitySummary.L2_reference_model.passed, 4);
assert.strictEqual(all.maturitySummary.L3_hindcast_benchmark.passed, 3);

console.log("✅ L2 Reference Model & L3 Multi-Event Historical Hindcast Validation tests passed!");
