#!/usr/bin/env node
/**
 * Static Critical Infrastructure Dataset Builder (Global & Regional)
 *
 * Downloads, normalizes, and merges open critical infrastructure datasets into a single
 * local GeoJSON FeatureCollection that can be referenced via `defaultExposureFile` in
 * `alerts-config.json` (eliminating per-event live Overpass queries for covered areas).
 *
 * Modes:
 *   --mode global    Build a single static Global Major Infrastructure GeoJSON from:
 *                    - WRI Global Power Plant Database (CC BY 4.0) -> Sendai 'energy'
 *                    - OurAirports large/medium airports (Public Domain) -> Sendai 'transport'
 *                    - Optional --extra-geojson files (e.g. Healthsites.io, World Port Index)
 *   --mode regional  Build a Regional / Multi-Country Static Extract by automatically tiling
 *                    a regional bounding box (or preset) into <= 4.0° Overpass-safe tiles,
 *                    fetching OSM Sendai Target D critical infrastructure, and deduplicating.
 *
 * Supports fully offline operation via --wri-file, --airports-file, --overpass-file, and --extra-geojson.
 * Pure Node.js standard library only.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { CONFIG } = require("../lib/config");
const { ingestOsmInterimCriticalInfra, parseOverpassPayload } = require("../lib/osm-infra");

const DEFAULT_WRI_POWER_PLANTS_URL =
	"https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv";
const DEFAULT_OURAIRPORTS_URL =
	"https://davidmegginson.github.io/ourairports-data/airports.csv";

const REGIONAL_PRESETS = {
	"southeast-asia": {
		label: "Southeast Asia",
		bbox: [92.0, -11.0, 141.0, 28.5],
	},
	philippines: {
		label: "Philippines",
		bbox: [116.5, 4.5, 127.0, 21.2],
	},
	indonesia: {
		label: "Indonesia",
		bbox: [95.0, -11.0, 141.0, 6.0],
	},
	thailand: {
		label: "Thailand",
		bbox: [97.3, 5.6, 105.7, 20.5],
	},
	nepal: {
		label: "Nepal",
		bbox: [80.0, 26.3, 88.2, 30.5],
	},
	caribbean: {
		label: "Caribbean",
		bbox: [-85.0, 10.0, -59.0, 27.5],
	},
	"pacific-islands": {
		label: "Southwest Pacific Islands",
		bbox: [160.0, -24.0, 180.0, -8.0],
	},
};

/**
 * RFC 4180 CSV line parser (handles quoted fields and escaped quotes)
 */
function parseCsvLine(line) {
	const fields = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ",") {
			fields.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	fields.push(current);
	return fields;
}

/**
 * Parse a CSV string into an array of header-keyed objects
 */
function parseCsv(csvText) {
	const lines = String(csvText || "")
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.filter((l) => l.trim().length > 0);
	if (lines.length < 2) return [];
	const headers = parseCsvLine(lines[0]).map((h) => h.trim());
	const rows = [];
	for (let i = 1; i < lines.length; i++) {
		const cols = parseCsvLine(lines[i]);
		const obj = {};
		for (let c = 0; c < headers.length; c++) {
			obj[headers[c]] = cols[c] !== undefined ? cols[c].trim() : "";
		}
		rows.push(obj);
	}
	return rows;
}

/**
 * Fetch UTF-8 text over HTTP/HTTPS with redirect support (up to 5 redirects)
 */
function fetchText(urlString, timeoutMs = 30000, redirectsLeft = 5) {
	if (CONFIG.OFFLINE_MODE) {
		return Promise.reject(
			new Error("DRR_OFFLINE_MODE is enabled; pass local files (--wri-file, --airports-file, --overpass-file) instead."),
		);
	}
	return new Promise((resolve, reject) => {
		let parsed;
		try {
			parsed = new URL(urlString);
		} catch (e) {
			return reject(new Error(`Invalid URL: ${urlString}`));
		}
		const client = parsed.protocol === "https:" ? https : http;
		const req = client.get(
			urlString,
			{
				headers: { "User-Agent": CONFIG.USER_AGENT || "UNDRR-DRR-Agent-Plugin/1.7" },
				timeout: timeoutMs,
			},
			(res) => {
				if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
					res.resume();
					const nextUrl = new URL(res.headers.location, urlString).toString();
					return resolve(fetchText(nextUrl, timeoutMs, redirectsLeft - 1));
				}
				if (res.statusCode < 200 || res.statusCode >= 300) {
					res.resume();
					return reject(new Error(`HTTP ${res.statusCode} fetching ${urlString}`));
				}
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			},
		);
		req.on("timeout", () => {
			req.destroy();
			reject(new Error(`Timeout fetching ${urlString}`));
		});
		req.on("error", reject);
	});
}

