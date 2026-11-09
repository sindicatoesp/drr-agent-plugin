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

	// Precompute bounding boxes per hazard feature for fast O(1) spatial rejection
	const preparedHazards = hazardFeatures.map((h) => ({
		geometry: h.geometry,
		properties: h.properties || {},
		bbox:
			h.geometry && h.geometry.coordinates && h.geometry.coordinates.length > 0
				? calculateBBox(h.geometry)
				: null,
	}));

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

		// Check if point intersects ANY hazard polygon (with fast BBox pre-rejection)
		let isInside = false;
		let intersectingHazard = null;
		const ptLon = assetPoint[0];
		const ptLat = assetPoint[1];

		for (const hazard of preparedHazards) {
			if (!hazard.bbox) continue;
			if (
				ptLon < hazard.bbox[0] ||
				ptLat < hazard.bbox[1] ||
				ptLon > hazard.bbox[2] ||
				ptLat > hazard.bbox[3]
			) {
				continue;
			}
			if (isPointInGeometry(assetPoint, hazard.geometry)) {
				isInside = true;
				intersectingHazard = hazard.properties;
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

/**
 * Evaluates whether a hazard event falls within target countries or geographic bounding box.
 * @param {object} event - Normalized hazard event object (USGS, GDACS, or custom)
 * @param {string[]|string} targetCountries - Target country names or ISO codes (e.g. ["Indonesia", "ID"], or ["*"] for all)
 * @param {number[]} [bbox] - Optional bounding box [minLon, minLat, maxLon, maxLat]
 * @returns {boolean} True if event matches the country criteria
 */
function isEventInCountry(event, targetCountries = ["*"], bbox = null) {
	if (!event) return false;

	const countries = Array.isArray(targetCountries)
		? targetCountries
		: typeof targetCountries === "string"
			? targetCountries.split(",").map((c) => c.trim()).filter(Boolean)
			: ["*"];

	// If wildcard or empty, match all
	if (countries.length === 0 || countries.includes("*")) {
		return true;
	}

	const normalizedTargets = countries.map((c) => c.toLowerCase());

	// 1. Check coordinates against Bounding Box if provided
	if (bbox && Array.isArray(bbox) && bbox.length === 4) {
		const coords = event.coordinates || (event.geometry && event.geometry.coordinates);
		if (coords && Array.isArray(coords)) {
			const lon = coords[0];
			const lat = coords[1];
			if (typeof lon === "number" && typeof lat === "number") {
				if (lon >= bbox[0] && lat >= bbox[1] && lon <= bbox[2] && lat <= bbox[3]) {
					return true;
				}
			}
		}
	}

	// 2. Check country property (e.g. from GDACS or custom payload)
	const rawCountry = (event.country || "").toLowerCase().trim();
	if (
		rawCountry &&
		normalizedTargets.some(
			(t) => rawCountry === t || rawCountry.includes(t) || t.includes(rawCountry),
		)
	) {
		return true;
	}

	// 3. Check place property (e.g. from USGS: "12 km SW of Palu, Indonesia")
	const rawPlace = (event.place || "").toLowerCase().trim();
	if (rawPlace && normalizedTargets.some((t) => rawPlace.includes(t))) {
		return true;
	}

	// 4. Check rawProperties (GDACS iso3, country name)
	if (event.rawProperties) {
		const iso3 = (event.rawProperties.iso3 || "").toLowerCase().trim();
		const propCountry = (event.rawProperties.country || "").toLowerCase().trim();
		if (iso3 && normalizedTargets.includes(iso3)) return true;
		if (
			propCountry &&
			normalizedTargets.some((t) => propCountry === t || propCountry.includes(t))
		) {
			return true;
		}
	}

	// 5. Check title / eventName
	const rawTitle = (event.title || event.eventName || "").toLowerCase().trim();
	if (rawTitle && normalizedTargets.some((t) => rawTitle.includes(t))) {
		return true;
	}

	return false;
}

module.exports = {
	spatialExposureJoin,
	isEventInCountry,
};
