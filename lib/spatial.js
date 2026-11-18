/**
 * Deterministic Spatial Exposure Joins, GeoJSON Validation, Opt-In Geometry Repair,
 * Coordinate Reference System (CRS) Transforms, Geodesic Buffers, and Raster Zonal Stats (R-11)
 *
 * Pure Node.js standard library only.
 */

const {
	isPointInGeometry,
	haversineDistance,
	calculateBBox,
	ringCrossesAntimeridian,
	normalizeLongitude,
	signedRingArea,
	computeRingAreaSqKm,
	segmentsIntersect,
	pointInPolygonRing,
} = require("./utils");
const { validateCoordinatePair } = require("./contracts");

// WGS84 Ellipsoid Constants
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
const MERCATOR_MAX_LAT = 85.05112877980659;

function geometryCrossesAntimeridian(geom) {
	if (!geom || !geom.coordinates) return false;
	if (geom.type === "Polygon") {
		return ringCrossesAntimeridian(geom.coordinates[0]);
	}
	if (geom.type === "MultiPolygon") {
		return geom.coordinates.some((poly) => ringCrossesAntimeridian(poly[0]));
	}
	return false;
}

/**
 * Create a geodesic circular buffer polygon around [lon, lat] with radiusKm
 */
function createGeodesicBuffer(centerLonLat, radiusKm, steps = 32) {
	const check = validateCoordinatePair(centerLonLat, "center");
	if (!check.valid) throw new Error(check.error.message);
	if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
		throw new Error("radiusKm must be a positive finite number.");
	}
	const [lonDeg, latDeg] = centerLonLat;
	const R = 6371.0088;
	const lat1 = (latDeg * Math.PI) / 180;
	const lon1 = (lonDeg * Math.PI) / 180;
	const d = radiusKm / R;

	const ring = [];
	for (let i = 0; i <= steps; i++) {
		const brng = (2 * Math.PI * i) / steps;
		const lat2 = Math.asin(
			Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
		);
		const lon2 =
			lon1 +
			Math.atan2(
				Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
				Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
			);
		ring.push([
			parseFloat(normalizeLongitude((lon2 * 180) / Math.PI).toFixed(6)),
			parseFloat(((lat2 * 180) / Math.PI).toFixed(6)),
		]);
	}
	// Close ring cleanly
	ring[ring.length - 1] = [...ring[0]];
	return {
		type: "Polygon",
		coordinates: [ring],
	};
}

/**
 * Perform a deterministic spatial join between Hazard Footprint and Exposed Assets
 */