function isPointInBbox(lon, lat, bbox) {
	if (!bbox) return true;
	const [minLon, minLat, maxLon, maxLat] = bbox;
	return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

/**
 * Convert WRI Global Power Plant Database CSV into Sendai Target D GeoJSON features
 */
function parseWriPowerPlantsCsv(csvText, options = {}) {
	const rows = parseCsv(csvText);
	const bbox = options.bbox || null;
	const countrySet = options.countries
		? new Set(options.countries.map((c) => c.trim().toUpperCase()))
		: null;
	const features = [];

	for (const r of rows) {
		const lat = Number(r.latitude);
		const lon = Number(r.longitude);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		if (!isPointInBbox(lon, lat, bbox)) continue;

		const iso3 = (r.country || "").toUpperCase();
		const countryLong = r.country_long || "";
		if (countrySet && !countrySet.has(iso3) && !countrySet.has(countryLong.toUpperCase())) {
			continue;
		}

		const id = r.gppd_idnr ? `wri_gppd_${r.gppd_idnr}` : `wri_gppd_${features.length + 1}`;
		const capacityMw = Number(r.capacity_mw);
		features.push({
			type: "Feature",
			properties: {
				id,
				name: r.name || `Power Plant (${id})`,
				category: "energy",
				sector: "energy",
				occupancy_type: "INFRA",
				taxonomy: "IND",
				country: iso3 || countryLong || null,
				primary_fuel: r.primary_fuel || null,
				capacity_mw: Number.isFinite(capacityMw) ? capacityMw : null,
				owner: r.owner || null,
				source: "WRI Global Power Plant Database",
				license: "CC-BY-4.0",
				verificationStatus: "external_unverified",
			},
			geometry: {
				type: "Point",
				coordinates: [Number(lon.toFixed(5)), Number(lat.toFixed(5))],
			},
		});
	}

	return features;
}

/**
 * Convert OurAirports CSV into Sendai Target D GeoJSON features
 */
function parseOurAirportsCsv(csvText, options = {}) {
	const rows = parseCsv(csvText);
	const bbox = options.bbox || null;
	const allowedTypes = new Set(
		options.airportTypes || ["large_airport", "medium_airport"],
	);
	const countrySet = options.countries
		? new Set(options.countries.map((c) => c.trim().toUpperCase()))
		: null;
	const features = [];

	for (const r of rows) {
		if (!allowedTypes.has(r.type)) continue;
		const lat = Number(r.latitude_deg);
		const lon = Number(r.longitude_deg);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		if (!isPointInBbox(lon, lat, bbox)) continue;

		const iso2 = (r.iso_country || "").toUpperCase();
		if (countrySet && !countrySet.has(iso2)) continue;

		const ident = r.ident || r.id || String(features.length + 1);
		features.push({
			type: "Feature",
			properties: {
				id: `ourairports_${ident}`,
				name: r.name || `Airport (${ident})`,
				category: "transport",
				sector: "transport",
				occupancy_type: "INFRA",
				taxonomy: "INFRA_TRANSPORT",
				airport_type: r.type,
				iata_code: r.iata_code || null,
				country: iso2 || null,
				municipality: r.municipality || null,
				source: "OurAirports",
				license: "Public Domain",
				verificationStatus: "external_unverified",
			},
			geometry: {
				type: "Point",
				coordinates: [Number(lon.toFixed(5)), Number(lat.toFixed(5))],
			},
		});
	}

	return features;
}

/**
 * Split a bounding box [minLon, minLat, maxLon, maxLat] into Overpass-safe tiles <= tileSizeDeg
 */
function tileBoundingBox(bbox, tileSizeDeg = 4.0) {
	if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
		throw new Error("tileBoundingBox requires [minLon, minLat, maxLon, maxLat].");
	}
	const [minLon, minLat, maxLon, maxLat] = bbox;
	if (minLon >= maxLon || minLat >= maxLat) {
		throw new Error("Invalid bounding box: min must be strictly less than max.");
	}
	const step = Math.max(0.5, Math.min(4.5, Number(tileSizeDeg) || 4.0));
	const tiles = [];
	for (let lat = minLat; lat < maxLat; lat += step) {
		const nextLat = Math.min(maxLat, lat + step);
		for (let lon = minLon; lon < maxLon; lon += step) {
			const nextLon = Math.min(maxLon, lon + step);
			tiles.push([
				Number(lon.toFixed(4)),
				Number(lat.toFixed(4)),
				Number(nextLon.toFixed(4)),
				Number(nextLat.toFixed(4)),
			]);
		}
	}
	return tiles;
}

