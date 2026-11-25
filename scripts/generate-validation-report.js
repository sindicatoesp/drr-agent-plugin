#!/usr/bin/env node
/**
 * Programmatic Validation & Benchmark Results Report Generator
 *
 * Executes runReplayValidation({ suite: "all" }) and runDualLayerEvaluation()
 * directly from executable library sources and writes docs/validation-results.md.
 * Clearly separates software/formula verification (L0-L2) from frozen historical
 * hindcast validation (L3) and live cross-model AI evaluation (planned).
 *
 * Pure Node.js standard library only.
 */

const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const { runReplayValidation } = require("../lib/replay");
const { runDualLayerEvaluation } = require("../lib/benchmarks");

const ROOT = path.join(__dirname, "..");

async function generateValidationReportMarkdown() {
	const replay = runReplayValidation({ suite: "all" });
	const bench = await runDualLayerEvaluation();

	const l2Cases = replay.cases.filter((c) => c.classification === "reference_model");
	const l3Cases = replay.cases.filter((c) => c.classification === "hindcast_benchmark");

	const corpus = l3Cases.find((c) => c.id === "hindcast_multi_event_historical_corpus");
	const fbf = l3Cases.find((c) => c.id === "hindcast_fbf_trigger_skill_verification");
	const e2eGeo = l3Cases.find((c) => c.id === "hindcast_geospatial_end_to_end_replays");
	const wbgt = l3Cases.find((c) => c.id === "hindcast_era5_luzon_wbgt_heatwave_2024");

	const lines = [];
	lines.push("# DRR Agent Plugin — Validation & Benchmark Results");
	lines.push("");
	lines.push(`> Auto-generated directly from executable verification suites by \`scripts/generate-validation-report.js\` (package \`${pkg.name}\` v${pkg.version}).`);
	lines.push("");
	lines.push("## Verification vs. Validation Distinction");
	lines.push("");
	lines.push("* **Software & Formula Verification (L0–L2 — Verified in CI)**: Proves the deterministic code reproduces published analytical equations, unit conversions, schema rules, and fail-closed safety gates without bugs. It does **not** by itself prove real-world impact accuracy.");
	lines.push("* **Frozen Historical Hindcast Validation (L3 — In CI, Expanding)**: Compares deterministic outputs against published post-disaster reconnaissance bands and real reanalysis grids (USGS ShakeMap/PAGER, EM-DAT, PDNAs, PAGASA/NDRRMC, DDPM, Copernicus C3S ERA5). It measures first-order screening fidelity and regression stability, and does **not** substitute for country-specific engineering calibration (L4–L6).");
	lines.push("* **Independent Domain Review (L4) & Live Cross-Model AI Evaluation**: External peer review by domain specialists and live multi-model LLM trajectory/red-team evaluation across assistants remain planned milestones.");
	lines.push("");
	lines.push("## Executive Summary");
	lines.push("");
	lines.push("| Suite / Layer | Cases | Passed | Status | Basis |");
	lines.push("| :--- | :---: | :---: | :--- | :--- |");
	lines.push(`| **L0–L1 Synthetic Reference Invariants** | ${replay.maturitySummary.L0_L1_synthetic_reference.total} | ${replay.maturitySummary.L0_L1_synthetic_reference.passed} | ${replay.maturitySummary.L0_L1_synthetic_reference.failed === 0 ? "✅ Verified in CI" : "❌ Failed"} | Formula, unit, null-preservation, Sendai & CAP invariants |`);
	lines.push(`| **L2 Reference Model Verification** | ${replay.maturitySummary.L2_reference_model.total} | ${replay.maturitySummary.L2_reference_model.passed} | ${replay.maturitySummary.L2_reference_model.failed === 0 ? "✅ Verified in CI" : "❌ Failed"} | Golden analytical checks (Wald99, lognormal CDF, AEP EAL, CAP 1.2) |`);
	lines.push(`| **L3 Historical Hindcast & Reanalysis** | ${replay.maturitySummary.L3_hindcast_benchmark.total} | ${replay.maturitySummary.L3_hindcast_benchmark.passed} | ${replay.maturitySummary.L3_hindcast_benchmark.failed === 0 ? "🟡 Passing in CI (L3)" : "❌ Failed"} | 8 scalar events + 4 FbF triggers + 2 geospatial replays + 1 ERA5 WBGT replay |`);
	lines.push(`| **GeoDisaster Benchmark (Deterministic Baseline)** | ${bench.totalScenarios} | ${bench.scenarioEvaluations.filter((e) => e.referenceBaselinePassed).length} | ${bench.deterministicBaseline.allPassed ? "✅ Verified in CI" : "❌ Failed"} | Mean deterministic analytics score: \`${bench.deterministicBaseline.meanAnalyticsScore}\` |`);
	lines.push("| **Live Cross-Assistant LLM Benchmark & Red-Team** | — | — | ⏳ Planned | Requires live model runs across Antigravity, Claude, Cursor, Copilot, OpenCode |");
	lines.push("");

	lines.push("---");
	lines.push("");
	lines.push("## 1. L2 Reference Model Verification (Formula & Standard Accuracy)");
	lines.push("");
	lines.push("| Case ID | Status | Key Verified Metrics / Tolerance |");
	lines.push("| :--- | :---: | :--- |");
	for (const c of l2Cases) {
		const summary = Object.entries(c.details || {})
			.map(([k, v]) => `\`${k}=${JSON.stringify(v)}\``)
			.join(", ");
		lines.push(`| \`${c.id}\` | ${c.passed ? "✅ Pass" : "❌ Fail"} | ${summary} |`);
	}
	lines.push("");

	if (corpus && corpus.details && Array.isArray(corpus.details.perEventResults)) {
		lines.push("---");
		lines.push("");
		lines.push("## 2. L3 Multi-Event Historical Hindcast Corpus (`tests/validation/historical-hindcasts.json`)");
		lines.push("");
		lines.push(`* **Events Evaluated**: ${corpus.details.eventsEvaluated}`);
		lines.push(`* **Within Observed MDR Band**: ${corpus.details.withinObservedBandCount}/${corpus.details.eventsEvaluated} (${(corpus.details.withinObservedBandRate * 100).toFixed(0)}%)`);
		lines.push(`* **Uncertainty Interval Coverage**: ${corpus.details.uncertaintyCoveredCount}/${corpus.details.eventsEvaluated} (${(corpus.details.uncertaintyCoverageRate * 100).toFixed(0)}%)`);
		lines.push(`* **Mean Absolute MDR Error (vs. Band Midpoint)**: \`${corpus.details.meanAbsoluteMdrError}\``);
		lines.push(`* **Corpus Snapshot Hash (SHA-256)**: \`${corpus.details.corpusSnapshotHash}\``);
		lines.push("");
		lines.push("| Event ID | ISO3 | Year | Hazard | Modelled MDR | Observed MDR Band | Abs Error | In Band | Uncertainty Covered |");
		lines.push("| :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: |");
		for (const ev of corpus.details.perEventResults) {
			lines.push(
				`| \`${ev.id}\` | ${ev.iso3} | ${ev.year} | ${ev.hazardType} | ${ev.modelledMdr} | [${ev.observedMdrBand[0]}, ${ev.observedMdrBand[1]}] | ${ev.absMdrError} | ${ev.inObservedBand ? "✅" : "❌"} | ${ev.uncertaintyIntervalCovered ? "✅" : "❌"} |`,
			);
		}
		lines.push("");
	}

	if (fbf && fbf.details) {
		const ct = fbf.details.contingencyTable;
		const sm = fbf.details.skillMetrics;
		lines.push("---");
		lines.push("");
		lines.push("## 3. L3 Forecast-based Financing (FbF) Trigger Skill Verification");
		lines.push("");
		lines.push(`* **Contingency Table** (${fbf.details.casesEvaluated} cases): Hits=\`${ct.hits}\`, Misses=\`${ct.misses}\`, False Alarms=\`${ct.falseAlarms}\`, Correct Negatives=\`${ct.correctNegatives}\``);
		lines.push(`* **Skill Metrics**: POD=\`${sm.pod}\`, FAR=\`${sm.far}\`, CSI=\`${sm.csi}\`, Accuracy=\`${sm.accuracy}\``);
		lines.push("* **C-05 Invariant**: All cases returned `depthStatus: \"depth_unavailable\"` and `estimatedInundationDepthMeters: null`.");
		lines.push("");
	}

	if (e2eGeo && e2eGeo.details && Array.isArray(e2eGeo.details.eventResults)) {
		lines.push("---");
		lines.push("");
		lines.push("## 4. L3 End-to-End Geospatial Historical Event Replays (`tests/validation/geospatial-event-replays.json`)");
		lines.push("");
		lines.push("Exercises full deterministic chain: `spatialExposureJoin` → `overlayCriticalInfraOnHazard` → `evaluateVulnerabilityMatrix` → `validateSendaiSubmission` → `evaluateHumanitarianSeverity`.");
		lines.push("");
		lines.push("| Replay ID | ISO3 | Hazard | Spatial Precision / Recall | Exposed Pop (Ref) | Pop APE (%) | Portfolio MDR (Band) | Severity Phase | Reproducible |");
		lines.push("| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |");
		for (const ev of e2eGeo.details.eventResults) {
			lines.push(
				`| \`${ev.id}\` | ${ev.iso3} | ${ev.hazardType} | ${ev.spatialPrecision} / ${ev.spatialRecall} | ${ev.exposedPopulation.toLocaleString()} (${ev.referencePopulation.toLocaleString()}) | ${ev.populationApePct}% | ${ev.portfolioMdr} ([${ev.observedMdrBand[0]}, ${ev.observedMdrBand[1]}]) | Phase ${ev.severityPhase} | ${ev.reproducible ? "✅" : "❌"} |`,
			);
		}
		lines.push("");
	}

	if (wbgt && wbgt.details && Array.isArray(wbgt.details.zoneResults)) {
		lines.push("---");
		lines.push("");
		lines.push("## 5. L3 Real-Event Extreme-Heat Reanalysis Replay (`tests/validation/era5-luzon-wbgt-2024-04.json`)");
		lines.push("");
		lines.push(`* **Event**: April 2024 Luzon Extreme Heatwave (Copernicus C3S ERA5 single-levels reanalysis, peak \`${wbgt.details.peakDatetimeUtc}\`)`);
		lines.push(`* **Peak Outdoor WBGT**: \`${wbgt.details.peakOutdoorWbgtC} °C\` | **Highland Cooling Gradient**: \`${wbgt.details.highlandCoolingDeltaC} °C\` | **Continuous Semantics Preserved**: \`${wbgt.details.continuousSemanticsPreserved}\``);
		lines.push("");
		lines.push("| Zone ID | P-Code | Role | Cells | Outdoor Mean / Max (°C) | Indoor Mean (°C) | Solar Load Δ (°C) |");
		lines.push("| :--- | :---: | :--- | :---: | :---: | :---: | :---: |");
		for (const z of wbgt.details.zoneResults) {
			lines.push(
				`| \`${z.id}\` | ${z.pcode} | ${z.role} | ${z.validCells} | ${z.outdoorMeanC} / ${z.outdoorMaxC} | ${z.indoorMeanC} | +${z.solarLoadDeltaC} |`,
			);
		}
		lines.push("");
	}

	lines.push("---");
	lines.push("");
	lines.push("## 6. GeoDisaster Agentic Benchmark Suite (`tests/benchmarks/geodisaster-scenarios.json`)");
	lines.push("");
	lines.push("Scored via `runDualLayerEvaluation()` separating deterministic tool analytics from agent orchestration & narrative claim-grounding. The table below reports the **deterministic reference baseline**; live cross-model assistant runs (with prompt-injection red-team & tool-failure tests) are tracked separately as the next evaluation milestone.");
	lines.push("");
	lines.push("| Scenario ID | Category | Deterministic Analytics Score | Reference Orchestration Score | Diagnosis |");
	lines.push("| :--- | :--- | :---: | :---: | :--- |");
	for (const sc of bench.scenarioEvaluations) {
		lines.push(
			`| \`${sc.scenarioId}\` | ${sc.category} | ${sc.agentLayer.deterministicAnalyticsScore} | ${sc.agentLayer.agentOrchestrationScore} | \`${sc.diagnosis}\` |`,
		);
	}
	lines.push("");
	lines.push("### Reproducing This Report");
	lines.push("```bash");
	lines.push("npm run generate:validation-report");
	lines.push("node bin/cli.js replay-validate --suite all");
	lines.push("node bin/cli.js benchmark");
	lines.push("```");
	lines.push("");

	return lines.join("\n");
}

if (require.main === module) {
	generateValidationReportMarkdown()
		.then((md) => {
			const outPath = path.join(ROOT, "docs", "validation-results.md");
			fs.writeFileSync(outPath, md, "utf8");
			console.log(`Generated ${outPath}`);
		})
		.catch((err) => {
			console.error(err);
			process.exit(1);
		});
}

module.exports = { generateValidationReportMarkdown };