function spatialExposureJoin(hazardGeoJSON, exposureGeoJSON, options = {}) {
	if (!hazardGeoJSON || typeof hazardGeoJSON !== "object") {
		throw new Error("MISSING_REQUIRED_INPUT: hazardGeoJSON is required.");
	}
	if (!exposureGeoJSON || typeof exposureGeoJSON !== "object") {
		throw new Error("MISSING_REQUIRED_INPUT: exposureGeoJSON is required.");
	}

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

	const preparedHazards = hazardFeatures.map((h) => ({
		geometry: h.geometry,
		properties: h.properties || {},
		crossesAntimeridian: geometryCrossesAntimeridian(h.geometry),
		bbox:
			h.geometry && h.geometry.coordinates && h.geometry.coordinates.length > 0
				? calculateBBox(h.geometry)
				: null,
	}));

	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = -Infinity;
	let maxLat = -Infinity;
	for (const h of preparedHazards) {
		if (h.bbox) {
			if (h.bbox[0] < minLon) minLon = h.bbox[0];
			if (h.bbox[1] < minLat) minLat = h.bbox[1];
			if (h.bbox[2] > maxLon) maxLon = h.bbox[2];
			if (h.bbox[3] > maxLat) maxLat = h.bbox[3];
		}
	}
	const hazardBBox =
		minLon === Infinity ? calculateBBox(hazardGeoJSON) : [minLon, minLat, maxLon, maxLat];

	const hasEpicenter = Boolean(options.epicenter && Array.isArray(options.epicenter));
	const epLon = hasEpicenter ? options.epicenter[0] : 0;
	const epLat = hasEpicenter ? options.epicenter[1] : 0;
	const bufferKm = options.bufferKm || 0;
	const maxLatDegDiff = bufferKm > 0 ? bufferKm / 105.0 : Infinity;

	const exposedAssets = [];
	const unexposedAssets = [];
	const categoryBreakdown = {};
	let totalExposedPopulation = 0;
	let totalExposedAssetValueUsd = 0;

	for (const asset of assetFeatures) {
		const props = asset.properties || {};
		const geom = asset.geometry;
		if (!geom) continue;

		let assetPoint = null;
		if (geom.type === "Point") {
			assetPoint = geom.coordinates;
		} else if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
			const bbox = calculateBBox(geom);
			assetPoint = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
		}

		if (!assetPoint) continue;

		let isInside = false;
		let intersectingHazard = null;
		const ptLon = assetPoint[0];
		const ptLat = assetPoint[1];

		for (const hazard of preparedHazards) {
			if (!hazard.bbox) continue;
			// Skip simple BBox rejection for antimeridian-crossing geometries, check exact ring unwrap
			if (!hazard.crossesAntimeridian) {
				if (
					ptLon < hazard.bbox[0] ||
					ptLat < hazard.bbox[1] ||
					ptLon > hazard.bbox[2] ||
					ptLat > hazard.bbox[3]
				) {
					continue;
				}
			} else if (ptLat < hazard.bbox[1] || ptLat > hazard.bbox[3]) {
				continue;
			}
			if (isPointInGeometry(assetPoint, hazard.geometry)) {
				isInside = true;
				intersectingHazard = hazard.properties;
				break;
			}
		}

		let distanceToEpicenterKm = null;
		if (hasEpicenter) {
			if (isInside || !bufferKm || Math.abs(ptLat - epLat) <= maxLatDegDiff) {
				distanceToEpicenterKm = parseFloat(
					haversineDistance(epLat, epLon, ptLat, ptLon).toFixed(2),
				);
				if (bufferKm && distanceToEpicenterKm <= bufferKm) {
					isInside = true;
				}
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
					? parseFloat(((exposedAssets.length / assetFeatures.length) * 100).toFixed(1))
					: 0,
			totalExposedPopulation,
			totalExposedAssetValueUsd,
			hazardBoundingBox: hazardBBox,
		},
		spatialContext: {
			crs: options.crs || "EPSG:4326",
			antimeridianAware: true,
			boundaryInclusion: "inclusive",
		},
		categoryBreakdown,
		exposedAssets,
	};
}

/**
 * Check a single linear ring for closure, minimum vertices, non-degenerate area, and self-intersections
 */
function checkRingValidity(ring, pathLabel, isHole = false, skipCoordRangeCheck = false) {
	const errors = [];
	const warnings = [];
	const issues = {
		unclosed: false,
		selfIntersecting: false,
		wrongWinding: false,
		degenerate: false,
		crossesAntimeridian: false,
	};

	if (!Array.isArray(ring) || ring.length < 4) {
		issues.degenerate = true;
		errors.push({
			code: "DEGENERATE_RING",
			field: pathLabel,
			message: `Ring '${pathLabel}' must have at least 4 coordinates (closed triangle).`,
		});
		return { errors, warnings, issues };
	}

	if (!skipCoordRangeCheck) {
		for (let i = 0; i < ring.length; i++) {
			const c = validateCoordinatePair(ring[i], `${pathLabel}[${i}]`);
			if (!c.valid) {
				errors.push(c.error);
				break;
			}
		}
	}

	const first = ring[0];
	const last = ring[ring.length - 1];
	if (first[0] !== last[0] || first[1] !== last[1]) {
		issues.unclosed = true;
		errors.push({
			code: "UNCLOSED_RING",
			field: pathLabel,
			message: `Polygon ring '${pathLabel}' is not closed (first vertex != last vertex).`,
		});
	}

	if (ringCrossesAntimeridian(ring)) {
		issues.crossesAntimeridian = true;
		warnings.push({
			code: "ANTIMERIDIAN_CROSSING",
			field: pathLabel,
			message: `Ring '${pathLabel}' spans across +/-180° antimeridian; antimeridian-aware unwrapping is required.`,
		});
	}

	const signedArea = signedRingArea(ring);
	if (Math.abs(signedArea) < 1e-12) {
		issues.degenerate = true;
		errors.push({
			code: "DEGENERATE_ZERO_AREA_RING",
			field: pathLabel,
			message: `Ring '${pathLabel}' has near-zero/collinear area.`,
		});
	} else {
		// RFC 7946: exterior ring CCW (signedArea > 0), interior hole CW (signedArea < 0)
		const expectedCCW = !isHole;
		if ((expectedCCW && signedArea < 0) || (!expectedCCW && signedArea > 0)) {
			issues.wrongWinding = true;
			warnings.push({
				code: "NON_RFC7946_WINDING_ORDER",
				field: pathLabel,
				message: `Ring '${pathLabel}' has ${signedArea > 0 ? "CCW" : "CW"} winding; RFC 7946 expects ${expectedCCW ? "CCW exterior" : "CW hole"}.`,
			});
		}
	}

	// Self-intersection check (check non-adjacent edges)
	const n = ring.length - 1;
	for (let i = 0; i < n; i++) {
		const a1 = ring[i];
		const a2 = ring[i + 1];
		for (let j = i + 2; j < n; j++) {
			if (i === 0 && j === n - 1) continue; // adjacent across closure vertex
			const b1 = ring[j];
			const b2 = ring[j + 1];
			if (segmentsIntersect(a1, a2, b1, b2)) {
				issues.selfIntersecting = true;
				errors.push({
					code: "SELF_INTERSECTING_POLYGON",
					field: pathLabel,
					message: `Self-intersection detected between edges ${i} and ${j} in '${pathLabel}'.`,
				});
				return { errors, warnings, issues };
			}
		}
	}

	return { errors, warnings, issues };
}

