const assert = require("assert");
const {
	buildRelationalRecordBundle,
	pushDraftDisasterRecord,
	fetchExposureFromDelta,
	mapAssetCategoryToSector,
	fetchDeltaDocs,
	fetchDeltaHazards,
	fetchDeltaDimensions,
	lookupHip,
	findHipHazards,
	getAllHipTypes,
	getAllHipClusters,
	getAllHipHazards,
} = require("../lib/delta");

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

// Test UNDRR/ISC HIP Hazard Mapping on both record and event
assert.strictEqual(bundle.disasterRecord.hipHazardId, "78531", "Earthquake hipHazardId must be 78531 (GH0001)");
assert.strictEqual(bundle.disasterRecord.hipClusterId, "1068", "Earthquake hipClusterId must be 1068 (Seismogenic)");
assert.strictEqual(bundle.disasterRecord.hipTypeId, "1041", "Earthquake hipTypeId must be 1041 (Geological)");
assert.strictEqual(bundle.parentEvent.hipHazardId, "78531", "Parent event hipHazardId must be 78531");
assert.strictEqual(bundle.parentEvent.hipClusterId, "1068", "Parent event hipClusterId must be 1068");
assert.strictEqual(bundle.parentEvent.hipTypeId, "1041", "Parent event hipTypeId must be 1041");

// Test Additional HIP Mappings (Flood, Cyclone, Wildfire)
const floodBundle = buildRelationalRecordBundle({
	hazardAssessment: { hazardType: "flood" },
});
assert.strictEqual(floodBundle.disasterRecord.hipHazardId, "78572");
assert.strictEqual(floodBundle.disasterRecord.hipClusterId, "1072");
assert.strictEqual(floodBundle.disasterRecord.hipTypeId, "1042");

const cycloneBundle = buildRelationalRecordBundle({
	hazardAssessment: { hazardType: "cyclone" },
});
assert.strictEqual(cycloneBundle.disasterRecord.hipHazardId, "78622");
assert.strictEqual(cycloneBundle.disasterRecord.hipClusterId, "1079");
assert.strictEqual(cycloneBundle.disasterRecord.hipTypeId, "1042");

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

	const hipExp = await fetchExposureFromDelta("hip-hazard", {}, { mock: true });
	assert.strictEqual(hipExp.items.length, 3);
	assert.strictEqual(hipExp.items[0].code, "GH0001");

	// 6. Test fetchDeltaDocs in Mock Mode
	const docs = await fetchDeltaDocs({ mock: true });
	assert(docs.text.includes("DTS Data Model"), "DTS Data Model docs must be returned");
	assert(docs.text.includes("hip-hazard_list"), "Docs must reference hip-hazard_list tool");

	// 7. Test fetchDeltaHazards in Mock Mode
	const hazards = await fetchDeltaHazards({}, { mock: true });
	assert.strictEqual(hazards.items.length, 5);
	assert.strictEqual(hazards.items[0].id, "78531");
	assert.strictEqual(hazards.items[0].name, "Earthquake");

	// 8. Test fetchDeltaDimensions in Mock Mode
	const dims = await fetchDeltaDimensions("hazards", { mock: true });
	assert.strictEqual(dims.hazards.length, 1);
	assert.strictEqual(dims.hazards[0].id, "78531");

	// 9. Test In-Code UNDRR/ISC HIP Taxonomy Database (All 8 Types, 49 Clusters, 301 Hazards)
	assert.strictEqual(getAllHipTypes().length, 8, "Expected 8 canonical HIP Types");
	assert.strictEqual(getAllHipClusters().length, 49, "Expected 49 canonical HIP Clusters");
	assert.strictEqual(getAllHipHazards().length, 301, "Expected 301 canonical HIP Hazards");

	// Test lookups across ID, Code, natural keyword, and aliases
	const eqById = lookupHip("78531");
	assert.strictEqual(eqById.code, "GH0001");
	assert.strictEqual(eqById.hipClusterId, "1068");
	assert.strictEqual(eqById.hipTypeId, "1041");

	const flByCode = lookupHip("MH0007");
	assert.strictEqual(flByCode.name, "Fluvial (Riverine) Flood");
	assert.strictEqual(flByCode.hipHazardId, "78572");

	const cyByAlias = lookupHip("tropical_cyclone");
	assert.strictEqual(cyByAlias.code, "MH0057");
	assert.strictEqual(cyByAlias.hipHazardId, "78622");

	const lsByKeyword = lookupHip("landslide");
	assert.strictEqual(lsByKeyword.code, "GH0007");
	assert.strictEqual(lsByKeyword.hipHazardId, "78537");

	// 10. Test In-Code Taxonomy Filter & Local Search
	const floodSearch = findHipHazards({ search: "flood" });
	assert(floodSearch.length >= 10, "Should find at least 10 flood hazards");

	const localHazardsRes = await fetchDeltaHazards({ local: true, search: "earthquake" });
	assert.strictEqual(localHazardsRes.source, "in_code_taxonomy");
	assert(localHazardsRes.items.length >= 7);

	console.log("✅ Advanced DELTA Relational tests passed!");
}

testPush().catch((err) => {
	console.error(err);
	process.exit(1);
});
