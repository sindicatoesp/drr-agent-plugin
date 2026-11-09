const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spatialExposureJoin } = require("../lib/spatial");
const { evaluateVulnerabilityMatrix } = require("../lib/vulnerability");
const { generateVisualSitRepHtml, generateEmergencyBrief } = require("../lib/cap");

console.log("Testing Southern Thailand Catastrophic Flood Hindcast Regression Benchmark...");

const scenarioDir = path.join(__dirname, "../examples/thailand-flood-scenario");
const hazardGeoJson = JSON.parse(fs.readFileSync(path.join(scenarioDir, "input-hazard.json"), "utf8"));
const exposureGeoJson = JSON.parse(fs.readFileSync(path.join(scenarioDir, "input-exposure.json"), "utf8"));

// 1. Spatial Join Verification
const spatialReport = spatialExposureJoin(hazardGeoJson, exposureGeoJson);

assert.strictEqual(spatialReport.summary.totalAssetsEvaluated, 8, "Expected 8 total evaluated assets");
assert.strictEqual(spatialReport.summary.totalExposedAssets, 8, "Expected 8 total exposed assets");
assert.strictEqual(spatialReport.summary.totalExposedPopulation, 18610, "Target B exposed population mismatch");
assert.strictEqual(spatialReport.summary.totalExposedAssetValueUsd, 201500000, "Total exposed value mismatch");

// 2. Vulnerability & Damage Assessment at 2.2m Inundation Depth
const vulnerabilityReport = evaluateVulnerabilityMatrix(spatialReport, {
	type: "flood",
	intensity: 2.2
});

const sendai = vulnerabilityReport.sendaiFrameworkMetrics;

// Target B: Exposed and Displaced Population
assert.strictEqual(sendai.targetB_AffectedPeople.totalExposedPopulation, 18610);
assert.strictEqual(sendai.targetB_AffectedPeople.estimatedDisplacedPopulation, 16749, "Target B displaced population mismatch");

// Target C: Direct Economic Physical Losses
assert.strictEqual(sendai.targetC_DirectEconomicLoss.estimatedDirectEconomicLossUsd, 127025600, "Target C USD loss mismatch");
assert.strictEqual(sendai.targetC_DirectEconomicLoss.aggregateLossRatioPercentage, 63.04, "Loss ratio percentage mismatch");

// Target D: Damaged Critical Essential Infrastructure
assert.strictEqual(sendai.targetD_CriticalInfrastructure.totalDamagedFacilities, 7, "Target D damaged facilities mismatch");

// 3. Situation Report & Cartographic Map Layout Verification
const sitrepContext = {
	hazard: {
		eventName: "Southern Thailand Catastrophic Flood",
		country: "Southern Thailand",
		alertLevel: "Red",
		hazardType: "flood",
		hazardIntensity: 2.2,
		intensityUnit: "m"
	},
	vulnerability: vulnerabilityReport,
	spatial: spatialReport
};

const sitrepHtml = generateVisualSitRepHtml(sitrepContext);

// Verify deconfliction, table row IDs, and data attributes exist
assert(sitrepHtml.includes('class="sitrep-asset-row"'), "SitRep must contain accessible interactive table rows");
assert(sitrepHtml.includes('id="asset-row-0"'), "SitRep must contain unique row ID for bidirectional sync");
assert(sitrepHtml.includes('cleanLabelName'), "SitRep must include cartographic label cleaning helper");
assert(sitrepHtml.includes('clusterRadius'), "SitRep must include cluster detection");
assert(sitrepHtml.includes('candidateDirs'), "SitRep must include multi-candidate Imhof label placement");
assert(sitrepHtml.includes('sitrepBasemapSelect'), "SitRep must include basemap selector dropdown");

// 4. Executive Brief Text Verification
const briefMd = generateEmergencyBrief(sitrepContext);

assert(briefMd.includes("**flood**") || briefMd.toLowerCase().includes("flood"), "Brief must identify flood event type");
assert(briefMd.includes("18,610"), "Brief must include exact exposed population");
assert(briefMd.includes("16,749"), "Brief must include exact displaced population");
assert(briefMd.includes("127,025,600"), "Brief must include exact direct loss USD");
assert(briefMd.includes("7 facilities"), "Brief must report exact Target D facility damage");

console.log("✅ Southern Thailand Hindcast Regression & Cartographic Verification tests passed!");