function summarizeSectors(features) {
	const counts = {};
	for (const f of features) {
		const sec = f.properties?.sector || f.properties?.category || "other";
		counts[sec] = (counts[sec] || 0) + 1;
	}
	return counts;
}

function deduplicateFeatures(features) {
	const seen = new Set();
	const out = [];
	for (const f of features) {
		const coords = f.geometry?.coordinates;
		const key =
			f.properties?.id ||
			`${f.properties?.name || ""}|${Array.isArray(coords) ? coords.join(",") : ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(f);
	}
	return out;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a Global Major Infrastructure static GeoJSON FeatureCollection
 */
async function buildGlobalStaticInfra(options = {}) {
	const features = [];
	const sources = [];

	if (options.includeWri !== false) {
		const wriCsv = options.wriFile
			? fs.readFileSync(options.wriFile, "utf8")
			: await fetchText(options.wriUrl || DEFAULT_WRI_POWER_PLANTS_URL);
		const wriFeatures = parseWriPowerPlantsCsv(wriCsv, options);
		features.push(...wriFeatures);
		sources.push({
			name: "WRI Global Power Plant Database",
			url: options.wriUrl || DEFAULT_WRI_POWER_PLANTS_URL,
			license: "CC-BY-4.0",
			attribution: "World Resources Institute (WRI) Global Power Plant Database",
			featureCount: wriFeatures.length,
		});
	}

	if (options.includeAirports !== false) {
		const airportsCsv = options.airportsFile
			? fs.readFileSync(options.airportsFile, "utf8")
			: await fetchText(options.airportsUrl || DEFAULT_OURAIRPORTS_URL);
		const airportFeatures = parseOurAirportsCsv(airportsCsv, options);
		features.push(...airportFeatures);
		sources.push({
			name: "OurAirports",
			url: options.airportsUrl || DEFAULT_OURAIRPORTS_URL,
			license: "Public Domain",
			attribution: "OurAirports (Public Domain)",
			featureCount: airportFeatures.length,
		});
	}

	for (const extraPath of options.extraGeoJsonPaths || []) {
		const raw = JSON.parse(fs.readFileSync(extraPath, "utf8"));
		const extraFeatures = Array.isArray(raw.features) ? raw.features : [];
		features.push(...extraFeatures);
		sources.push({
			name: path.basename(extraPath),
			path: extraPath,
			license: raw.metadata?.license || "See source dataset",
			featureCount: extraFeatures.length,
		});
	}

	const deduped = deduplicateFeatures(features);
	return {
		type: "FeatureCollection",
		metadata: {
			mode: "global_major_infrastructure",
			generatedAt: new Date().toISOString(),
			totalFeatures: deduped.length,
			sectorCounts: summarizeSectors(deduped),
			verificationStatus: "external_unverified",
			sources,
			usageHint: "Set defaultExposureFile in alerts-config.json to this file path.",
		},
		features: deduped,
	};
}

/**
 * Build a Regional / Multi-Country Static Extract GeoJSON FeatureCollection
 */
async function buildRegionalStaticInfra(options = {}) {
	const features = [];
	const sources = [];

	if (options.overpassFile) {
		const raw = JSON.parse(fs.readFileSync(options.overpassFile, "utf8"));
		const parsed = parseOverpassPayload(raw, { sectors: options.sectors });
		features.push(...parsed.infraGeoJSON.features);
		sources.push({
			name: "OpenStreetMap (Local Overpass Extract)",
			path: options.overpassFile,
			license: "ODbL-1.0",
			attribution: "© OpenStreetMap contributors",
			featureCount: parsed.infraGeoJSON.features.length,
		});
	} else {
		const bbox = options.bbox || (options.preset ? REGIONAL_PRESETS[options.preset]?.bbox : null);
		if (!bbox) {
			throw new Error(
				`Regional mode requires --bbox minLon,minLat,maxLon,maxLat or --preset (${Object.keys(REGIONAL_PRESETS).join(", ")}).`,
			);
		}
		const tiles = tileBoundingBox(bbox, options.tileSizeDeg || 4.0);
		const delayMs = options.delayMs !== undefined ? Number(options.delayMs) : 1500;
		const tileWarnings = [];

		for (let i = 0; i < tiles.length; i++) {
			const tile = tiles[i];
			if (i > 0 && delayMs > 0) await sleep(delayMs);
			try {
				const res = await ingestOsmInterimCriticalInfra({
					bbox: tile,
					sectors: options.sectors,
					maxElements: options.maxElements || 500,
					timeoutSec: options.timeoutSec || 25,
				});
				if (res?.infraGeoJSON?.features?.length) {
					features.push(...res.infraGeoJSON.features);
				}
			} catch (err) {
				tileWarnings.push(`Tile ${i + 1}/${tiles.length} [${tile.join(",")}]: ${err.message}`);
			}
		}

		sources.push({
			name: "OpenStreetMap (Overpass API Regional Tiled Extract)",
			bbox,
			tilesQueried: tiles.length,
			tileWarnings,
			license: "ODbL-1.0",
			attribution: "© OpenStreetMap contributors",
			featureCount: features.length,
		});
	}

	for (const extraPath of options.extraGeoJsonPaths || []) {
		const raw = JSON.parse(fs.readFileSync(extraPath, "utf8"));
		const extraFeatures = Array.isArray(raw.features) ? raw.features : [];
		features.push(...extraFeatures);
		sources.push({
			name: path.basename(extraPath),
			path: extraPath,
			license: raw.metadata?.license || "See source dataset",
			featureCount: extraFeatures.length,
		});
	}

	const deduped = deduplicateFeatures(features);
	return {
		type: "FeatureCollection",
		metadata: {
			mode: "regional_static_extract",
			preset: options.preset || null,
			generatedAt: new Date().toISOString(),
			totalFeatures: deduped.length,
			sectorCounts: summarizeSectors(deduped),
			verificationStatus: "external_unverified",
			sources,
			usageHint: "Set defaultExposureFile in alerts-config.json to this file path.",
		},
		features: deduped,
	};
}

function parseCliArgs(argv) {
	const args = { extraGeoJsonPaths: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--mode" && argv[i + 1]) args.mode = argv[++i];
		else if (a === "--output" && argv[i + 1]) args.output = argv[++i];
		else if (a === "--preset" && argv[i + 1]) args.preset = argv[++i];
		else if (a === "--bbox" && argv[i + 1]) args.bbox = argv[++i].split(",").map(Number);
		else if (a === "--countries" && argv[i + 1]) args.countries = argv[++i].split(",");
		else if (a === "--sectors" && argv[i + 1]) args.sectors = argv[++i].split(",");
		else if (a === "--airport-types" && argv[i + 1]) args.airportTypes = argv[++i].split(",");
		else if (a === "--wri-file" && argv[i + 1]) args.wriFile = argv[++i];
		else if (a === "--airports-file" && argv[i + 1]) args.airportsFile = argv[++i];
		else if (a === "--overpass-file" && argv[i + 1]) args.overpassFile = argv[++i];
		else if (a === "--extra-geojson" && argv[i + 1]) args.extraGeoJsonPaths.push(argv[++i]);
		else if (a === "--tile-size" && argv[i + 1]) args.tileSizeDeg = Number(argv[++i]);
		else if (a === "--delay-ms" && argv[i + 1]) args.delayMs = Number(argv[++i]);
		else if (a === "--max-elements" && argv[i + 1]) args.maxElements = Number(argv[++i]);
		else if (a === "--no-wri") args.includeWri = false;
		else if (a === "--no-airports") args.includeAirports = false;
		else if (a === "--help" || a === "-h") args.help = true;
	}
	return args;
}

function printHelp() {
	console.log(`DRR Agent Plugin — Static Critical Infrastructure Dataset Builder

Usage:
  node scripts/build-static-infra.js --mode global [options]
  node scripts/build-static-infra.js --mode regional --preset <name> [options]
  node scripts/build-static-infra.js --mode regional --bbox minLon,minLat,maxLon,maxLat [options]

Modes:
  global      Download & merge WRI Global Power Plants (CC BY 4.0) + OurAirports (Public Domain)
              + optional --extra-geojson (e.g. Healthsites.io, World Port Index) into one GeoJSON.
  regional    Tile a regional bounding box into <= 4.0° Overpass-safe tiles and fetch OSM Sendai
              Target D critical infrastructure (ODbL-1.0), deduplicated into one local GeoJSON.

Regional Presets:
  ${Object.keys(REGIONAL_PRESETS).join(", ")}

Options:
  --output <path>         Output GeoJSON path (default: ./data/static-critical-infra-<mode>.geojson)
  --bbox <w,s,e,n>        WGS84 bounding box filter (optional in global mode, required/preset in regional)
  --countries <list>      Comma-separated ISO codes or country names (global mode filter)
  --sectors <list>        Comma-separated Sendai Target D sectors (regional OSM mode)
  --extra-geojson <path>  Merge additional GeoJSON FeatureCollection (repeatable)
  --wri-file <path>       Use local WRI Global Power Plant CSV instead of downloading
  --airports-file <path>  Use local OurAirports CSV instead of downloading
  --overpass-file <path>  Use local Overpass JSON extract instead of querying Overpass API
  --tile-size <deg>       Tile size in degrees for regional Overpass queries (default: 4.0)
  --delay-ms <ms>         Polite delay between Overpass tiles in ms (default: 1500)
`);
}

async function main() {
	const args = parseCliArgs(process.argv.slice(2));
	if (args.help || !args.mode) {
		printHelp();
		process.exit(args.help ? 0 : 1);
	}

	let collection;
	if (args.mode === "global") {
		collection = await buildGlobalStaticInfra(args);
	} else if (args.mode === "regional") {
		collection = await buildRegionalStaticInfra(args);
	} else {
		throw new Error(`Unsupported --mode '${args.mode}'. Expected 'global' or 'regional'.`);
	}

	const defaultOut = path.join(
		process.cwd(),
		"data",
		`static-critical-infra-${args.mode === "regional" && args.preset ? args.preset : args.mode}.geojson`,
	);
	const outPath = path.resolve(args.output || defaultOut);
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(collection, null, 2), "utf8");

	console.log(`✅ Built static critical infrastructure GeoJSON: ${outPath}`);
	console.log(`   Total features: ${collection.metadata.totalFeatures}`);
	console.log(`   Sector breakdown: ${JSON.stringify(collection.metadata.sectorCounts)}`);
	console.log(`   To use in alerts-config.json, set:`);
	console.log(`     "defaultExposureFile": "${path.relative(process.cwd(), outPath).replace(/\\/g, "/")}"`);
}

if (require.main === module) {
	main().catch((err) => {
		console.error(`❌ Error: ${err.message}`);
		process.exit(1);
	});
}

module.exports = {
	DEFAULT_WRI_POWER_PLANTS_URL,
	DEFAULT_OURAIRPORTS_URL,
	REGIONAL_PRESETS,
	parseCsvLine,
	parseCsv,
	parseWriPowerPlantsCsv,
	parseOurAirportsCsv,
	tileBoundingBox,
	buildGlobalStaticInfra,
	buildRegionalStaticInfra,
};
