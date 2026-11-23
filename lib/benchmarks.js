/**
 * Agentic DRR Benchmark & Trajectory Evaluation Runner
 *
 * Evaluates multi-step DRR agent workflows inspired by GeoDisaster benchmarks:
 * - Tool selection accuracy (required tools called, forbidden tools avoided)
 * - Numerical accuracy (tolerance-checked assertions)
 * - Non-goal & safety compliance (no fabricated flood depth, Draft CAP blocked on prod,
 *   Sendai displacement != B-1, no hazard-only severity, CIP public redaction)
 * - Evidence & provenance coverage (snapshotHash, method ID, timestamps)
 * - Schema validity (required structured output keys)
 *
 * Pure Node.js standard library only.
 */

const fs = require("fs");
const path = require("path");
const { fetchWeatherForecast } = require("./openmeteo");
const { screenRiverDischarge } = require("./hydro");
const { spatialExposureJoin } = require("./spatial");
const { evaluateVulnerabilityMatrix } = require("./vulnerability");
const { validateSendaiSubmission } = require("./sendai");
const { generateCapXml, validateCapXml, prepareCapPublication } = require("./cap");
const { ingestHdxHapiData, validateCodBoundaries } = require("./hdx");
const { evaluateHumanitarianSeverity } = require("./severity");
const { ingestCriticalInfraOverlay } = require("./infra-overlay");
const { ingestStacHazardCatalog } = require("./stac");
const { createProvenanceManifest } = require("./contracts");

const DEFAULT_BENCHMARK_PATH = path.join(__dirname, "..", "tests", "benchmarks", "geodisaster-scenarios.json");

function getPathValue(obj, dotPath) {
	if (!obj || typeof obj !== "object") return undefined;
	return String(dotPath)
		.split(".")
		.reduce((acc, part) => (acc !== null && acc !== undefined ? acc[part] : undefined), obj);
}

/**
 * Load a curated benchmark suite JSON file.
 */
function loadBenchmarkSuite(suitePath = DEFAULT_BENCHMARK_PATH) {
	const raw = fs.readFileSync(suitePath, "utf8");
	const parsed = JSON.parse(raw);
	if (!parsed || !Array.isArray(parsed.scenarios)) {
		throw new Error(`Invalid benchmark suite at '${suitePath}': missing 'scenarios' array.`);
	}
	return parsed;
}

/**
 * Evaluate non-goal & safety compliance rules on a scenario output.
 */
function evaluateNonGoalRule(rule, output) {
	switch (rule) {
		case "no_fabricated_flood_depth":
			return (
				output.depthStatus === "depth_unavailable" &&
				(!output.forecast || output.forecast.estimatedFloodDepthM === undefined)
			);
		case "separate_displacement_from_b1":
			return Boolean(
				output.vulnerabilityReport &&
					output.vulnerabilityReport.sendaiFrameworkMetrics &&
					output.vulnerabilityReport.sendaiFrameworkMetrics.targetB_AffectedPeople &&
					output.vulnerabilityReport.sendaiFrameworkMetrics.targetB_AffectedPeople.b1DirectlyAffected === null &&
					output.vulnerabilityReport.sendaiFrameworkMetrics.targetB_AffectedPeople.estimatedDisplacedPopulation !== undefined &&
					output.sendaiValidation &&
					output.sendaiValidation.valid === true,
			);
		case "block_draft_on_production":
			return Boolean(output.publishGate && output.publishGate.published === false);
		case "no_hazard_only_severity":
			return Boolean(
				output.severityAssessment &&
					output.severityAssessment.hazardOnlyBlocked === false &&
					output.severityAssessment.pillars &&
					output.severityAssessment.pillars.exposure &&
					output.severityAssessment.pillars.exposure.score !== null,
			);
		case "cip_public_redaction_enforced":
			return Boolean(
				output.infraOverlay &&
					output.infraOverlay.summary &&
					output.infraOverlay.summary.redactedForPublicCount >= 1,
			);
		case "separate_extent_from_depth":
			return Boolean(
				output.stacResult &&
					output.stacResult.summary &&
					output.stacResult.summary.validatedDepthGridCount === 0,
			);
		default:
			return true;
	}
}

/**
 * Score a single agent trajectory `{ toolsCalled: string[], output: object }` against a benchmark scenario.
 */
