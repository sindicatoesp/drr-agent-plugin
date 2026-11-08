const assert = require("assert");
const { estimatePgaFromMmi, parseUsgsFeed } = require("../lib/usgs");

console.log("Testing USGS Earthquake Feed & PGA Ground Motion Estimations...");

// 1. Test MMI to PGA (g) empirical estimator
const pgaMmi5 = estimatePgaFromMmi(5.0);
assert(pgaMmi5 > 0.05 && pgaMmi5 < 0.15, `Expected MMI V PGA to be ~0.08g, got ${pgaMmi5}`);

const pgaMmi8 = estimatePgaFromMmi(8.0);
assert(pgaMmi8 > 0.40 && pgaMmi8 < 0.70, `Expected MMI VIII PGA to be ~0.54g, got ${pgaMmi8}`);

// 2. Parse sample USGS GeoJSON fixture
const sampleUsgs = {
	type: "FeatureCollection",
	features: [
		{
			type: "Feature",
			id: "us7000m8v7",
			properties: {
				mag: 6.8,
				place: "15 km SW of Port-Vila, Vanuatu",
				time: 1730000000000,
				mmi: 7.2,
				alert: "orange",
				tsunami: 0,
				status: "reviewed",
				url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000m8v7",
			},
			geometry: {
				type: "Point",
				coordinates: [168.21, -17.85, 35.0],
			},
		},
		{
			type: "Feature",
			id: "us2000low",
			properties: {
				mag: 3.2,
				place: "Minor event",
				time: 1730000000000,
			},
			geometry: {
				type: "Point",
				coordinates: [160.0, -10.0, 10.0],
			},
		},
	],
};

const parsed = parseUsgsFeed(sampleUsgs, { minMagnitude: 5.0 });
assert.strictEqual(parsed.length, 1, "Only M5.0+ should be included");
assert.strictEqual(parsed[0].usgsId, "us7000m8v7");
assert.strictEqual(parsed[0].magnitude, 6.8);
assert(parsed[0].estimatedPgaG > 0.25, "Estimated PGA should be > 0.25g");
assert.strictEqual(parsed[0].depthKm, 35.0);

console.log("✅ USGS tests passed!");
