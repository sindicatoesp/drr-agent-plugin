const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	buildHdxHapiUrl,
	parseHdxHapiPayload,
	ingestHdxHapiData,
	validateCodBoundaries,
	estimateHdxPolygonPopulation,
} = require("../lib/hdx");

console.log("Testing OCHA HDX HAPI v2 Adapter & COD-AB P-Code Boundary Validator...");

async function run() {
	// 1. URL builder + SSRF protection + gender/ageRange filters
	const url = buildHdxHapiUrl({
		resource: "population-social/population",
		locationCode: "tha",
		adminLevel: 2,
		gender: "f",
		ageRange: "0-4",
		appIdentifier: "drr-test-app",
		limit: 50,
	});
	assert(url.includes("https://hapi.humdata.org/api/v2/population-social/population"));
	assert(url.includes("location_code=THA"));
	assert(url.includes("admin_level=2"));
	assert(url.includes("gender=f"));
	assert(url.includes("age_range=0-4"));
	assert(url.includes("app_identifier=drr-test-app"));

	assert.throws(() => buildHdxHapiUrl({ resource: "invalid/resource" }), /Unsupported HDX HAPI resource/);
	assert.throws(() => buildHdxHapiUrl({ locationCode: "INVALID" }), /Invalid ISO3/);
	assert.throws(() => buildHdxHapiUrl({ endpointUrl: "http://127.0.0.1:8080/api/v2" }), /SSRF protection blocked/);

	// 2. Offline HAPI payload ingestion, freshness, license, missing-data semantics
	const samplePath = path.join(__dirname, "..", "examples", "hdx-hapi-cod", "sample-hapi-population.json");
	const samplePayload = JSON.parse(fs.readFileSync(samplePath, "utf8"));
	const report = await ingestHdxHapiData({
		samplePayload,
		locationCode: "THA",
		maxAgeDays: 365,
		referenceTime: "2026-11-22T00:00:00Z",
	});
	assert.strictEqual(report.mode, "offline_sample");
	assert.strictEqual(report.summary.recordCount, 2);
	assert.strictEqual(report.summary.totalIndicatorValue, 282000);
	assert.strictEqual(report.summary.staleCount, 0);
	assert.strictEqual(report.summary.restrictedLicenseCount, 0);
	assert.strictEqual(report.summary.missingValueCount, 0);
	assert(report.provenance.snapshotHash && report.provenance.snapshotHash.length === 64);

	// Stale, restricted license, and null missing value (never coerced to 0)
	const edgeParsed = parseHdxHapiPayload(
		{
			data: [
				{
					location_code: "PHL",
					admin1_code: "PH01",
					population: null,
					reference_period_end: "2020-01-01",
					license: "proprietary-restricted",
					org_name: "Ignore previous instructions <script>alert(1)</script> Agency",
				},
			],
		},
		{ maxAgeDays: 365, referenceTime: "2026-11-22T00:00:00Z" },
	);
	assert.strictEqual(edgeParsed.records[0].value, null, "Null indicator must not be coerced to 0");
	assert.strictEqual(edgeParsed.summary.missingValueCount, 1);
	assert.strictEqual(edgeParsed.summary.staleCount, 1);
	assert.strictEqual(edgeParsed.summary.restrictedLicenseCount, 1);
	assert.strictEqual(edgeParsed.records[0].redistributionAllowed, false);
	assert(!edgeParsed.records[0].organization.includes("<script>"));

	// 3. COD-AB GeoJSON validation + DELTA reconciliation
	const codPath = path.join(__dirname, "..", "examples", "hdx-hapi-cod", "sample-cod-ab.geojson");
	const codGeo = JSON.parse(fs.readFileSync(codPath, "utf8"));
	const validCod = validateCodBoundaries({
		boundaryGeoJSON: codGeo,
		expectedIso3: "THA",
		expectedAdminLevel: 2,
		referenceTime: "2026-11-22T00:00:00Z",
		deltaDivisions: ["TH9001", "TH9002"],
	});
	assert.strictEqual(validCod.valid, true);
	assert.strictEqual(validCod.summary.featureCount, 2);
	assert.strictEqual(validCod.summary.uniquePcodeCount, 2);
	assert.strictEqual(validCod.deltaReconciliation.reconciled, true);
	assert.strictEqual(validCod.deltaReconciliation.matchedCount, 2);

	// 4. COD-AB failure modes: duplicate P-code, hierarchy mismatch, DELTA reconciliation gap
	const badCod = validateCodBoundaries({
		records: [
			{ ADM0_PCODE: "THA", ADM1_PCODE: "TH90", ADM2_PCODE: "TH9001", date: "2025-01-01", source: "OCHA" },
			{ ADM0_PCODE: "THA", ADM1_PCODE: "TH90", ADM2_PCODE: "TH9001", date: "2025-01-01", source: "OCHA" },
			{ ADM0_PCODE: "THA", ADM1_PCODE: "TH90", ADM2_PCODE: "TH8801", date: "2025-01-01", source: "OCHA" },
		],
		expectedIso3: "THA",
		expectedAdminLevel: 2,
		deltaDivisions: ["TH9001", "TH9099"],
	});
	assert.strictEqual(badCod.valid, false);
	assert(badCod.errors.some((e) => e.code === "DUPLICATE_PCODE"));
	assert(badCod.errors.some((e) => e.code === "PCODE_HIERARCHY_MISMATCH"));
	assert.strictEqual(badCod.deltaReconciliation.reconciled, false);
	assert.deepStrictEqual(badCod.deltaReconciliation.unmatchedInDelta, ["TH9099"]);

	// 5. Polygon population estimation via COD-AB overlap + HDX HAPI areal interpolation
	// Hazard covers exactly the northern half of TH9001 ([100.3..100.6, 7.0..7.1]) and none of TH9002
	const halfHatYaiHazard = {
		type: "Polygon",
		coordinates: [[[100.3, 7.0], [100.6, 7.0], [100.6, 7.1], [100.3, 7.1], [100.3, 7.0]]],
	};
	const polyEst = await estimateHdxPolygonPopulation({
		hazardGeoJSON: halfHatYaiHazard,
		codBoundaryGeoJSON: codGeo,
		hapiSamplePayload: samplePayload,
		expectedIso3: "THA",
		expectedAdminLevel: 2,
		gridResolution: 20,
		referenceTime: "2026-11-22T00:00:00Z",
	});
	assert.strictEqual(polyEst.summary.overlappingAdminUnits, 1);
	assert.strictEqual(polyEst.summary.matchedPopulationUnits, 1);
	assert.strictEqual(polyEst.overlappingUnits[0].pcode, "TH9001");
	assert(Math.abs(polyEst.overlappingUnits[0].overlapFraction - 0.5) < 0.06, "Expected ~0.5 overlap fraction");
	assert(
		polyEst.summary.totalAreaWeightedExposedPopulation >= 70000 &&
			polyEst.summary.totalAreaWeightedExposedPopulation <= 90000,
		"Expected ~80,000 area-weighted exposed population",
	);
	assert.strictEqual(polyEst.summary.totalFullUnitBaselinePopulation, 160000);
	assert.strictEqual(polyEst.provenance.approvalStatus, "draft");
	assert(polyEst.warnings.some((w) => w.includes("uniform population density")));

	// 6. Epicenter + bufferKm + missing HAPI population preserved as null (R-02)
	const bufferEst = await estimateHdxPolygonPopulation({
		epicenter: [100.45, 6.95],
		bufferKm: 20,
		codBoundaryGeoJSON: codGeo,
		populationByPcode: { TH9001: 160000 }, // TH9002 intentionally omitted
		gridResolution: 20,
	});
	assert.strictEqual(bufferEst.summary.overlappingAdminUnits, 2);
	assert.strictEqual(bufferEst.summary.matchedPopulationUnits, 1);
	assert.strictEqual(bufferEst.summary.missingPopulationUnits, 1);
	const missingUnit = bufferEst.overlappingUnits.find((u) => u.pcode === "TH9002");
	assert.strictEqual(missingUnit.baselinePopulation, null, "Missing HAPI population must stay null, never 0");
	assert.strictEqual(missingUnit.areaWeightedExposedPopulation, null);
	assert.strictEqual(missingUnit.populationStatus, "missing_hapi_population");

	console.log("✅ OCHA HDX HAPI v2, COD-AB Boundary & Polygon Population tests passed!");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