function scoreAgentTrajectory(scenario, trajectory) {
	const toolsCalled = Array.isArray(trajectory && trajectory.toolsCalled) ? trajectory.toolsCalled : [];
	const output = (trajectory && trajectory.output) || {};
	const assertions = scenario.assertions || {};
	const failures = [];

	// 1. Tool selection score
	const expectedTools = Array.isArray(scenario.expectedTools) ? scenario.expectedTools : [];
	const forbiddenTools = Array.isArray(scenario.forbiddenTools) ? scenario.forbiddenTools : [];
	const matchedExpected = expectedTools.filter((t) => toolsCalled.includes(t));
	const calledForbidden = forbiddenTools.filter((t) => toolsCalled.includes(t));
	if (matchedExpected.length < expectedTools.length) {
		failures.push(`Missing expected tools: ${expectedTools.filter((t) => !toolsCalled.includes(t)).join(", ")}`);
	}
	if (calledForbidden.length > 0) {
		failures.push(`Called forbidden tools: ${calledForbidden.join(", ")}`);
	}
	const toolRecall = expectedTools.length > 0 ? matchedExpected.length / expectedTools.length : 1;
	const toolSelectionScore = calledForbidden.length > 0 ? 0 : Number(toolRecall.toFixed(3));

	// 2. Schema validity score
	const requiredKeys = Array.isArray(assertions.requiredKeys) ? assertions.requiredKeys : [];
	const presentKeys = requiredKeys.filter((k) => output[k] !== undefined && output[k] !== null);
	if (presentKeys.length < requiredKeys.length) {
		failures.push(`Missing required output keys: ${requiredKeys.filter((k) => !presentKeys.includes(k)).join(", ")}`);
	}
	const exactValues = assertions.exactValues || {};
	const exactEntries = Object.entries(exactValues);
	let exactPassed = 0;
	for (const [dotPath, expectedVal] of exactEntries) {
		const actual = getPathValue(output, dotPath);
		if (actual === expectedVal) {
			exactPassed += 1;
		} else {
			failures.push(`Exact assertion failed at '${dotPath}': expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actual)}`);
		}
	}
	const schemaTotal = requiredKeys.length + exactEntries.length;
	const schemaValidityScore = schemaTotal > 0 ? Number(((presentKeys.length + exactPassed) / schemaTotal).toFixed(3)) : 1;

	// 3. Numerical accuracy score
	const numericChecks = Array.isArray(assertions.numericChecks) ? assertions.numericChecks : [];
	let numericPassed = 0;
	for (const chk of numericChecks) {
		const val = Number(getPathValue(output, chk.path));
		if (!Number.isFinite(val)) {
			failures.push(`Numeric check failed at '${chk.path}': value is not finite.`);
			continue;
		}
		let ok = true;
		if (chk.expected !== undefined) {
			const tol = chk.tolerance !== undefined ? Number(chk.tolerance) : 1e-6;
			ok = Math.abs(val - Number(chk.expected)) <= tol;
		}
		if (ok && chk.min !== undefined) ok = val >= Number(chk.min);
		if (ok && chk.max !== undefined) ok = val <= Number(chk.max);
		if (ok) numericPassed += 1;
		else failures.push(`Numeric check failed at '${chk.path}': got ${val}.`);
	}
	const numericalAccuracyScore = numericChecks.length > 0 ? Number((numericPassed / numericChecks.length).toFixed(3)) : 1;

	// 4. Non-goal compliance score
	const nonGoalRules = Array.isArray(assertions.nonGoalRules) ? assertions.nonGoalRules : [];
	let nonGoalPassed = 0;
	for (const rule of nonGoalRules) {
		if (evaluateNonGoalRule(rule, output)) {
			nonGoalPassed += 1;
		} else {
			failures.push(`Non-goal rule violated: '${rule}'.`);
		}
	}
	const nonGoalComplianceScore = nonGoalRules.length > 0 ? Number((nonGoalPassed / nonGoalRules.length).toFixed(3)) : 1;

	// 5. Evidence & provenance coverage score
	const prov = output.provenance || null;
	const hasHash = Boolean(
		prov && (prov.snapshotHash || prov.inputSnapshotHash || (prov.inputs && prov.inputs.snapshotHash)),
	);
	const hasTimestamp = Boolean(prov && (prov.generatedAt || prov.retrievedAt || prov.assessedAt || prov.checkedAt));
	const hasEvidenceBasis = Boolean(prov && (prov.evidenceBasis || (prov.governance && prov.governance.evidenceBasis)));
	const evidenceChecks = [hasHash, hasTimestamp, hasEvidenceBasis];
	const evidenceCoverageScore = Number((evidenceChecks.filter(Boolean).length / evidenceChecks.length).toFixed(3));
	if (evidenceCoverageScore < 1) {
		failures.push("Incomplete provenance metadata (requires snapshotHash, timestamp, and evidenceBasis).");
	}

	const overallScore = Number(
		(
			toolSelectionScore * 0.25 +
			numericalAccuracyScore * 0.20 +
			nonGoalComplianceScore * 0.25 +
			evidenceCoverageScore * 0.15 +
			schemaValidityScore * 0.15
		).toFixed(3),
	);

	return {
		scenarioId: scenario.id,
		category: scenario.category,
		passed: failures.length === 0 && overallScore === 1,
		overallScore,
		scores: {
			toolSelectionScore,
			numericalAccuracyScore,
			nonGoalComplianceScore,
			evidenceCoverageScore,
			schemaValidityScore,
		},
		toolsCalled,
		failures,
	};
}

