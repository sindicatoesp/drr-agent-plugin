const assert = require("assert");
const { pointInPolygonRing, isPointInGeometry, haversineDistance } = require("../lib/utils");
const { spatialExposureJoin } = require("../lib/spatial");

console.log("Testing Spatial Utilities & Exposure Joins...");

// 1. Ray-casting point in polygon
const square = [
	[0, 0],
	[10, 0],
	[10, 10],
	[0, 10],
	[0, 0],
];
assert.strictEqual(pointInPolygonRing([5, 5], square), true, "Point [5,5] must be inside square");
assert.strictEqual(pointInPolygonRing([15, 5], square), false, "Point [15,5] must be outside square");

// 2. Haversine distance
const dist = haversineDistance(0, 0, 1, 0); // 1 degree latitude ~ 111 km
assert(Math.abs(dist - 111.19) < 1.0, `Expected ~111km, got ${dist}`);

// 3. Spatial Exposure Join
const hazardPolygon = {
	type: "Feature",
	geometry: {
		type: "Polygon",
		coordinates: [[[85.0, 27.0], [86.0, 27.0], [86.0, 28.0], [85.0, 28.0], [85.0, 27.0]]],
	},
};

const assets = {
	type: "FeatureCollection",
	features: [
		{
			type: "Feature",
			properties: { name: "Hospital Inside", category: "healthcare", valueUsd: 1000000, population: 500 },
			geometry: { type: "Point", coordinates: [85.5, 27.5] },
		},
		{
			type: "Feature",
			properties: { name: "Clinic Outside", category: "healthcare", valueUsd: 200000, population: 50 },
			geometry: { type: "Point", coordinates: [87.5, 29.5] },
		},
	],
};

const joinResult = spatialExposureJoin(hazardPolygon, assets);
assert.strictEqual(joinResult.summary.totalAssetsEvaluated, 2);
assert.strictEqual(joinResult.summary.totalExposedAssets, 1);
assert.strictEqual(joinResult.exposedAssets[0].name, "Hospital Inside");
assert.strictEqual(joinResult.summary.totalExposedPopulation, 500);
assert.strictEqual(joinResult.summary.totalExposedAssetValueUsd, 1000000);

console.log("✅ Spatial tests passed!");
