#!/usr/bin/env node
/**
 * Lightweight Zero-Dependency Local Web Server & OSM Tile Proxy
 * Solves OpenStreetMap Tile Usage Policy 403 blocks for browser & presentation viewing.
 * Pure Node.js Standard Library (http, https, fs, path, url). Zero npm packages.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3300", 10);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = path.resolve(__dirname, "..");
const MAX_TILE_BYTES = 5 * 1024 * 1024; // 5 MB max per tile response

const MIME_TYPES = {
	".html": "text/html; charset=UTF-8",
	".htm": "text/html; charset=UTF-8",
	".js": "application/javascript; charset=UTF-8",
	".json": "application/json; charset=UTF-8",
	".geojson": "application/geo+json; charset=UTF-8",
	".css": "text/css; charset=UTF-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".xml": "application/xml; charset=UTF-8",
	".md": "text/markdown; charset=UTF-8",
	".txt": "text/plain; charset=UTF-8",
	".ico": "image/x-icon",
};

// In-memory LRU tile cache and in-flight request deduplication to minimize load on OSM volunteer servers
const tileMemoryCache = new Map();
const inflightTileRequests = new Map();
const MAX_CACHE_ENTRIES = 500;
const OSM_HTTPS_AGENT = new https.Agent({ keepAlive: true, maxSockets: 16 });

const SECURITY_HEADERS = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "SAMEORIGIN",
	"Referrer-Policy": "strict-origin-when-cross-origin",
};

/**
 * Proxy requests to tile.openstreetmap.org with a compliant User-Agent, Referer, LRU cache, and request coalescing
 */
function handleOsmTileProxy(req, res, zStr, xStr, yStr) {
	const z = parseInt(zStr, 10);
	const x = parseInt(xStr, 10);
	const y = parseInt(yStr, 10);
	const maxTileIdx = (1 << z) - 1;

	if (
		!Number.isInteger(z) ||
		z < 0 ||
		z > 19 ||
		!Number.isInteger(x) ||
		x < 0 ||
		x > maxTileIdx ||
		!Number.isInteger(y) ||
		y < 0 ||
		y > maxTileIdx
	) {
		res.writeHead(400, {
			"Content-Type": "text/plain; charset=UTF-8",
			...SECURITY_HEADERS,
		});
		return res.end("400 Bad Request: Invalid slippy map tile coordinates");
	}

	const cacheKey = `${z}/${x}/${y}`;

	if (tileMemoryCache.has(cacheKey)) {
		const cached = tileMemoryCache.get(cacheKey);
		// Refresh LRU position
		tileMemoryCache.delete(cacheKey);
		tileMemoryCache.set(cacheKey, cached);
		res.writeHead(200, {
			"Content-Type": "image/png",
			"Content-Length": cached.length,
			"Cache-Control": "public, max-age=86400",
			"Access-Control-Allow-Origin": "*",
			"X-Proxy-Cache": "HIT",
			...SECURITY_HEADERS,
		});
		return res.end(cached);
	}

	// Coalesce concurrent requests for the same tile
	if (inflightTileRequests.has(cacheKey)) {
		inflightTileRequests.get(cacheKey).push(res);
		return;
	}
	inflightTileRequests.set(cacheKey, [res]);

	function sendToWaiters(statusCode, headers, bodyBufferOrText) {
		const waiters = inflightTileRequests.get(cacheKey) || [];
		inflightTileRequests.delete(cacheKey);
		for (const waiterRes of waiters) {
			if (!waiterRes.headersSent && !waiterRes.writableEnded) {
				waiterRes.writeHead(statusCode, headers);
				waiterRes.end(bodyBufferOrText);
			}
		}
	}

	const osmUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
	const options = {
		agent: OSM_HTTPS_AGENT,
		timeout: 8000,
		headers: {
			// OSM Policy Requirement: descriptive User-Agent with contact or app info
			"User-Agent": "DRR-Agent-Plugin/1.3.0 (UN Sendai & OASIS CAP Analytics; contact@agent-plugins.org)",
			Accept: "image/png,image/*;q=0.8",
			Referer: `http://localhost:${PORT}/`,
		},
	};

	const proxyReq = https.get(osmUrl, options, (osmRes) => {
		if (osmRes.statusCode !== 200) {
			osmRes.resume();
			return sendToWaiters(
				osmRes.statusCode || 502,
				{
					"Content-Type": "text/plain; charset=UTF-8",
					"Access-Control-Allow-Origin": "*",
					...SECURITY_HEADERS,
				},
				`Upstream tile server returned HTTP ${osmRes.statusCode}`,
			);
		}

		const chunks = [];
		let receivedBytes = 0;
		let aborted = false;
		osmRes.on("data", (chunk) => {
			receivedBytes += chunk.length;
			if (receivedBytes > MAX_TILE_BYTES) {
				aborted = true;
				proxyReq.destroy(new Error("Tile response exceeded maximum allowed size"));
				return;
			}
			chunks.push(chunk);
		});
		osmRes.on("end", () => {
			if (aborted) return;
			const buffer = Buffer.concat(chunks, receivedBytes);
			if (tileMemoryCache.size >= MAX_CACHE_ENTRIES) {
				const firstKey = tileMemoryCache.keys().next().value;
				tileMemoryCache.delete(firstKey);
			}
			tileMemoryCache.set(cacheKey, buffer);

			sendToWaiters(
				200,
				{
					"Content-Type": "image/png",
					"Content-Length": buffer.length,
					"Cache-Control": "public, max-age=86400",
					"Access-Control-Allow-Origin": "*",
					"X-Proxy-Cache": "MISS",
					...SECURITY_HEADERS,
				},
				buffer,
			);
		});
	});

	proxyReq.on("timeout", () => {
		proxyReq.destroy(new Error("Request timed out"));
	});

	proxyReq.on("error", (err) => {
		sendToWaiters(
			502,
			{
				"Content-Type": "text/plain; charset=UTF-8",
				"Access-Control-Allow-Origin": "*",
				...SECURITY_HEADERS,
			},
			`OSM Tile Proxy Error: ${err.message}`,
		);
	});
}