/**
 * Validate GeoJSON FeatureCollection, Feature, or Geometry (R-11)
 */
function validateGeoJson(geojson, options = {}) {
	const errors = [];
	const warnings = [];
	let featureCount = 0;
	let totalAreaSqKm = 0;

	if (!geojson || typeof geojson !== "object") {
		return {
			valid: false,
			errors: [{ code: "INVALID_GEOJSON", field: "geojson", message: "Input must be a GeoJSON object." }],
			warnings,
		};
	}

	const crs = options.crs || "EPSG:4326";
	const skipRangeCheck = crs !== "EPSG:4326";

	function inspectGeometry(geom, pathLabel) {
		if (!geom || typeof geom !== "object" || !geom.type) {
			errors.push({ code: "INVALID_GEOMETRY", field: pathLabel, message: `Missing geometry type at '${pathLabel}'.` });
			return;
		}
		if (geom.type === "Point") {
			if (!skipRangeCheck) {
				const c = validateCoordinatePair(geom.coordinates, pathLabel);
				if (!c.valid) errors.push(c.error);
			}
		} else if (geom.type === "LineString") {
			if (!Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
				errors.push({ code: "INVALID_LINESTRING", field: pathLabel, message: "LineString requires >= 2 positions." });
			} else if (!skipRangeCheck) {
				for (let i = 0; i < geom.coordinates.length; i++) {
					const c = validateCoordinatePair(geom.coordinates[i], `${pathLabel}[${i}]`);
					if (!c.valid) { errors.push(c.error); break; }
				}
			}
		} else if (geom.type === "Polygon") {
			if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) {
				errors.push({ code: "INVALID_POLYGON", field: pathLabel, message: "Polygon missing coordinate rings." });
				return;
			}
			for (let r = 0; r < geom.coordinates.length; r++) {
				const res = checkRingValidity(geom.coordinates[r], `${pathLabel}.rings[${r}]`, r > 0, skipRangeCheck);
				errors.push(...res.errors);
				warnings.push(...res.warnings);
				if (r === 0 && res.errors.length === 0 && !skipRangeCheck) {
					totalAreaSqKm += computeRingAreaSqKm(geom.coordinates[0]);
				} else if (r > 0 && geom.coordinates[r]?.length > 0 && !skipRangeCheck) {
					// Check hole lies inside exterior ring
					if (!pointInPolygonRing(geom.coordinates[r][0], geom.coordinates[0])) {
						errors.push({
							code: "HOLE_OUTSIDE_EXTERIOR",
							field: `${pathLabel}.rings[${r}]`,
							message: `Interior hole ring[${r}] lies outside exterior boundary.`,
						});
					}
					totalAreaSqKm -= computeRingAreaSqKm(geom.coordinates[r]);
				}
			}
		} else if (geom.type === "MultiPolygon") {
			if (!Array.isArray(geom.coordinates)) {
				errors.push({ code: "INVALID_MULTIPOLYGON", field: pathLabel, message: "MultiPolygon missing coordinates." });
				return;
			}
			geom.coordinates.forEach((poly, pIdx) => {
				inspectGeometry({ type: "Polygon", coordinates: poly }, `${pathLabel}.poly[${pIdx}]`);
			});
		} else if (geom.type === "GeometryCollection") {
			(geom.geometries || []).forEach((g, idx) => inspectGeometry(g, `${pathLabel}.geometries[${idx}]`));
		} else {
			errors.push({
				code: "UNSUPPORTED_GEOMETRY_TYPE",
				field: pathLabel,
				message: `Unsupported geometry type '${geom.type}'.`,
			});
		}
	}

	if (geojson.type === "FeatureCollection") {
		if (!Array.isArray(geojson.features)) {
			errors.push({ code: "INVALID_FEATURE_COLLECTION", field: "features", message: "FeatureCollection must have features array." });
		} else {
			featureCount = geojson.features.length;
			geojson.features.forEach((f, idx) => {
				if (!f || f.type !== "Feature") {
					errors.push({ code: "INVALID_FEATURE", field: `features[${idx}]`, message: "Item is not a GeoJSON Feature." });
				} else {
					inspectGeometry(f.geometry, `features[${idx}].geometry`);
				}
			});
		}
	} else if (geojson.type === "Feature") {
		featureCount = 1;
		inspectGeometry(geojson.geometry, "feature.geometry");
	} else {
		featureCount = 1;
		inspectGeometry(geojson, "geometry");
	}

	return {
		valid: errors.length === 0,
		crs,
		featureCount,
		approximateAreaSqKm: parseFloat(Math.max(0, totalAreaSqKm).toFixed(4)),
		errors,
		warnings,
	};
}

