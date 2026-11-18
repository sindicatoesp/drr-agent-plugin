/**
 * Basin Rainfall Aggregation, River Discharge (GloFAS) Screening,
 * and Validated Inundation Grid Ingestion Adapter (R-12, C-05)
 *
 * Strictly separates meteorological rainfall (mm) and river discharge (m^3/s)
 * from hydraulic flood inundation depth (m).
 * Pure Node.js standard library only.
 */

const { isPointInGeometry } = require("./utils");
const { getRegisteredMethod } = require("./registry");
const { createProvenanceManifest } = require("./contracts");

/**
 * Aggregate grid or station rainfall forecasts (mm) over a river basin polygon or gauge weights
 * @param {object} params - { basinId, basinName, basinGeoJSON?, stationsOrGrid: [{ id, coordinates?, weight?, dailyPrecipMm: number[] }], dates?: string[], method?: "arithmetic_mean"|"weighted" }
 */
function aggregateBasinRainfall(params = {}) {
	const points = Array.isArray(params.stationsOrGrid) ? params.stationsOrGrid : [];
	if (points.length === 0) {
		throw new Error("MISSING_REQUIRED_INPUT: stationsOrGrid array with precipitation series is required.");
	}

	const basinGeom = params.basinGeoJSON
		? (params.basinGeoJSON.type === "Feature" ? params.basinGeoJSON.geometry : params.basinGeoJSON)
		: null;

	const includedPoints = [];
	const excludedPoints = [];

	for (let i = 0; i < points.length; i++) {
		const p = points[i] || {};
		if (basinGeom && Array.isArray(p.coordinates)) {
			if (!isPointInGeometry(p.coordinates, basinGeom)) {
				excludedPoints.push({ id: p.id || `pt_${i}`, reason: "outside_basin_polygon" });
				continue;
			}
		}
		if (!Array.isArray(p.dailyPrecipMm) || p.dailyPrecipMm.length === 0) {
			excludedPoints.push({ id: p.id || `pt_${i}`, reason: "missing_precipitation_series" });
			continue;
		}
		includedPoints.push(p);
	}

	if (includedPoints.length === 0) {
		return {
			valid: false,
			basinId: params.basinId || null,
			basinName: params.basinName || "Unnamed Basin",
			depthStatus: "depth_unavailable",
			estimatedInundationDepthMeters: null,
			reason: "No valid gauge or grid points fell inside the basin with complete precipitation data.",
			excludedPoints,
		};
	}

	const days = includedPoints[0].dailyPrecipMm.length;
	const useWeights = params.method === "weighted" || includedPoints.every((p) => Number.isFinite(Number(p.weight)) && Number(p.weight) > 0);
	const dailySeries = [];
	let basinCumulativeMm = 0;
	let peakDailyMm = 0;

	for (let d = 0; d < days; d++) {
		let weightedSum = 0;
		let weightSum = 0;
		let validSamples = 0;
		for (const pt of includedPoints) {
			const val = pt.dailyPrecipMm[d];
			if (val !== null && val !== undefined && Number.isFinite(Number(val)) && Number(val) >= 0) {
				const w = useWeights ? Number(pt.weight || 1) : 1;
				weightedSum += Number(val) * w;
				weightSum += w;
				validSamples++;
			}
		}
		const dayMeanMm = weightSum > 0 ? weightedSum / weightSum : null;
		if (dayMeanMm !== null) {
			basinCumulativeMm += dayMeanMm;
			if (dayMeanMm > peakDailyMm) peakDailyMm = dayMeanMm;
		}
		dailySeries.push({
			date: params.dates?.[d] || `Day ${d + 1}`,
			basinMeanPrecipMm: dayMeanMm !== null ? parseFloat(dayMeanMm.toFixed(2)) : null,
			validSamples,
		});
	}

	return {
		valid: true,
		assessmentKind: "basin_rainfall_aggregation",
		basinId: params.basinId || null,
		basinName: params.basinName || "Unnamed Basin",
		aggregationMethod: useWeights ? "weighted_basin_mean" : "arithmetic_basin_mean",
		unit: "mm",
		includedPointsCount: includedPoints.length,
		excludedPointsCount: excludedPoints.length,
		excludedPoints,
		basinCumulativePrecipMm: parseFloat(basinCumulativeMm.toFixed(2)),
		peakDailyBasinPrecipMm: parseFloat(peakDailyMm.toFixed(2)),
		dailySeries,
		// C-05: Rainfall aggregation NEVER produces inundation depth
		depthStatus: "depth_unavailable",
		estimatedInundationDepthMeters: null,
		semanticNote: "Basin-averaged precipitation (mm) is a hydrological forcing input and NOT a flood inundation depth (m).",
	};
}

/**
 * Screen River Discharge (GloFAS / Open-Meteo Flood API, m^3/s) with suitability & return-period checks (R-12, C-05)
 * River discharge is NEVER presented as flood depth.
 */