/**
 * Execute deterministic reference trajectory for a built-in GeoDisaster scenario.
 */
async function executeReferenceScenario(scenario) {
	const inp = scenario.inputs || {};
	switch (scenario.id) {
		case "geo-01-flood-fba-non-fabrication": {
			const forecast = await fetchWeatherForecast(inp.openmeteo);
			const discharge = screenRiverDischarge(inp.riverDischarge);
			const provenance = createProvenanceManifest({
				sourceIds: ["openmeteo", "glofas"],
				method: "screening.openmeteo.rainfall_trigger",
				inputsSnapshot: inp,
				evidenceBasis: "modelled",
				verificationStatus: "unverified",
				approvalStatus: "draft",
			});
			return {
				toolsCalled: ["drr_openmeteo_forecast", "drr_river_discharge_screen"],
				output: {
					forecast,
					discharge,
					depthStatus: discharge.depthStatus || forecast.depthStatus || "depth_unavailable",
					provenance,
				},
			};
		}
		case "geo-02-eq-rapid-exposure-sendai": {
			const spatialReport = spatialExposureJoin(inp.hazardGeoJSON, inp.exposureGeoJSON);
			const vulnerabilityReport = evaluateVulnerabilityMatrix(spatialReport, {
				type: inp.hazardType,
				intensity: inp.intensity,
			});
			const sendaiValidation = validateSendaiSubmission({
				eventId: "bench-eq-01",
				evidenceBasis: "modelled",
				verificationStatus: "unverified",
				approvalStatus: "draft",
				modelledDisplacement: vulnerabilityReport.sendaiFrameworkMetrics.targetB_AffectedPeople.estimatedDisplacedPopulation,
				directEconomicLossUsd: vulnerabilityReport.sendaiFrameworkMetrics.targetC_DirectEconomicLoss.estimatedDirectEconomicLossUsd,
			});
			const provenance = createProvenanceManifest({
				sourceIds: ["local_exposure"],
				method: "vulnerability.sendai_composite",
				inputsSnapshot: { hazardType: inp.hazardType, intensity: inp.intensity },
				evidenceBasis: "modelled",
				verificationStatus: "unverified",
				approvalStatus: "draft",
			});
			return {
				toolsCalled: ["drr_spatial_exposure_join", "drr_vulnerability_matrix_calc", "drr_sendai_validate"],
				output: { spatialReport, vulnerabilityReport, sendaiValidation, provenance },
			};
		}
		case "geo-03-cap-draft-governance": {
			const xml = generateCapXml(inp.alertParams);
			const capResult = validateCapXml(xml);
			const publishGate = prepareCapPublication({
				xmlString: xml,
				channelType: inp.publishAttempt.channelType,
				destination: inp.publishAttempt.destination,
			});
			const provenance = createProvenanceManifest({
				sourceIds: ["cap_generator"],
				method: "alerting.oasis_cap_v1_2",
				inputsSnapshot: inp.alertParams,
				evidenceBasis: "modelled",
				verificationStatus: "unverified",
				approvalStatus: "draft",
			});
			return {
				toolsCalled: ["drr_cap_alert_generate_validate", "drr_cap_publish"],
				output: {
					capResult,
					publishGate: { ...publishGate, published: Boolean(publishGate.allowed && publishGate.published) },
					provenance,
				},
			};
		}
		case "geo-04-hdx-cod-severity": {
			const codValidation = validateCodBoundaries({ boundaryGeoJSON: inp.codGeoJSON });
			const hapiData = await ingestHdxHapiData({ samplePayload: inp.hapiSample });
			const severityAssessment = evaluateHumanitarianSeverity(inp.severityInput);
			const provenance = createProvenanceManifest({
				sourceIds: ["ocha_cod_ab", "ocha_hdx_hapi"],
				method: "assessment.humanitarian.severity_v1",
				inputsSnapshot: inp.severityInput,
				evidenceBasis: "modelled",
				verificationStatus: "unverified",
				approvalStatus: "draft",
			});
			return {
				toolsCalled: ["drr_cod_boundary_validate", "drr_hdx_hapi_fetch", "drr_humanitarian_severity_assess"],
				output: { codValidation, hapiData, severityAssessment, provenance },
			};
		}
		case "geo-05-cip-cascade-redaction": {
			const infraOverlay = await ingestCriticalInfraOverlay({
				infraGeoJSON: inp.infraGeoJSON,
				hazardGeoJSON: inp.hazardGeoJSON,
				audience: inp.audience,
			});
			const provenance = createProvenanceManifest({
				sourceIds: ["critical_infra_layer"],
				method: "exposure.sendai_critical_infra_overlay_v1",
				inputsSnapshot: { audience: inp.audience },
				evidenceBasis: "modelled",
				verificationStatus: "unverified",
				approvalStatus: "draft",
			});
			return {
				toolsCalled: ["drr_critical_infra_overlay"],
				output: { infraOverlay, provenance },
			};
		}
		case "geo-06-stac-depth-vs-extent": {
			const stacResult = await ingestStacHazardCatalog({ samplePayload: inp.stacSample });
			const provenance = createProvenanceManifest({
				sourceIds: ["stac_catalog"],
				method: "telemetry.stac.hazard_grid_v1",
				inputsSnapshot: { itemCount: stacResult.summary.itemCount },
				evidenceBasis: "observed",
				verificationStatus: "external_unverified",
				approvalStatus: "draft",
			});
			return {
				toolsCalled: ["drr_stac_hazard_fetch"],
				output: { stacResult, provenance },
			};
		}
		default:
			throw new Error(`No built-in reference executor for benchmark scenario '${scenario.id}'.`);
	}
}