/**
 * Opt-in GeoJSON Geometry Repair (R-11, C-08).
 * Never mutates input; preserves originalGeometry and emits full repairAudit.
 */
function repairGeoJsonGeometry(geojson, options = {}) {
	if (options.repairRequested !== true) {
		return {
			repaired: false,
			requiresOptIn: true,
			reason: "Geometry repair is opt-in only. Pass { repairRequested: true } to run auditable repair preserving the original geometry.",
			originalGeometry: geojson,
		};
	}

	const originalGeometry = JSON.parse(JSON.stringify(geojson));
	const beforeValidation = validateGeoJson(originalGeometry);
	const operations = [];
	let requiresManualGisRepair = false;

	function repairRing(ring, isHole, pathLabel) {
		if (!Array.isArray(ring) || ring.length === 0) return ring;
		let pts = ring.map((c) => [Number(c[0]), Number(c[1])]);

		// 1. Deduplicate consecutive identical vertices
		const deduped = [pts[0]];
		for (let i = 1; i < pts.length; i++) {
			if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) {
				deduped.push(pts[i]);
			}
		}
		if (deduped.length !== pts.length) {
			operations.push(`${pathLabel}: removed ${pts.length - deduped.length} duplicate consecutive vertex/vertices`);
			pts = deduped;
		}

		// 2. Close ring if unclosed
		if (pts.length >= 3) {
			const first = pts[0];
			const last = pts[pts.length - 1];
			if (first[0] !== last[0] || first[1] !== last[1]) {
				pts.push([first[0], first[1]]);
				operations.push(`${pathLabel}: appended closing vertex`);
			}
		}

		// 3. Fix winding order (RFC 7946: exterior CCW, hole CW)
		const area = signedRingArea(pts);
		const shouldBeCCW = !isHole;
		if ((shouldBeCCW && area < 0) || (!shouldBeCCW && area > 0)) {
			pts = pts.slice().reverse();
			operations.push(`${pathLabel}: reversed vertex winding order to ${shouldBeCCW ? "CCW" : "CW"}`);
		}

		// 4. Check if self-intersections remain (we do not arbitrarily drop/reorder intersecting edges silently)
		const check = checkRingValidity(pts, pathLabel, isHole);
		if (check.issues.selfIntersecting) {
			requiresManualGisRepair = true;
			operations.push(`${pathLabel}: self-intersection cannot be repaired safely without ambiguity; flagged for manual GIS topology repair`);
		}

		return pts;
	}

	function repairGeom(geom, pathLabel) {
		if (!geom || typeof geom !== "object") return geom;
		if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
			return {
				...geom,
				coordinates: geom.coordinates.map((r, idx) => repairRing(r, idx > 0, `${pathLabel}.rings[${idx}]`)),
			};
		}
		if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
			return {
				...geom,
				coordinates: geom.coordinates.map((poly, pIdx) =>
					poly.map((r, idx) => repairRing(r, idx > 0, `${pathLabel}.poly[${pIdx}].rings[${idx}]`)),
				),
			};
		}
		return geom;
	}

	const repairedGeojson = JSON.parse(JSON.stringify(geojson));
	if (repairedGeojson.type === "FeatureCollection" && Array.isArray(repairedGeojson.features)) {
		repairedGeojson.features = repairedGeojson.features.map((f, idx) => ({
			...f,
			geometry: repairGeom(f.geometry, `features[${idx}]`),
		}));
	} else if (repairedGeojson.type === "Feature") {
		repairedGeojson.geometry = repairGeom(repairedGeojson.geometry, "feature");
	} else {
		Object.assign(repairedGeojson, repairGeom(repairedGeojson, "geometry"));
	}

	const afterValidation = validateGeoJson(repairedGeojson);
	const areaBefore = beforeValidation.approximateAreaSqKm || 0;
	const areaAfter = afterValidation.approximateAreaSqKm || 0;
	const areaDeltaPercent = areaBefore > 0
		? parseFloat((((areaAfter - areaBefore) / areaBefore) * 100).toFixed(4))
		: 0;

	return {
		repaired: operations.length > 0 && !requiresManualGisRepair,
		requiresManualGisRepair,
		repairedGeoJSON: repairedGeojson,
		originalGeometry,
		validationAfter: afterValidation,
		repairAudit: {
			optInConfirmed: true,
			operations,
			topologyChanged: operations.length > 0,
			areaBeforeSqKm: areaBefore,
			areaAfterSqKm: areaAfter,
			areaDeltaPercent,
			originalGeometryPreserved: true,
		},
	};
}