const server = http.createServer((req, res) => {
	let pathname;
	try {
		const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
		pathname = decodeURIComponent(parsedUrl.pathname);
	} catch (_) {
		res.writeHead(400, { "Content-Type": "text/plain; charset=UTF-8", ...SECURITY_HEADERS });
		return res.end("400 Bad Request: Malformed URL");
	}

	if (pathname.includes("\0")) {
		res.writeHead(400, { "Content-Type": "text/plain; charset=UTF-8", ...SECURITY_HEADERS });
		return res.end("400 Bad Request");
	}

	// 1. OSM Tile Proxy Route: /osm-tiles/:z/:x/:y.png
	const tileMatch = pathname.match(/^\/osm-tiles\/(\d+)\/(\d+)\/(\d+)\.png$/);
	if (tileMatch) {
		const [, z, x, y] = tileMatch;
		return handleOsmTileProxy(req, res, z, x, y);
	}

	// 2. Health & Info Route: /api/status
	if (pathname === "/api/status") {
		res.writeHead(200, { "Content-Type": "application/json; charset=UTF-8", ...SECURITY_HEADERS });
		return res.end(
			JSON.stringify({
				status: "ok",
				server: "DRR-Agent-Plugin Local Server v1.3.0",
				cachedTiles: tileMemoryCache.size,
				uptime: process.uptime(),
			}),
		);
	}

	// 3. Static File Serving
	let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
	if (safePath === "/" || safePath === "") {
		safePath = "/docs/presentation/gis-map-presentation.html";
	}

	const filePath = path.join(ROOT_DIR, safePath);
	const normalizedRoot = ROOT_DIR.endsWith(path.sep) ? ROOT_DIR : ROOT_DIR + path.sep;

	// Security: prevent path traversal or sibling prefix collision out of repository root
	if (filePath !== ROOT_DIR && !filePath.startsWith(normalizedRoot)) {
		res.writeHead(403, { "Content-Type": "text/plain; charset=UTF-8", ...SECURITY_HEADERS });
		return res.end("403 Forbidden");
	}

	// Security: block dotfiles (.env, .git, etc.) and local credential configs
	const relPath = path.relative(ROOT_DIR, filePath);
	const relSegments = relPath.split(path.sep);
	if (
		relSegments.some((seg) => seg.startsWith(".")) ||
		relPath === "alerts-config.json"
	) {
		res.writeHead(403, { "Content-Type": "text/plain; charset=UTF-8", ...SECURITY_HEADERS });
		return res.end("403 Forbidden: Restricted file");
	}

	fs.stat(filePath, (err, stats) => {
		if (err || !stats.isFile()) {
			res.writeHead(404, { "Content-Type": "text/plain; charset=UTF-8", ...SECURITY_HEADERS });
			return res.end("404 Not Found");
		}

		const ext = path.extname(filePath).toLowerCase();
		const contentType = MIME_TYPES[ext] || "application/octet-stream";

		res.writeHead(200, {
			"Content-Type": contentType,
			"Content-Length": stats.size,
			"Access-Control-Allow-Origin": "*",
			...SECURITY_HEADERS,
		});

		const stream = fs.createReadStream(filePath);
		stream.on("error", () => {
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "text/plain; charset=UTF-8", ...SECURITY_HEADERS });
			}
			res.end("500 Internal Server Error");
		});
		stream.pipe(res);
	});
});

if (require.main === module) {
	server.listen(PORT, HOST, () => {
		console.log("\x1b[1m\x1b[36m==================================================\x1b[0m");
		console.log("\x1b[1m\x1b[32m 🚀 DRR Agent Plugin Presentation & Tile Server \x1b[0m");
		console.log("\x1b[1m\x1b[36m==================================================\x1b[0m");
		console.log(`  \x1b[1mLocal URL:\x1b[0m     http://localhost:${PORT}/docs/presentation/gis-map-presentation.html`);
		console.log(`  \x1b[1mSlide Deck:\x1b[0m    http://localhost:${PORT}/docs/presentation/slides.html`);
		console.log(`  \x1b[1mSitRep HTML:\x1b[0m   http://localhost:${PORT}/examples/earthquake-hazus-scenario/situation-report.html`);
		console.log(`  \x1b[1mOSM Proxy:\x1b[0m     http://localhost:${PORT}/osm-tiles/{z}/{x}/{y}.png`);
		console.log(`\n  \x1b[33mPress Ctrl+C to stop.\x1b[0m\n`);
	});
}

module.exports = { server, handleOsmTileProxy };