/**
 * Run the curated agentic benchmark suite (either built-in reference trajectories or supplied agent trajectories).
 */
async function runBenchmarkSuite(options = {}) {
	const suite = options.suiteData || loadBenchmarkSuite(options.suitePath || DEFAULT_BENCHMARK_PATH);
	const filterCategory = options.category || null;
	const filterScenarioId = options.scenarioId || null;
	const externalTrajectories = options.trajectories || null;

	const selectedScenarios = suite.scenarios.filter((s) => {
		if (filterScenarioId && s.id !== filterScenarioId) return false;
		if (filterCategory && s.category !== filterCategory) return false;
		return true;
	});

	const results = [];
	for (const scenario of selectedScenarios) {
		const trajectory =
			externalTrajectories && externalTrajectories[scenario.id]
				? externalTrajectories[scenario.id]
				: await executeReferenceScenario(scenario);
		results.push(scoreAgentTrajectory(scenario, trajectory));
	}

	const passedCount = results.filter((r) => r.passed).length;
	const meanOverallScore =
		results.length > 0
			? Number((results.reduce((sum, r) => sum + r.overallScore, 0) / results.length).toFixed(3))
			: 0;

	return {
		suiteId: suite.suiteId,
		version: suite.version,
		mode: externalTrajectories ? "agent_trajectory_evaluation" : "reference_deterministic_verification",
		totalScenarios: results.length,
		passedCount,
		failedCount: results.length - passedCount,
		allPassed: results.length > 0 && passedCount === results.length,
		meanOverallScore,
		results,
		evaluatedAt: new Date().toISOString(),
	};
}

module.exports = {
	DEFAULT_BENCHMARK_PATH,
	loadBenchmarkSuite,
	scoreAgentTrajectory,
	executeReferenceScenario,
	runBenchmarkSuite,
};
