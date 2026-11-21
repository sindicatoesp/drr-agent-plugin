/**
 * Mathematics, Spatial Geometry, Boundary/Antimeridian Handling, and Validation Utilities (R-11)
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
 */
function lognormalCdf(x, median, beta) {
	if (x <= 0 || median <= 0 || beta <= 0) return 0;
	const z = Math.log(x / median) / beta;
	return normalCdf(z);
}

/**
 * Haversine distance between two coordinates in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
	const R = 6371.0;
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
 * Normalize longitude into [-180, 180]
 */
function normalizeLongitude(lon) {
	if (!Number.isFinite(lon)) return lon;
	let x = ((lon + 180) % 360 + 360) % 360 - 180;
	if (x === -180 && lon > 0) x = 180;
	return x;
}

/**
 * Detect whether a polygon ring crosses the antimeridian (consecutive edge |dlon| > 180)
 */
function ringCrossesAntimeridian(ring) {
	if (!Array.isArray(ring) || ring.length < 2) return false;
	for (let i = 1; i < ring.length; i++) {
		if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) {
			return true;
		}
	}
	return false;
}

/**
 * Shift ring and test point to [0, 360) continuous longitude space when ring crosses antimeridian
 */
function unwrapAntimeridianRing(ring) {
	return ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]);
}

/**
 * Check whether point p lies strictly on segment ab (within epsilon)
 */
function pointOnSegment(p, a, b, eps = 1e-11) {
	const [px, py] = p;
	const [ax, ay] = a;
	const [bx, by] = b;
	const dx = bx - ax;
	const dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	if (lenSq <= eps * eps) {
		return Math.hypot(px - ax, py - ay) <= eps;
	}
	const cross = (px - ax) * dy - (py - ay) * dx;
	if (Math.abs(cross) > eps * (Math.hypot(dx, dy) + 1)) return false;
	const dot = (px - ax) * dx + (py - ay) * dy;
	if (dot < -eps) return false;
	if (dot - lenSq > eps) return false;
	return true;
}

/**
 * Point in Polygon test using Ray-casting + exact boundary/edge inclusion + antimeridian handling
 * @param {[number, number]} point - [longitude, latitude]
 * @param {Array<[number, number]>} ring - Array of [longitude, latitude] vertices
 * @returns {boolean}
 */
function pointInPolygonRing(point, ring) {
	if (!Array.isArray(point) || !Array.isArray(ring) || ring.length < 3) return false;

	let testPoint = point;
	let testRing = ring;

	// If ring crosses the antimeridian (e.g. +178 to -178), unwrap into [0, 360) space
	if (ringCrossesAntimeridian(ring)) {
		testRing = unwrapAntimeridianRing(ring);
		testPoint = [point[0] < 0 ? point[0] + 360 : point[0], point[1]];
	}

	const x = testPoint[0];
	const y = testPoint[1];

	// Explicit boundary inclusion (edges & vertices)
	for (let i = 0, j = testRing.length - 1; i < testRing.length; j = i++) {
		if (pointOnSegment(testPoint, testRing[j], testRing[i])) {
			return true;
		}
	}

	let inside = false;
	for (let i = 0, j = testRing.length - 1; i < testRing.length; j = i++) {
		const xi = testRing[i][0];
		const yi = testRing[i][1];
		const xj = testRing[j][0];
		const yj = testRing[j][1];

		const intersect =
			yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}

	return inside;
}

/**
 * Test if a point [lon, lat] is inside a GeoJSON geometry (Polygon or MultiPolygon)
 */
