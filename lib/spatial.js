/**
 * Deterministic Spatial Exposure Joins
 * Evaluates spatial intersections between hazard footprints and exposed assets
 * without relying on external GIS databases or hallucinated spatial coordinates.
 */

const { isPointInGeometry, haversineDistance, calculateBBox } = require("./utils");

/**
 * Perform a spatial join between a Hazard Footprint (GeoJSON) and Exposed Assets (GeoJSON FeatureCollection)
 * @param {object} hazardGeoJSON - GeoJSON Feature or FeatureCollection representing hazard boundary
 * @param {object} exposureGeoJSON - GeoJSON FeatureCollection of assets (points/polygons)
 * @param {object} options - Optional config: bufferKm, epicenter [lon, lat]
 * @returns {object} Spatial exposure analysis report
 */
function spatialExposureJoin(hazardGeoJSON, exposureGeoJSON, options = {}) {
	const hazardFeatures =
		hazardGeoJSON.type === "FeatureCollection"
			? hazardGeoJSON.features
			: hazardGeoJSON.type === "Feature"
				? [hazardGeoJSON]
				: [{ type: "Feature", geometry: hazardGeoJSON, properties: {} }];

	const assetFeatures =
		exposureGeoJSON.type === "FeatureCollection"
			? exposureGeoJSON.features
			: exposureGeoJSON.type === "Feature"
				? [exposureGeoJSON]
				: [];

	const hazardBBox = calculateBBox(hazardGeoJSON);

	const exposedAssets = [];
	const unexposedAssets = [];
	const categoryBreakdown = {};
	let totalExposedPopulation = 0;
	let totalExposedAssetValueUsd = 0;

	for (const asset of assetFeatures) {
		const props = asset.properties || {};
		const geom = asset.geometry;
		if (!geom) continue;

		// Extract representative point [lon, lat]
		let assetPoint = null;
		if (geom.type === "Point") {
			assetPoint = geom.coordinates;
		} else if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
			// Centroid approximation from bbox
			const bbox = calculateBBox(geom);
			assetPoint = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
		}

		if (!assetPoint) continue;

		// Check if point intersects ANY hazard polygon
		let isInside = false;
		let intersectingHazard = null;

		for (const hazard of hazardFeatures) {
			if (isPointInGeometry(assetPoint, hazard.geometry)) {
				isInside = true;
				intersectingHazard = hazard.properties || {};
				break;
			}
		}

		// Also check distance buffer if options.bufferKm is given and options.epicenter is provided
		let distanceToEpicenterKm = null;
		if (options.epicenter && Array.isArray(options.epicenter)) {
			distanceToEpicenterKm = parseFloat(
				haversineDistance(
					options.epicenter[1],
					options.epicenter[0],
					assetPoint[1],
					assetPoint[0],
				).toFixed(2),
			);
			if (options.bufferKm && distanceToEpicenterKm <= options.bufferKm) {
				isInside = true;
			}
		}

		const category = props.category || props.type || "general_asset";
		const assetValue = parseFloat(props.valueUsd || props.replacementValue || 0);
		const population = parseInt(props.population || props.capacity || 0, 10);

		const assetSummary = {
			id: asset.id || props.id || `asset_${exposedAssets.length + 1}`,
			name: props.name || "Unnamed Asset",
			category,
			coordinates: assetPoint,
			distanceToEpicenterKm,
			properties: props,
			hazardZone: intersectingHazard,
		};

		if (isInside) {
			exposedAssets.push(assetSummary);
			totalExposedPopulation += population;
			totalExposedAssetValueUsd += assetValue;

			if (!categoryBreakdown[category]) {
				categoryBreakdown[category] = {
					count: 0,
					totalValueUsd: 0,
					totalPopulation: 0,
				};
			}
			categoryBreakdown[category].count++;
			categoryBreakdown[category].totalValueUsd += assetValue;
			categoryBreakdown[category].totalPopulation += population;
		} else {
			unexposedAssets.push(assetSummary);
		}
	}

	return {
		summary: {
			totalAssetsEvaluated: assetFeatures.length,
			totalExposedAssets: exposedAssets.length,
			totalUnexposedAssets: unexposedAssets.length,
			exposureRatePercentage:
				assetFeatures.length > 0
					? parseFloat(
							((exposedAssets.length / assetFeatures.length) * 100).toFixed(1),
						)
					: 0,
			totalExposedPopulation,
			totalExposedAssetValueUsd,
			hazardBoundingBox: hazardBBox,
		},
		categoryBreakdown,
		exposedAssets,
	};
}

module.exports = {
	spatialExposureJoin,
};
