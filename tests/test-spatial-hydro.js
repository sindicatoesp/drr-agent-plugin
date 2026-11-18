const assert = require("assert");
const { pointInPolygonRing, isPointInGeometry } = require("../lib/utils");
const {
	spatialExposureJoin,
	createGeodesicBuffer,
	validateGeoJson,
	repairGeoJsonGeometry,
	transformCrs,
	computeRasterZonalStats,
} = require("../lib/spatial");
const {
	aggregateBasinRainfall,
	screenRiverDischarge,
	ingestValidatedInundationGrid,
} = require("../lib/hydro");

console.log("Testing Spatial Correctness, CRS, Raster Stats & Hydrological Adapters (R-11, R-12, C-05)...");

// --- R-11: Holes, MultiPolygons, Boundary Vertices/Edges, and Antimeridian ---
const squareWithHole = {
	type: "Polygon",
	coordinates: [
		[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
		[[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
	],
};
assert.strictEqual(isPointInGeometry([1, 1], squareWithHole), true, "Point outside hole inside ring must be included");
assert.strictEqual(isPointInGeometry([5, 5], squareWithHole), false, "Point inside hole must be excluded");
assert.strictEqual(pointInPolygonRing([0, 5], squareWithHole.coordinates[0]), true, "Edge boundary point must be included");
assert.strictEqual(pointInPolygonRing([10, 10], squareWithHole.coordinates[0]), true, "Corner vertex must be included");

// Antimeridian crossing polygon (+178 to -178 in Fiji/Samoa region)
const antimeridianZone = {
	type: "Feature",
	geometry: {
		type: "Polygon",
		coordinates: [
			[[178.0, -19.0], [-178.0, -19.0], [-178.0, -16.0], [178.0, -16.0], [178.0, -19.0]],
		],
	},
};
const antimeridianJoin = spatialExposureJoin(antimeridianZone, {
	type: "FeatureCollection",
	features: [
		{ type: "Feature", properties: { name: "Island A", population: 1200, valueUsd: 500000 }, geometry: { type: "Point", coordinates: [179.5, -17.5] } },
		{ type: "Feature", properties: { name: "Island B", population: 800, valueUsd: 300000 }, geometry: { type: "Point", coordinates: [-179.2, -17.5] } },
		{ type: "Feature", properties: { name: "Far Away", population: 5000, valueUsd: 1000000 }, geometry: { type: "Point", coordinates: [170.0, -17.5] } },
	],
});
assert.strictEqual(antimeridianJoin.summary.totalExposedAssets, 2, "Antimeridian join must include both sides of 180 deg");
assert.strictEqual(antimeridianJoin.summary.totalExposedPopulation, 2000);

// Geodesic buffer check at mid-latitude (~60 deg N)
const buf = createGeodesicBuffer([25.0, 60.0], 50, 32);
assert.strictEqual(buf.type, "Polygon");
assert.strictEqual(buf.coordinates[0].length, 33);
assert.deepStrictEqual(buf.coordinates[0][0], buf.coordinates[0][32]);

// GeoJSON Validation (valid, self-intersecting, unclosed)
const selfIntersecting = {
	type: "Polygon",
	coordinates: [[[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]],
};
const siVal = validateGeoJson(selfIntersecting);
assert.strictEqual(siVal.valid, false);
assert(siVal.errors.some((e) => e.code === "SELF_INTERSECTING_POLYGON"));

const unclosedCwPoly = {
	type: "Polygon",
	coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0]]], // unclosed AND clockwise
};
const unclosedVal = validateGeoJson(unclosedCwPoly);
assert.strictEqual(unclosedVal.valid, false);
assert(unclosedVal.errors.some((e) => e.code === "UNCLOSED_RING"));

// Opt-in Geometry Repair vs default no-op
const noOptIn = repairGeoJsonGeometry(unclosedCwPoly);
assert.strictEqual(noOptIn.repaired, false);
assert.strictEqual(noOptIn.requiresOptIn, true);

const optedInRepair = repairGeoJsonGeometry(unclosedCwPoly, { repairRequested: true });
assert.strictEqual(optedInRepair.repaired, true);
assert.strictEqual(optedInRepair.validationAfter.valid, true);
assert.strictEqual(optedInRepair.repairAudit.originalGeometryPreserved, true);
assert.strictEqual(optedInRepair.originalGeometry.coordinates[0].length, 4, "Original unclosed 4-pt ring must remain preserved untouched");

// CRS Transformations: WGS84 <-> Web Mercator & WGS84 <-> UTM Zone 47N (Thailand)
const ptBangkok = [100.5018, 13.7563];
const toMerc = transformCrs(ptBangkok, "EPSG:4326", "EPSG:3857");
const backWgsMerc = transformCrs(toMerc.transformed, "EPSG:3857", "EPSG:4326");
assert(Math.abs(backWgsMerc.transformed[0] - ptBangkok[0]) < 1e-5);
assert(Math.abs(backWgsMerc.transformed[1] - ptBangkok[1]) < 1e-5);

const toUtm47N = transformCrs(ptBangkok, "EPSG:4326", "EPSG:32647");
const backWgsUtm = transformCrs(toUtm47N.transformed, "EPSG:32647", "EPSG:4326");
assert(Math.abs(backWgsUtm.transformed[0] - ptBangkok[0]) < 1e-5);
assert(Math.abs(backWgsUtm.transformed[1] - ptBangkok[1]) < 1e-5);

// Raster Zonal Statistics (count vs density_per_sqkm + nodata + CRS mismatch)
const zoneBox = {
	type: "Polygon",
	coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
};
const countRaster = {
	crs: "EPSG:4326",
	bbox: [0, 0, 2, 2],
	width: 2,
	height: 2,
	nodata: -9999,
	valueSemantics: "count",
	values: [100, 200, -9999, 300],
};
const countStats = computeRasterZonalStats(countRaster, zoneBox);
assert.strictEqual(countStats.stats.validCells, 3);
assert.strictEqual(countStats.stats.nodataCells, 1);
assert.strictEqual(countStats.stats.integratedTotal, 600, "Count raster must sum valid cells (100+200+300)");

const densityRaster = { ...countRaster, valueSemantics: "density_per_sqkm", values: [10, 10, 10, 10] };
const densityStats = computeRasterZonalStats(densityRaster, zoneBox);
assert(densityStats.stats.integratedTotal > 400000, "Density raster must integrate by cell area (km^2), not sum raw 40");

assert.throws(
	() => computeRasterZonalStats({ ...countRaster, crs: "EPSG:3857" }, zoneBox, { zoneCrs: "EPSG:4326" }),
	/CRS_MISMATCH/,
);

// --- R-12 & C-05: Basin Rainfall Aggregation, GloFAS Discharge Screening & Grid Ingest ---
const basinRes = aggregateBasinRainfall({
	basinId: "B-TH-01",
	basinName: "Pattani Basin",
	basinGeoJSON: {
		type: "Polygon",
		coordinates: [[[100.8, 6.0], [101.6, 6.0], [101.6, 6.9], [100.8, 6.9], [100.8, 6.0]]],
	},
	stationsOrGrid: [
		{ id: "st1", coordinates: [101.2, 6.5], weight: 0.7, dailyPrecipMm: [40, 120] },
		{ id: "st2", coordinates: [101.3, 6.6], weight: 0.3, dailyPrecipMm: [60, 80] },
		{ id: "outside", coordinates: [99.0, 13.0], weight: 1.0, dailyPrecipMm: [500, 500] },
	],
	dates: ["2026-11-01", "2026-11-02"],
});
assert.strictEqual(basinRes.valid, true);
assert.strictEqual(basinRes.includedPointsCount, 2);
assert.strictEqual(basinRes.excludedPointsCount, 1);
assert.strictEqual(basinRes.depthStatus, "depth_unavailable");
assert.strictEqual(basinRes.estimatedInundationDepthMeters, null);
// Day 1: 40*0.7 + 60*0.3 = 46; Day 2: 120*0.7 + 80*0.3 = 108; sum = 154
assert.strictEqual(basinRes.basinCumulativePrecipMm, 154);

const dischargeOk = screenRiverDischarge({
	dailyDischargeM3s: [310, 820, 1250, 910],
	dates: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"],
	returnPeriodThresholds: { q2: 500, q5: 800, q10: 1100, q20: 1500 },
	gridResolutionKm: 5,
	upstreamDrainageAreaSqKm: 2400,
	isRiverCell: true,
});
assert.strictEqual(dischargeOk.unit, "m^3/s");
assert.strictEqual(dischargeOk.peakDischargeM3s, 1250);
assert.strictEqual(dischargeOk.exceededReturnPeriod, "10-year");
assert.strictEqual(dischargeOk.screeningSignal, "Red");
assert.strictEqual(dischargeOk.cellSuitability, "suitable");
assert.strictEqual(dischargeOk.depthStatus, "depth_unavailable");
assert.strictEqual(dischargeOk.estimatedInundationDepthMeters, null);

const dischargeUnsuitable = screenRiverDischarge({
	dailyDischargeM3s: [12, 18],
	gridResolutionKm: 5,
	upstreamDrainageAreaSqKm: 45,
	isRiverCell: false,
});
assert.strictEqual(dischargeUnsuitable.cellSuitability, "unsuitable_non_river_cell");
assert(dischargeUnsuitable.warnings.some((w) => w.code === "NON_RIVER_CELL"));

const invalidDepthGrid = ingestValidatedInundationGrid({ unit: "mm", values: [10], bbox: [0, 0, 1, 1] });
assert.strictEqual(invalidDepthGrid.valid, false);
assert.strictEqual(invalidDepthGrid.depthStatus, "depth_unavailable");

const validDepthGrid = ingestValidatedInundationGrid({
	modelSource: "HEC-RAS 2D Calibrated Basin v3",
	unit: "m",
	crs: "EPSG:4326",
	bbox: [101.0, 6.0, 101.5, 6.5],
	width: 1,
	height: 1,
	values: [1.85],
});
assert.strictEqual(validDepthGrid.valid, true);
assert.strictEqual(validDepthGrid.depthStatus, "validated_depth_grid");

console.log("✅ Spatial correctness, CRS, raster zonal stats & hydrological tests passed!");
