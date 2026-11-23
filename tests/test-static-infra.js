const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
	parseCsv,
	parseWriPowerPlantsCsv,
	parseOurAirportsCsv,
	tileBoundingBox,
	buildGlobalStaticInfra,
	buildRegionalStaticInfra,
} = require("../scripts/build-static-infra");

async function run() {
	console.log("Testing Static Critical Infrastructure Builder (Global & Regional)...");

	// 1. RFC 4180 CSV parsing with quoted commas
	const sampleCsv = [
		'country,country_long,name,gppd_idnr,capacity_mw,latitude,longitude,primary_fuel,owner',
		'THA,Thailand,"Mae Moh, Unit 1",WRI0001,2400,18.296,99.751,Coal,"EGAT"',
		'USA,United States of America,Grand Coulee,WRI0002,6809,47.956,-118.981,Hydro,USBR',
	].join("\n");
	const rows = parseCsv(sampleCsv);
	assert.strictEqual(rows.length, 2);
	assert.strictEqual(rows[0].name, "Mae Moh, Unit 1");

	// 2. WRI Global Power Plant normalization + country filter
	const allPlants = parseWriPowerPlantsCsv(sampleCsv);
	assert.strictEqual(allPlants.length, 2);
	assert.strictEqual(allPlants[0].properties.sector, "energy");
	assert.strictEqual(allPlants[0].properties.license, "CC-BY-4.0");
	assert.strictEqual(allPlants[0].properties.verificationStatus, "external_unverified");

	const thaPlants = parseWriPowerPlantsCsv(sampleCsv, { countries: ["THA"] });
	assert.strictEqual(thaPlants.length, 1);
	assert.strictEqual(thaPlants[0].properties.country, "THA");

	// 3. OurAirports normalization (filters to large_airport + medium_airport by default)
	const airportsCsv = [
		'id,ident,type,name,latitude_deg,longitude_deg,iso_country,municipality,iata_code',
		'1,VTBS,large_airport,Suvarnabhumi Airport,13.6811,100.7473,TH,Bangkok,BKK',
		'2,VTSS,medium_airport,Hat Yai International Airport,6.9332,100.3930,TH,Hat Yai,HDY',
		'3,VTS9,small_airport,Tiny Airstrip,7.0000,100.5000,TH,Songkhla,',
	].join("\n");
	const airports = parseOurAirportsCsv(airportsCsv);
	assert.strictEqual(airports.length, 2, "Should include large & medium airports and skip small_airport");
	assert.strictEqual(airports[0].properties.sector, "transport");
	assert.strictEqual(airports[0].properties.iata_code, "BKK");

	// 4. BBox tiling for regional Overpass extracts
	const tiles = tileBoundingBox([97.0, 5.0, 105.0, 13.0], 4.0);
	assert.strictEqual(tiles.length, 4, "8x8 deg bbox tiled at 4 deg must produce 4 tiles");
	for (const [w, s, e, n] of tiles) {
		assert(e - w <= 4.0001 && n - s <= 4.0001, "Each tile must be <= 4.0 deg span");
	}

	// 5. Offline Global build merging local WRI + OurAirports + extra GeoJSON
	const tmpDir = path.join(os.tmpdir(), `drr-static-infra-${Date.now()}`);
	fs.mkdirSync(tmpDir, { recursive: true });
	const wriFile = path.join(tmpDir, "wri.csv");
	const airportsFile = path.join(tmpDir, "airports.csv");
	fs.writeFileSync(wriFile, sampleCsv, "utf8");
	fs.writeFileSync(airportsFile, airportsCsv, "utf8");

	const globalBundle = await buildGlobalStaticInfra({ wriFile, airportsFile });
	assert.strictEqual(globalBundle.type, "FeatureCollection");
	assert.strictEqual(globalBundle.metadata.totalFeatures, 4);
	assert.strictEqual(globalBundle.metadata.sectorCounts.energy, 2);
	assert.strictEqual(globalBundle.metadata.sectorCounts.transport, 2);
	assert.strictEqual(globalBundle.metadata.sources.length, 2);

	// 6. Offline Regional build from local Overpass JSON fixture
	const overpassFixture = path.join(
		__dirname,
		"..",
		"examples",
		"critical-infra-overlay",
		"sample-osm-overpass.json",
	);
	const regionalBundle = await buildRegionalStaticInfra({ overpassFile: overpassFixture });
	assert.strictEqual(regionalBundle.type, "FeatureCollection");
	assert.strictEqual(regionalBundle.metadata.totalFeatures, 5);
	assert.strictEqual(regionalBundle.metadata.sources[0].license, "ODbL-1.0");

	fs.rmSync(tmpDir, { recursive: true, force: true });
	console.log("✅ Static Critical Infrastructure Builder tests passed!");
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