function parseUtmCrs(crs) {
	const m = String(crs || "").trim().toUpperCase().match(/^EPSG:(326|327)(\d{2})$/);
	if (!m) return null;
	const zone = parseInt(m[2], 10);
	if (zone < 1 || zone > 60) return null;
	return {
		hemisphere: m[1] === "326" ? "N" : "S",
		zone,
	};
}

function lonLatToWebMercator(lon, lat) {
	const clampedLat = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
	const x = (WGS84_A * lon * Math.PI) / 180;
	const latRad = (clampedLat * Math.PI) / 180;
	const y = WGS84_A * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
	return [parseFloat(x.toFixed(4)), parseFloat(y.toFixed(4))];
}

function webMercatorToLonLat(x, y) {
	const lon = ((x / WGS84_A) * 180) / Math.PI;
	const lat = ((2 * Math.atan(Math.exp(y / WGS84_A)) - Math.PI / 2) * 180) / Math.PI;
	return [parseFloat(lon.toFixed(7)), parseFloat(lat.toFixed(7))];
}

function lonLatToUtm(lon, lat, zone, hemisphere) {
	const k0 = 0.9996;
	const lonOriginDeg = (zone - 1) * 6 - 180 + 3;
	const lonRad = (lon * Math.PI) / 180;
	const lonOriginRad = (lonOriginDeg * Math.PI) / 180;
	const latRad = (lat * Math.PI) / 180;

	const sinLat = Math.sin(latRad);
	const cosLat = Math.cos(latRad);
	const tanLat = Math.tan(latRad);

	const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
	const T = tanLat * tanLat;
	const C = WGS84_EP2 * cosLat * cosLat;
	const A = cosLat * (lonRad - lonOriginRad);

	const e4 = WGS84_E2 * WGS84_E2;
	const e6 = e4 * WGS84_E2;
	const M =
		WGS84_A *
		((1 - WGS84_E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad -
			((3 * WGS84_E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad) +
			((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad) -
			((35 * e6) / 3072) * Math.sin(6 * latRad));

	const easting =
		k0 *
			N *
			(A +
				((1 - T + C) * Math.pow(A, 3)) / 6 +
				((5 - 18 * T + T * T + 72 * C - 58 * WGS84_EP2) * Math.pow(A, 5)) / 120) +
		500000.0;

	let northing =
		k0 *
		(M +
			N *
				tanLat *
				((A * A) / 2 +
					((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
					((61 - 58 * T + T * T + 600 * C - 330 * WGS84_EP2) * Math.pow(A, 6)) / 720));

	if (hemisphere === "S" || (hemisphere === "auto" && lat < 0)) {
		northing += 10000000.0;
	}
	return [parseFloat(easting.toFixed(4)), parseFloat(northing.toFixed(4))];
}

function utmToLonLat(easting, northing, zone, hemisphere) {
	const k0 = 0.9996;
	const x = easting - 500000.0;
	const y = hemisphere === "S" ? northing - 10000000.0 : northing;
	const lonOriginDeg = (zone - 1) * 6 - 180 + 3;

	const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
	const M = y / k0;
	const mu =
		M /
		(WGS84_A *
			(1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64 - (5 * Math.pow(WGS84_E2, 3)) / 256));

	const phi1 =
		mu +
		((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
		((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
		((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
		((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu);

	const sinPhi1 = Math.sin(phi1);
	const cosPhi1 = Math.cos(phi1);
	const tanPhi1 = Math.tan(phi1);

	const N1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi1 * sinPhi1);
	const T1 = tanPhi1 * tanPhi1;
	const C1 = WGS84_EP2 * cosPhi1 * cosPhi1;
	const R1 = (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sinPhi1 * sinPhi1, 1.5);
	const D = x / (N1 * k0);

	const latRad =
		phi1 -
		((N1 * tanPhi1) / R1) *
			((D * D) / 2 -
				((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * WGS84_EP2) * Math.pow(D, 4)) / 24 +
				((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * WGS84_EP2 - 3 * C1 * C1) *
					Math.pow(D, 6)) /
					720);

	const lonRad =
		(D -
			((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
			((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * WGS84_EP2 + 24 * T1 * T1) *
				Math.pow(D, 5)) /
				120) /
		cosPhi1;

	const lonDeg = lonOriginDeg + (lonRad * 180) / Math.PI;
	const latDeg = (latRad * 180) / Math.PI;
	return [parseFloat(lonDeg.toFixed(7)), parseFloat(latDeg.toFixed(7))];
}

/**
 * Transform coordinates or GeoJSON between EPSG:4326, EPSG:3857, and WGS84 UTM EPSG:326xx/327xx (R-11)
 */
function transformCrs(input, fromCrs = "EPSG:4326", toCrs = "EPSG:4326") {
	const src = String(fromCrs).toUpperCase().trim();
	const dst = String(toCrs).toUpperCase().trim();
	const supportedSimple = new Set(["EPSG:4326", "EPSG:3857"]);

	const srcUtm = parseUtmCrs(src);
	const dstUtm = parseUtmCrs(dst);
	if (!supportedSimple.has(src) && !srcUtm) {
		throw new Error(`UNSUPPORTED_CRS: Source CRS '${fromCrs}' is not supported. Supported: EPSG:4326, EPSG:3857, EPSG:326xx/327xx.`);
	}
	if (!supportedSimple.has(dst) && !dstUtm) {
		throw new Error(`UNSUPPORTED_CRS: Target CRS '${toCrs}' is not supported. Supported: EPSG:4326, EPSG:3857, EPSG:326xx/327xx.`);
	}

	function transformPoint(pt) {
		const [x, y, ...rest] = pt;
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error(`INVALID_COORDINATES: Non-finite coordinate [${x}, ${y}].`);
		}
		if (src === dst) return [...pt];

		// Step 1: Convert source -> EPSG:4326 [lon, lat]
		let wgs;
		if (src === "EPSG:4326") {
			wgs = [x, y];
		} else if (src === "EPSG:3857") {
			wgs = webMercatorToLonLat(x, y);
		} else {
			wgs = utmToLonLat(x, y, srcUtm.zone, srcUtm.hemisphere);
		}

		// Step 2: Convert EPSG:4326 -> target CRS
		let out;
		if (dst === "EPSG:4326") {
			out = wgs;
		} else if (dst === "EPSG:3857") {
			out = lonLatToWebMercator(wgs[0], wgs[1]);
		} else {
			out = lonLatToUtm(wgs[0], wgs[1], dstUtm.zone, dstUtm.hemisphere);
		}
		return rest.length > 0 ? [...out, ...rest] : out;
	}

	function mapCoords(coords) {
		if (typeof coords[0] === "number") return transformPoint(coords);
		return coords.map((c) => mapCoords(c));
	}

	if (Array.isArray(input)) {
		return {
			transformed: mapCoords(input),
			spatialContext: { crs: dst, sourceCrs: src, datum: "WGS84" },
		};
	}

	const cloned = JSON.parse(JSON.stringify(input));
	if (cloned.type === "FeatureCollection") {
		cloned.features = cloned.features.map((f) => ({
			...f,
			geometry: f.geometry ? { ...f.geometry, coordinates: mapCoords(f.geometry.coordinates) } : null,
		}));
	} else if (cloned.type === "Feature") {
		if (cloned.geometry) cloned.geometry.coordinates = mapCoords(cloned.geometry.coordinates);
	} else if (cloned.coordinates) {
		cloned.coordinates = mapCoords(cloned.coordinates);
	}

	return {
		transformed: cloned,
		spatialContext: { crs: dst, sourceCrs: src, datum: "WGS84" },
	};
}

/**
 * Pure-JS Raster Zonal Statistics within Vector Zone Boundaries (R-11)
 * Distinguishes count vs density_per_sqkm vs continuous values, handles nodata explicitly,
 * validates CRS alignment, and records cell-inclusion & boundary provenance.
 */
function computeRasterZonalStats(rasterGrid, zoneGeoJSON, options = {}) {
	if (!rasterGrid || typeof rasterGrid !== "object") {
		throw new Error("MISSING_REQUIRED_INPUT: rasterGrid object is required.");
	}
	if (!zoneGeoJSON || typeof zoneGeoJSON !== "object") {
		throw new Error("MISSING_REQUIRED_INPUT: zoneGeoJSON polygon/feature is required.");
	}

	const rasterCrs = String(rasterGrid.crs || "EPSG:4326").toUpperCase();
	const zoneCrs = String(options.zoneCrs || "EPSG:4326").toUpperCase();
	if (rasterCrs !== zoneCrs) {
		throw new Error(
			`CRS_MISMATCH: Raster CRS '${rasterCrs}' does not match Zone CRS '${zoneCrs}'. Reproject via transformCrs before computing zonal statistics.`,
		);
	}

	const semantics = rasterGrid.valueSemantics;
	if (!["count", "density_per_sqkm", "continuous"].includes(semantics)) {
		throw new Error(
			`INVALID_RASTER_SEMANTICS: rasterGrid.valueSemantics must be 'count', 'density_per_sqkm', or 'continuous' (received '${semantics}').`,
		);
	}

	const bbox = rasterGrid.bbox;
	const width = rasterGrid.width;
	const height = rasterGrid.height;
	const values = rasterGrid.values;
	if (!Array.isArray(bbox) || bbox.length !== 4 || !width || !height || !Array.isArray(values)) {
		throw new Error("INVALID_RASTER_GRID: rasterGrid must provide bbox [minLon,minLat,maxLon,maxLat], width, height, and values.");
	}

	const nodataVal = rasterGrid.nodata !== undefined ? rasterGrid.nodata : -9999;
	const dx = (bbox[2] - bbox[0]) / width;
	const dy = (bbox[3] - bbox[1]) / height;
	const rowOrder = rasterGrid.rowOrder || "top_to_bottom"; // row 0 at maxLat (standard GeoTIFF) vs bottom_to_top

	const zoneGeom =
		zoneGeoJSON.type === "FeatureCollection"
			? zoneGeoJSON.features[0]?.geometry
			: zoneGeoJSON.type === "Feature"
				? zoneGeoJSON.geometry
				: zoneGeoJSON;

	const inclusionRule = options.inclusionRule || "cell_center_inclusive";
	let validCells = 0;
	let nodataCells = 0;
	let totalCellsIntersected = 0;
	let rawSum = 0;
	let weightedSum = 0;
	let totalCoveredAreaSqKm = 0;
	let minVal = Infinity;
	let maxVal = -Infinity;

	const earthRadiusKm = 6371.0088;
	const rad = Math.PI / 180;

	for (let r = 0; r < height; r++) {
		const latCenter =
			rowOrder === "bottom_to_top"
				? bbox[1] + (r + 0.5) * dy
				: bbox[3] - (r + 0.5) * dy;

		// Approximate geographic cell area on WGS84 sphere: R^2 * dLon_rad * (sin(lat2) - sin(lat1))
		const latBottom = latCenter - dy / 2;
		const latTop = latCenter + dy / 2;
		const cellAreaSqKm =
			earthRadiusKm *
			earthRadiusKm *
			(dx * rad) *
			Math.abs(Math.sin(latTop * rad) - Math.sin(latBottom * rad));

		for (let c = 0; c < width; c++) {
			const lonCenter = bbox[0] + (c + 0.5) * dx;
			const inside = isPointInGeometry([lonCenter, latCenter], zoneGeom);
			if (!inside) continue;

			totalCellsIntersected++;
			const cellVal = Array.isArray(values[0]) ? values[r]?.[c] : values[r * width + c];

			if (
				cellVal === null ||
				cellVal === undefined ||
				cellVal === nodataVal ||
				!Number.isFinite(Number(cellVal))
			) {
				nodataCells++;
				continue;
			}

			const num = Number(cellVal);
			validCells++;
			rawSum += num;
			if (semantics === "density_per_sqkm") {
				weightedSum += num * cellAreaSqKm;
			} else {
				weightedSum += num;
			}
			totalCoveredAreaSqKm += cellAreaSqKm;
			if (num < minVal) minVal = num;
			if (num > maxVal) maxVal = num;
		}
	}

	return {
		valid: true,
		valueSemantics: semantics,
		stats: {
			totalCellsIntersected,
			validCells,
			nodataCells,
			// Never sum density directly as raw counts!
			integratedTotal:
				validCells > 0
					? semantics === "continuous"
						? null
						: parseFloat(weightedSum.toFixed(4))
					: null,
			rawCellSum: validCells > 0 && semantics === "count" ? parseFloat(rawSum.toFixed(4)) : null,
			meanCellValue: validCells > 0 ? parseFloat((rawSum / validCells).toFixed(4)) : null,
			minCellValue: validCells > 0 ? minVal : null,
			maxCellValue: validCells > 0 ? maxVal : null,
			coveredAreaSqKm: parseFloat(totalCoveredAreaSqKm.toFixed(4)),
		},
		spatialContext: {
			crs: rasterCrs,
			cellSizeDeg: [parseFloat(dx.toFixed(8)), parseFloat(dy.toFixed(8))],
			inclusionRule,
			nodataValue: nodataVal,
			boundaryDataset: options.boundaryDataset || zoneGeoJSON.properties?.boundaryDataset || null,
			boundaryVersion: options.boundaryVersion || zoneGeoJSON.properties?.boundaryVersion || null,
		},
		warnings:
			nodataCells > 0
				? [`${nodataCells} intersected raster cell(s) had nodata/non-finite values and were excluded cleanly.`]
				: [],
	};
}

/**
 * Evaluates whether a hazard event falls within target countries or geographic bounding box.
 */
function isEventInCountry(event, targetCountries = ["*"], bbox = null) {
	if (!event) return false;

	const countries = Array.isArray(targetCountries)
		? targetCountries
		: typeof targetCountries === "string"
			? targetCountries.split(",").map((c) => c.trim()).filter(Boolean)
			: ["*"];

	if (countries.length === 0 || countries.includes("*")) {
		return true;
	}

	const normalizedTargets = countries.map((c) => c.toLowerCase());

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

	const rawCountry = (event.country || "").toLowerCase().trim();
	if (
		rawCountry &&
		normalizedTargets.some(
			(t) => rawCountry === t || rawCountry.includes(t) || t.includes(rawCountry),
		)
	) {
		return true;
	}

	const rawPlace = (event.place || "").toLowerCase().trim();
	if (rawPlace && normalizedTargets.some((t) => rawPlace.includes(t))) {
		return true;
	}

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

	const rawTitle = (event.title || event.eventName || "").toLowerCase().trim();
	if (rawTitle && normalizedTargets.some((t) => rawTitle.includes(t))) {
		return true;
	}

	return false;
}

module.exports = {
	createGeodesicBuffer,
	spatialExposureJoin,
	validateGeoJson,
	repairGeoJsonGeometry,
	transformCrs,
	computeRasterZonalStats,
	isEventInCountry,
};
