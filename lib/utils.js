/**
 * Mathematics, Spatial Geometry, and Validation Utilities
 * Zero external dependencies - pure Node.js / ECMAScript
 */

/**
 * Standard error function approximation (Abramowitz and Stegun 7.1.26)
 * Maximum error: 1.5 * 10^-7
 */
function erf(x) {
	if (x === 0) return 0;
	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;

	const sign = x < 0 ? -1 : 1;
	const absX = Math.abs(x);

	const t = 1.0 / (1.0 + p * absX);
	const y =
		1.0 -
		((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

	return sign * y;
}

/**
 * Standard Normal Cumulative Distribution Function Phi(x)
 */
function normalCdf(x) {
	return 0.5 * (1.0 + erf(x / Math.SQRT2));
}

/**
 * Lognormal Cumulative Distribution Function
 * P(X <= x) where ln(X) ~ Normal(ln(median), beta)
 * @param {number} x - Hazard intensity (must be > 0)
 * @param {number} median - Median intensity theta
 * @param {number} beta - Lognormal dispersion / standard deviation
 */
function lognormalCdf(x, median, beta) {
	if (x <= 0 || median <= 0 || beta <= 0) return 0;
	const z = Math.log(x / median) / beta;
	return normalCdf(z);
}

/**
 * Haversine distance between two coordinates in kilometers
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} distance in km
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
	const R = 6371.0; // Earth mean radius in km
	const toRad = Math.PI / 180.0;
	const dLat = (lat2 - lat1) * toRad;
	const dLon = (lon2 - lon1) * toRad;
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1 * toRad) *
			Math.cos(lat2 * toRad) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

/**
 * Point in Polygon test using Ray-casting algorithm
 * @param {[number, number]} point - [longitude, latitude]
 * @param {Array<[number, number]>} ring - Array of [longitude, latitude] vertices
 * @returns {boolean}
 */
function pointInPolygonRing(point, ring) {
	const x = point[0];
	const y = point[1];
	let inside = false;

	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i][0];
		const yi = ring[i][1];
		const xj = ring[j][0];
		const yj = ring[j][1];

		const intersect =
			yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}

	return inside;
}

/**
 * Test if a point [lon, lat] is inside a GeoJSON geometry (Polygon or MultiPolygon)
 * @param {[number, number]} point - [lon, lat]
 * @param {object} geometry - GeoJSON Geometry
 * @returns {boolean}
 */
function isPointInGeometry(point, geometry) {
	if (!geometry || !geometry.coordinates) return false;

	if (geometry.type === "Polygon") {
		// Exterior ring must contain point, interior holes must not
		const exterior = geometry.coordinates[0];
		if (!pointInPolygonRing(point, exterior)) return false;
		for (let i = 1; i < geometry.coordinates.length; i++) {
			if (pointInPolygonRing(point, geometry.coordinates[i])) {
				return false; // Point is inside a hole
			}
		}
		return true;
	}

	if (geometry.type === "MultiPolygon") {
		for (const polygonCoords of geometry.coordinates) {
			const exterior = polygonCoords[0];
			if (pointInPolygonRing(point, exterior)) {
				let inHole = false;
				for (let i = 1; i < polygonCoords.length; i++) {
					if (pointInPolygonRing(point, polygonCoords[i])) {
						inHole = true;
						break;
					}
				}
				if (!inHole) return true;
			}
		}
		return false;
	}

	return false;
}

/**
 * Calculate the bounding box [minLon, minLat, maxLon, maxLat] of a GeoJSON feature or geometry
 */
function calculateBBox(geojson) {
	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = -Infinity;
	let maxLat = -Infinity;

	function visitCoord(coord) {
		if (Array.isArray(coord) && typeof coord[0] === "number") {
			const lon = coord[0];
			const lat = coord[1];
			if (lon < minLon) minLon = lon;
			if (lat < minLat) minLat = lat;
			if (lon > maxLon) maxLon = lon;
			if (lat > maxLat) maxLat = lat;
		} else if (Array.isArray(coord)) {
			coord.forEach(visitCoord);
		}
	}

	if (geojson.bbox) return geojson.bbox;
	if (geojson.geometry) {
		visitCoord(geojson.geometry.coordinates);
	} else if (geojson.coordinates) {
		visitCoord(geojson.coordinates);
	} else if (geojson.features) {
		geojson.features.forEach((f) => visitCoord(f.geometry.coordinates));
	}

	if (minLon === Infinity) return [-180, -90, 180, 90];
	return [minLon, minLat, maxLon, maxLat];
}

module.exports = {
	erf,
	normalCdf,
	lognormalCdf,
	haversineDistance,
	pointInPolygonRing,
	isPointInGeometry,
	calculateBBox,
};
