const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
	buildOverpassEndpointUrl,
	buildOverpassQuery,
	classifyOsmTagsToSendaiSector,
	parseOverpassPayload,
	ingestOsmInterimCriticalInfra,
} = require("../lib/osm-infra");

console.log("Testing OpenStreetMap (Overpass API) Interim Critical Infrastructure Adapter...");

async function run() {
	// 1. Overpass endpoint SSRF guard & query builder bbox span guard
	const defaultEp = buildOverpassEndpointUrl();
	assert.strictEqual(defaultEp, "https://overpass-api.de/api/interpreter");
	assert.throws(() => buildOverpassEndpointUrl({ endpointUrl: "http://127.0.0.1:8080/api" }), /SSRF protection blocked/);

	const ql = buildOverpassQuery({
		bbox: [100.3, 6.9, 100.6, 7.1],
		sectors: ["health", "energy", "protective_infrastructure"],
		timeoutSec: 20,
		maxElements: 100,
	});
	assert(ql.includes("[out:json][timeout:20];"));
	assert(ql.includes("(6.9,100.3,7.1,100.6)"), "Overpass bbox must be (south,west,north,east)");
	assert(ql.includes("out center tags 100;"));

	assert.throws(() => buildOverpassQuery({ bbox: [90, 0, 100, 10] }), /exceeds maximum/);
	assert.throws(() => buildOverpassQuery({ bbox: [100.3, 6.9, 100.6, 7.1], sectors: ["bogus"] }), /Unsupported Sendai sector/);

	// 2. Tag classification across Sendai Target D sectors
	assert.strictEqual(classifyOsmTagsToSendaiSector({ amenity: "hospital" }).sector, "health");
	assert.strictEqual(classifyOsmTagsToSendaiSector({ amenity: "school" }).sector, "education");
	assert.strictEqual(classifyOsmTagsToSendaiSector({ power: "substation" }).sector, "energy");
	assert.strictEqual(classifyOsmTagsToSendaiSector({ man_made: "water_works" }).sector, "water");
	assert.strictEqual(classifyOsmTagsToSendaiSector({ man_made: "levee" }).sector, "protective_infrastructure");
	assert.strictEqual(classifyOsmTagsToSendaiSector({ aeroway: "aerodrome" }).sector, "transportation");
	assert.strictEqual(classifyOsmTagsToSendaiSector({ man_made: "communications_tower" }).sector, "telecommunications");
	assert.strictEqual(classifyOsmTagsToSendaiSector({ man_made: "wastewater_plant" }).sector, "waste_management");
	assert.strictEqual(classifyOsmTagsToSendaiSector({ amenity: "fire_station" }).sector, "other_essential");

	// 3. Offline Overpass sample parsing + interim governance metadata
	const samplePath = path.join(__dirname, "..", "examples", "critical-infra-overlay", "sample-osm-overpass.json");
	const samplePayload = JSON.parse(fs.readFileSync(samplePath, "utf8"));
	const parsed = parseOverpassPayload(samplePayload);
	assert.strictEqual(parsed.summary.totalFacilities, 5);
	assert.strictEqual(parsed.infraGeoJSON.type, "FeatureCollection");
	assert.strictEqual(parsed.infraGeoJSON.features[0].properties.license, "ODbL-1.0");
	assert.strictEqual(parsed.infraGeoJSON.features[0].properties.verificationStatus, "external_unverified");

	// 4. End-to-end interim ingestion + automatic overlay onto hazard polygon
	const hazardPolygon = {
		type: "Polygon",
		coordinates: [[[100.45, 6.99], [100.50, 6.99], [100.50, 7.02], [100.45, 7.02], [100.45, 6.99]]],
	};
	const report = await ingestOsmInterimCriticalInfra({
		samplePayload,
		hazardGeoJSON: hazardPolygon,
	});
	assert.strictEqual(report.interimFallback, true);
	assert.strictEqual(report.dataAuthority, "interim_open_source");
	assert.strictEqual(report.provenance.verificationStatus, "external_unverified");
	assert.strictEqual(report.provenance.reportingEligibility, "screening_only");
	assert.strictEqual(report.provenance.license, "ODbL-1.0");
	assert(report.overlayReport, "Expected overlayReport when hazardGeoJSON is supplied");
	assert(report.overlayReport.summary.physicallyExposedCount >= 3);
	assert(report.warnings.some((w) => w.includes("INTERIM OPEN-SOURCE FALLBACK")));

	console.log("✅ OpenStreetMap (Overpass API) Interim Critical Infrastructure tests passed!");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