function screenRiverDischarge(params = {}) {
	const dischargeSeries = Array.isArray(params.dailyDischargeM3s) ? params.dailyDischargeM3s : [];
	if (dischargeSeries.length === 0) {
		throw new Error("MISSING_REQUIRED_INPUT: dailyDischargeM3s array is required.");
	}

	const gridResolutionKm = params.gridResolutionKm ?? 5.0;
	const upstreamAreaSqKm = params.upstreamDrainageAreaSqKm ?? null;
	const isRiverCell = params.isRiverCell !== false;
	const dates = params.dates || [];

	const warnings = [];
	let cellSuitability = "suitable";
	if (!isRiverCell) {
		cellSuitability = "unsuitable_non_river_cell";
		warnings.push({
			code: "NON_RIVER_CELL",
			field: "isRiverCell",
			message: "Target coordinate is flagged as a non-river grid cell; GloFAS discharge screening is not reliable.",
		});
	} else if (upstreamAreaSqKm !== null && upstreamAreaSqKm < 100) {
		cellSuitability = "low_suitability_small_catchment";
		warnings.push({
			code: "SMALL_CATCHMENT_FOR_GLOFAS",
			field: "upstreamDrainageAreaSqKm",
			message: `Upstream drainage area (${upstreamAreaSqKm} km^2) is small relative to ~${gridResolutionKm} km GloFAS resolution; verify local gauge observations.`,
		});
	}

	let peakDischargeM3s = 0;
	let peakDate = null;
	let meanDischargeM3s = 0;
	let validCount = 0;

	for (let i = 0; i < dischargeSeries.length; i++) {
		const q = Number(dischargeSeries[i]);
		if (Number.isFinite(q) && q >= 0) {
			validCount++;
			meanDischargeM3s += q;
			if (q > peakDischargeM3s) {
				peakDischargeM3s = q;
				peakDate = dates[i] || `Day ${i + 1}`;
			}
		}
	}
	if (validCount === 0) {
		throw new Error("INVALID_DISCHARGE_DATA: No valid non-negative discharge values provided.");
	}
	meanDischargeM3s /= validCount;

	// Return-period threshold comparison if explicit local thresholds are supplied
	const thresholds = params.returnPeriodThresholds || null; // e.g. { q2: 500, q5: 800, q10: 1100, q20: 1500 }
	let exceededReturnPeriod = null;
	let screeningSignal = "informational_no_local_thresholds";
	if (thresholds && typeof thresholds === "object") {
		if (thresholds.q20 && peakDischargeM3s >= thresholds.q20) exceededReturnPeriod = "20-year";
		else if (thresholds.q10 && peakDischargeM3s >= thresholds.q10) exceededReturnPeriod = "10-year";
		else if (thresholds.q5 && peakDischargeM3s >= thresholds.q5) exceededReturnPeriod = "5-year";
		else if (thresholds.q2 && peakDischargeM3s >= thresholds.q2) exceededReturnPeriod = "2-year";
		else exceededReturnPeriod = "below_q2";

		screeningSignal = ["20-year", "10-year"].includes(exceededReturnPeriod)
			? "Red"
			: ["5-year", "2-year"].includes(exceededReturnPeriod)
				? "Orange"
				: "Green";
	} else {
		warnings.push({
			code: "MISSING_DISCHARGE_THRESHOLDS",
			field: "returnPeriodThresholds",
			message: "No local return-period discharge thresholds (q2/q5/q10/q20) provided; discharge is reported descriptively only.",
		});
	}

	const regMethod = getRegisteredMethod("screening.openmeteo.glofas_discharge");
	const provenance = createProvenanceManifest({
		sourceIds: [params.sourceId || "glofas-openmeteo-flood"],
		sourceIssuedAt: params.issueTime || null,
		retrievedAt: new Date().toISOString(),
		inputsSnapshot: { dischargeSeries, thresholds, gridResolutionKm, upstreamAreaSqKm },
		method: { id: regMethod.id, version: regMethod.version, references: [regMethod.sourceUrl] },
		evidenceBasis: "modelled",
		verificationStatus: "unreviewed",
		approvalStatus: "draft",
		limitations: regMethod.limitations,
	});

	return {
		assessmentKind: "river_discharge_screening",
		unit: "m^3/s",
		peakDischargeM3s: parseFloat(peakDischargeM3s.toFixed(2)),
		meanDischargeM3s: parseFloat(meanDischargeM3s.toFixed(2)),
		peakDate,
		exceededReturnPeriod,
		screeningSignal,
		cellSuitability,
		gridResolutionKm,
		upstreamDrainageAreaSqKm: upstreamAreaSqKm,
		// C-05: River discharge is NEVER flood depth
		depthStatus: "depth_unavailable",
		estimatedInundationDepthMeters: null,
		depthExplanation: "River discharge (m^3/s) is not inundation depth (m). Convert only via a calibrated site-specific hydraulic rating curve or 2D hydrodynamic model.",
		provenance,
		warnings,
	};
}

/**
 * Validated Inundation Depth Grid Adapter (R-12)
 * Accepts external hydraulic/SAR flood depth grids with mandatory units & provenance metadata.
 */
function ingestValidatedInundationGrid(grid = {}) {
	const errors = [];
	if (!grid.modelSource) {
		errors.push("Missing modelSource identifying hydraulic model or SAR flood product.");
	}
	if (!["m", "meters"].includes(String(grid.unit || "").toLowerCase())) {
		errors.push(`Unsupported depth grid unit '${grid.unit}'. Expected meters ('m').`);
	}
	if (!grid.crs) {
		errors.push("Missing CRS identifier on inundation grid (e.g. 'EPSG:4326').");
	}
	if (!Array.isArray(grid.values) || !Array.isArray(grid.bbox) || grid.bbox.length !== 4) {
		errors.push("Inundation grid must supply bbox [minLon,minLat,maxLon,maxLat] and values array.");
	}
	if (errors.length > 0) {
		return { valid: false, depthStatus: "depth_unavailable", errors };
	}

	return {
		valid: true,
		depthStatus: "validated_depth_grid",
		modelSource: grid.modelSource,
		validationStatus: grid.validationStatus || "unverified_external_grid",
		unit: "m",
		crs: String(grid.crs).toUpperCase(),
		bbox: grid.bbox,
		width: grid.width,
		height: grid.height,
		values: grid.values,
		nodata: grid.nodata ?? -9999,
		valueSemantics: "continuous",
	};
}

module.exports = {
	aggregateBasinRainfall,
	screenRiverDischarge,
	ingestValidatedInundationGrid,
};
