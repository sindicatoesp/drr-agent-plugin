const assert = require("assert");
const { buildRelationalRecordBundle, pushDraftDisasterRecord, fetchExposureFromDelta, mapAssetCategoryToSector } = require("../lib/delta");

console.log("Testing Advanced DELTA Relational Bundle & Ingestion Logic...");

// 1. Test Sector Mapping
assert.strictEqual(mapAssetCategoryToSector("healthcare"), "Healthcare");
assert.strictEqual(mapAssetCategoryToSector("school"), "Education");
assert.strictEqual(mapAssetCategoryToSector("residential"), "Housing");
assert.strictEqual(mapAssetCategoryToSector("bridge"), "Transportation");

// 2. Test Complete Relational Bundle Builder
const sampleAssessment = {
	name: "Mw 7.2 Mainshock Emergency Assessment",
	eventId: "14235",
	source: "USGS",
	hazardAssessment: {
		hazardType: "earthquake",
		hazardIntensity: 0.42,
		intensityUnit: "Peak Ground Acceleration (g)",
	},
	sendaiFrameworkMetrics: {
		targetB_AffectedPeople: {
			totalExposedPopulation: 11495,
			estimatedDisplacedPopulation: 9585,
		},
		targetC_DirectEconomicLoss: {
			totalExposedAssetValueUsd: 111500000,
			estimatedDirectEconomicLossUsd: 49428050,
			aggregateLossRatioPercentage: 44.33,
		},
		targetD_CriticalInfrastructure: {
			totalDamagedFacilities: 3,
		},
	},
	topDamagedAssets: [
		{ name: "Central Hospital", category: "healthcare", meanDamageRatio: 0.52, estimatedLossUsd: 33000000 },
		{ name: "Public High School", category: "education", meanDamageRatio: 0.45, estimatedLossUsd: 4500000 },
	],
	hazardGeoJSON: {
		type: "Polygon",
		coordinates: [[[85.2, 27.6], [85.5, 27.6], [85.5, 27.9], [85.2, 27.9], [85.2, 27.6]]],
	},
};

const bundle = buildRelationalRecordBundle(sampleAssessment);

assert.strictEqual(bundle.apiImportId, "drr_earthquake_14235");
assert.strictEqual(bundle.parentEvent.status, "draft");
assert.strictEqual(bundle.parentEvent.source, "drr-agent-plugin");
assert.strictEqual(bundle.disasterRecord.approvalStatus, "draft");
assert.strictEqual(bundle.disasterRecord.originatorRecorderInst, "UNDRR DRR Agent Plugin");
assert.strictEqual(bundle.disasterRecord.primaryDataSource, "USGS");

// Test Human Effects
assert.strictEqual(bundle.humanEffects.length, 2);
const displacedHe = bundle.humanEffects.find((h) => h.table === "Displaced");
assert.strictEqual(displacedHe.count, 9585);
const affectedHe = bundle.humanEffects.find((h) => h.table === "Affected");
assert.strictEqual(affectedHe.count, 11495);

// Test Sector Relations
assert.strictEqual(bundle.sectorRelations.length, 2);
const healthSector = bundle.sectorRelations.find((s) => s.sectorName === "Healthcare");
assert.strictEqual(healthSector.totalEstimatedLossUsd, 33000000);

// Test PostGIS Geometry
assert.strictEqual(bundle.postGisGeom.srid, 4326);
assert.strictEqual(bundle.postGisGeom.geometry.type, "Polygon");

// 3. Test pushDraftDisasterRecord in Mock Mode
async function testPush() {
	const result = await pushDraftDisasterRecord(sampleAssessment, { mock: true });
	assert.strictEqual(result.success, true);
	assert.strictEqual(result.status, "draft");
	assert.strictEqual(result.apiImportId, "drr_earthquake_14235");
	assert.strictEqual(result.entities.humanEffects.length, 2);
	assert.strictEqual(result.entities.sectorRelations.length, 2);
	assert(result.notes.includes("drr-agent-plugin"));

	// 4. Test Country Guard (DELTA is a country-level software)
	const matchedCountryResult = await pushDraftDisasterRecord(
		{ ...sampleAssessment, country: "Vanuatu" },
		{ mock: true, targetCountries: ["Vanuatu", "VU"], strictCountryMatch: true },
	);
	assert.strictEqual(matchedCountryResult.success, true, "Matching country must succeed");

	const mismatchedCountryResult = await pushDraftDisasterRecord(
		{ ...sampleAssessment, country: "Chile" },
		{ mock: true, targetCountries: ["Vanuatu", "VU"], strictCountryMatch: true },
	);
	assert.strictEqual(mismatchedCountryResult.success, false, "Mismatched country must not push to DELTA");
	assert.strictEqual(mismatchedCountryResult.skipped, true);
	assert.strictEqual(mismatchedCountryResult.reason, "country_mismatch");

	// 5. Test fetchExposureFromDelta in Mock Mode
	const exp = await fetchExposureFromDelta("division", {}, { mock: true });
	assert.strictEqual(exp.items.length, 2);

	console.log("✅ Advanced DELTA Relational tests passed!");
}

testPush().catch((err) => {
	console.error(err);
	process.exit(1);
});