function isPointInGeometry(point, geometry) {
	if (!geometry || !geometry.coordinates) return false;

	if (geometry.type === "Polygon") {
		const exterior = geometry.coordinates[0];
		if (!pointInPolygonRing(point, exterior)) return false;
		for (let i = 1; i < geometry.coordinates.length; i++) {
			if (pointInPolygonRing(point, geometry.coordinates[i])) {
				return false;
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
 * Calculate planar signed area of a ring (positive = CCW, negative = CW)
 */
function signedRingArea(ring) {
	if (!Array.isArray(ring) || ring.length < 3) return 0;
	const testRing = ringCrossesAntimeridian(ring) ? unwrapAntimeridianRing(ring) : ring;
	let area = 0;
	for (let i = 0; i < testRing.length; i++) {
		const [x1, y1] = testRing[i];
		const [x2, y2] = testRing[(i + 1) % testRing.length];
		area += x1 * y2 - x2 * y1;
	}
	return area / 2;
}

/**
 * Approximate spherical surface area of a ring on WGS84 sphere in km^2 (Chamberlain & Duquette 2007)
 */
function computeRingAreaSqKm(ring) {
	if (!Array.isArray(ring) || ring.length < 3) return 0;
	const R = 6371.0088;
	const rad = Math.PI / 180;
	const pts = ringCrossesAntimeridian(ring) ? unwrapAntimeridianRing(ring) : ring;
	let total = 0;
	const n = pts.length;
	for (let i = 0; i < n; i++) {
		const p1 = pts[i];
		const p2 = pts[(i + 1) % n];
		total += (p2[0] - p1[0]) * rad * (2 + Math.sin(p1[1] * rad) + Math.sin(p2[1] * rad));
	}
	return Math.abs((total * R * R) / 2);
}

function orient2d(a, b, c) {
	return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * Check whether proper segments p1-p2 and q1-q2 intersect (excluding shared endpoints)
 */
function segmentsIntersect(p1, p2, q1, q2) {
	// Fast axis-aligned bounding-box rejection
	if (
		Math.max(p1[0], p2[0]) <= Math.min(q1[0], q2[0]) ||
		Math.max(q1[0], q2[0]) <= Math.min(p1[0], p2[0]) ||
		Math.max(p1[1], p2[1]) <= Math.min(q1[1], q2[1]) ||
		Math.max(q1[1], q2[1]) <= Math.min(p1[1], p2[1])
	) {
		return false;
	}
	const o1 = orient2d(p1, p2, q1);
	const o2 = orient2d(p1, p2, q2);
	if ((o1 >= 0 && o2 >= 0) || (o1 <= 0 && o2 <= 0)) return false;
	const o3 = orient2d(q1, q2, p1);
	const o4 = orient2d(q1, q2, p2);
	return (o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0);
}

/**
 * Calculate bounding box [minLon, minLat, maxLon, maxLat] of a GeoJSON feature or geometry
 */
function calculateBBox(geojson) {
	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = -Infinity;
	let maxLat = -Infinity;

	function visitCoord(coord) {
		if (!Array.isArray(coord)) return;
		if (typeof coord[0] === "number") {
			const lon = coord[0];
			const lat = coord[1];
			if (lon < minLon) minLon = lon;
			if (lat < minLat) minLat = lat;
			if (lon > maxLon) maxLon = lon;
			if (lat > maxLat) maxLat = lat;
		} else {
			for (let i = 0; i < coord.length; i++) {
				visitCoord(coord[i]);
			}
		}
	}

	if (!geojson) return [-180, -90, 180, 90];
	if (geojson.bbox) return geojson.bbox;
	if (geojson.geometry && geojson.geometry.coordinates) {
		visitCoord(geojson.geometry.coordinates);
	} else if (geojson.coordinates) {
		visitCoord(geojson.coordinates);
	} else if (Array.isArray(geojson.features)) {
		for (let i = 0; i < geojson.features.length; i++) {
			const f = geojson.features[i];
			if (f && f.geometry && f.geometry.coordinates) {
				visitCoord(f.geometry.coordinates);
			}
		}
	}

	if (minLon === Infinity) return [-180, -90, 180, 90];
	return [minLon, minLat, maxLon, maxLat];
}

module.exports = {
	erf,
	normalCdf,
	lognormalCdf,
	haversineDistance,
	normalizeLongitude,
	ringCrossesAntimeridian,
	unwrapAntimeridianRing,
	pointOnSegment,
	pointInPolygonRing,
	isPointInGeometry,
	signedRingArea,
	computeRingAreaSqKm,
	segmentsIntersect,
	calculateBBox,
};
