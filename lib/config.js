/**
 * Centralized Configuration & Environment Settings for DRR Agent Plugin
 * Zero external dependencies: includes a lightweight .env file parser.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const net = require("net");

const HTTP_KEEPALIVE_AGENT = new http.Agent({ keepAlive: true, maxSockets: 32 });
const HTTPS_KEEPALIVE_AGENT = new https.Agent({ keepAlive: true, maxSockets: 32 });

/**
 * Check if a hostname or IP address points to a private, loopback, link-local, or cloud metadata address
 * @param {string} hostname
 * @returns {boolean} True if blocked by SSRF guard
 */
function isBlockedWebhookHost(hostname) {
	if (!hostname) return true;
	const clean = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		clean === "localhost" ||
		clean.endsWith(".localhost") ||
		clean === "metadata.google.internal" ||
		clean === "metadata" ||
		clean === "host.docker.internal" ||
		clean === "0.0.0.0" ||
		clean === "::" ||
		clean === "::1"
	) {
		return true;
	}

	// Check IPv4 mapped IPv6 (e.g., ::ffff:127.0.0.1)
	if (clean.startsWith("::ffff:")) {
		return isBlockedWebhookHost(clean.slice(7));
	}

	const ipType = net.isIP(clean);
	if (ipType === 4) {
		const parts = clean.split(".").map(Number);
		const [a, b] = parts;
		if (a === 0 || a === 10 || a === 127) return true;
		if (a === 169 && b === 254) return true; // Link-local & AWS/GCP/Azure metadata (169.254.169.254)
		if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
		if (a === 192 && b === 168) return true; // RFC 1918
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC 6598
		return false;
	}

	if (ipType === 6) {
		if (
			clean === "::1" ||
			clean === "::" ||
			clean.startsWith("fe80:") ||
			clean.startsWith("fc") ||
			clean.startsWith("fd")
		) {
			return true;
		}
	}

	return false;
}

/**
 * Lightweight .env parser (KEY=VALUE with comments and quote handling)
 */
function parseEnvContent(content) {
	const env = {};
	const lines = content.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (match) {
			const key = match[1];
			let val = match[2].trim();
			// Remove surrounding quotes if present
			if (
				(val.startsWith('"') && val.endsWith('"')) ||
				(val.startsWith("'") && val.endsWith("'"))
			) {
				val = val.slice(1, -1);
			}
			env[key] = val;
		}
	}
	return env;
}

/**
 * Auto-discover and load .env file from common locations:
 * 1. process.env.DRR_ENV_FILE
 * 2. Current working directory .env
 * 3. drr-agent-plugin root .env
 * 4. Workspace parent .env
 */
function loadEnv() {
	const candidatePaths = [
		process.env.DRR_ENV_FILE,
		path.join(process.cwd(), ".env"),
		path.join(__dirname, "..", ".env"),
		path.join(__dirname, "..", "..", ".env"),
	].filter(Boolean);

	for (const candidate of candidatePaths) {
		try {
			if (fs.existsSync(candidate)) {
				const content = fs.readFileSync(candidate, "utf8");
				const parsed = parseEnvContent(content);
				for (const [k, v] of Object.entries(parsed)) {
					// Do not overwrite existing process.env variables
					if (process.env[k] === undefined) {
						process.env[k] = v;
					}
				}
				break;
			}
		} catch (err) {
			// Silent fallback
		}
	}
}

// Load .env on module initialization
loadEnv();

/**
 * Resolved Configuration Object
 */
const CONFIG = {
	// GDACS Feed Settings
	GDACS_FEED_URL:
		process.env.GDACS_FEED_URL ||
		"https://www.gdacs.org/gdacsapi/api/events/geteventlist/events4app",

	// USGS Earthquake Hazards Settings
	USGS_API_URL:
		process.env.USGS_API_URL ||
		"https://earthquake.usgs.gov/fdsnws/event/1/query",
	USGS_MIN_MAGNITUDE: parseFloat(process.env.USGS_MIN_MAGNITUDE || "4.5"),
	USGS_DEFAULT_LIMIT: parseInt(process.env.USGS_DEFAULT_LIMIT || "20", 10),

	// Open-Meteo Weather Forecast Settings
	OPENMETEO_API_URL:
		process.env.OPENMETEO_API_URL ||
		(process.env.OPENMETEO_API_KEY
			? "https://customer-api.open-meteo.com/v1/forecast"
			: "https://api.open-meteo.com/v1/forecast"),
	OPENMETEO_API_KEY: process.env.OPENMETEO_API_KEY || null,

	// OGC SensorThings API v1.1 Custom Sensor Telemetry Settings
	OGC_SENSORTHINGS_URL: process.env.OGC_SENSORTHINGS_URL || "",
	OGC_SENSORTHINGS_API_KEY: process.env.OGC_SENSORTHINGS_API_KEY || "",
	OGC_SENSORTHINGS_API_KEY_HEADER:
		process.env.OGC_SENSORTHINGS_API_KEY_HEADER || "X-API-Key",

	// STAC (SpatioTemporal Asset Catalog) v1.0.0 Earth Observation Settings
	STAC_API_URL: process.env.STAC_API_URL || "",
	STAC_API_KEY: process.env.STAC_API_KEY || "",
	STAC_API_KEY_HEADER: process.env.STAC_API_KEY_HEADER || "X-API-Key",

	// Custom National FDSN-WS & ShakeMap Seismic Settings (BMKG, PHIVOLCS, JMA, EMSC, GeoNet)
	FDSN_API_URL: process.env.FDSN_API_URL || "",
	FDSN_API_KEY: process.env.FDSN_API_KEY || "",
	FDSN_API_KEY_HEADER: process.env.FDSN_API_KEY_HEADER || "X-API-Key",

	// OGC API - Features (Critical Infrastructure Overlay Integration)
	OGC_FEATURES_API_URL: process.env.OGC_FEATURES_API_URL || "",
	OGC_FEATURES_API_KEY: process.env.OGC_FEATURES_API_KEY || "",
	OGC_FEATURES_API_KEY_HEADER:
		process.env.OGC_FEATURES_API_KEY_HEADER || "X-API-Key",

	// DELTA Resilience Core Application MCP Bridge Settings
	DELTA_API_URL: process.env.DELTA_API_URL || "http://localhost:3000/en/api/mcp",
	DELTA_MCP_API_KEY: process.env.DELTA_MCP_API_KEY || "",

	// National Deployment & Country Filtering Settings
	DELTA_COUNTRY: process.env.DELTA_COUNTRY || null,
	DELTA_COUNTRY_STRICT:
		process.env.DELTA_COUNTRY_STRICT === "true" ||
		process.env.DELTA_COUNTRY_STRICT === "1" ||
		Boolean(process.env.DELTA_COUNTRY || process.env.TARGET_COUNTRIES),
	TARGET_COUNTRIES: process.env.TARGET_COUNTRIES
		? process.env.TARGET_COUNTRIES.split(",").map((c) => c.trim()).filter(Boolean)
		: process.env.DELTA_COUNTRY
			? [process.env.DELTA_COUNTRY.trim()]
			: ["*"],

	// Network & Security Settings
	HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy || null,
	HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || null,
	NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || null,
	ALLOW_PRIVATE_WEBHOOKS:
		process.env.DRR_ALLOW_PRIVATE_WEBHOOKS === "true" ||
		process.env.DRR_ALLOW_PRIVATE_WEBHOOKS === "1",
	REQUEST_TIMEOUT_MS: parseInt(process.env.DRR_REQUEST_TIMEOUT_MS || "8000", 10),
	MAX_RESPONSE_BYTES: parseInt(
		process.env.DRR_MAX_RESPONSE_BYTES || String(15 * 1024 * 1024),
		10,
	),
	USER_AGENT:
		process.env.DRR_USER_AGENT ||
		`UNDRR-DRR-Agent-Plugin/${require("../package.json").version}`,

	// Operational Modes
	OFFLINE_MODE:
		process.env.DRR_OFFLINE_MODE === "true" ||
		process.env.DRR_OFFLINE_MODE === "1",
	DRR_OFFLINE_MODE:
		process.env.DRR_OFFLINE_MODE === "true" ||
		process.env.DRR_OFFLINE_MODE === "1",
};

const SECRET_QUERY_PARAMS = new Set([
	"apikey",
	"api_key",
	"token",
	"access_token",
	"secret",
	"password",
	"key",
]);

/**
 * Redact sensitive query parameters (e.g. apikey, token, secret) and credentials from URLs before logging/throwing errors
 */
function redactUrlSecrets(rawUrl) {
	try {
		const u = new URL(rawUrl);
		if (u.username) u.username = "[REDACTED]";
		if (u.password) u.password = "[REDACTED]";
		for (const param of Array.from(u.searchParams.keys())) {
			if (SECRET_QUERY_PARAMS.has(param.toLowerCase())) {
				u.searchParams.set(param, "[REDACTED]");
			}
		}
		return u.toString();
	} catch (_) {
		return String(rawUrl).replace(
			/([?&](?:apikey|api_key|token|access_token|secret|password|key)=)[^&]+/gi,
			"$1[REDACTED]",
		);
	}
}

/**
 * Helper to fetch JSON over HTTP/HTTPS with proxy, timeout, keep-alive, and custom headers
 * @param {string} url - Target URL
 * @param {object} customHeaders - Optional headers object
 * @returns {Promise<object>} Parsed JSON response
 */
function fetchJsonWithConfig(url, customHeaders = {}) {
	return new Promise((resolve, reject) => {
		if (CONFIG.OFFLINE_MODE) {
			return reject(
				new Error(
					`Network fetch blocked: DRR_OFFLINE_MODE is enabled. Supply offline samplePayload instead.`,
				),
			);
		}

		let parsedUrl;
		try {
			parsedUrl = new URL(url);
		} catch (err) {
			return reject(new Error(`Invalid URL: ${url}`));
		}

		if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
			return reject(new Error(`Unsupported protocol: ${parsedUrl.protocol}`));
		}

		const isHttps = parsedUrl.protocol === "https:";
		const client = isHttps ? https : http;
		const agent = isHttps ? HTTPS_KEEPALIVE_AGENT : HTTP_KEEPALIVE_AGENT;

		const headers = {
			"User-Agent": CONFIG.USER_AGENT,
			Accept: "application/json, application/geo+json, */*",
			...customHeaders,
		};

		// If Open-Meteo commercial API key is set, append to query params if targeting Open-Meteo
		let finalUrl = url;
		if (CONFIG.OPENMETEO_API_KEY && parsedUrl.hostname.endsWith("open-meteo.com")) {
			if (!parsedUrl.searchParams.has("apikey")) {
				parsedUrl.searchParams.set("apikey", CONFIG.OPENMETEO_API_KEY);
				finalUrl = parsedUrl.toString();
			}
		}

		const safeUrlLabel = redactUrlSecrets(url);

		const req = client.get(
			finalUrl,
			{
				headers,
				agent,
				timeout: CONFIG.REQUEST_TIMEOUT_MS,
			},
			(res) => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					res.resume();
					return reject(
						new Error(`HTTP ${res.statusCode}: ${res.statusMessage} (${safeUrlLabel})`),
					);
				}
				const chunks = [];
				let receivedBytes = 0;
				let aborted = false;
				res.on("data", (chunk) => {
					const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					receivedBytes += buf.length;
					if (receivedBytes > CONFIG.MAX_RESPONSE_BYTES) {
						aborted = true;
						req.destroy(
							new Error(
								`Response from ${safeUrlLabel} exceeded maximum size limit (${CONFIG.MAX_RESPONSE_BYTES} bytes)`,
							),
						);
						return;
					}
					chunks.push(buf);
				});
				res.on("end", () => {
					if (aborted) return;
					try {
						const data = Buffer.concat(chunks, receivedBytes).toString("utf8");
						resolve(JSON.parse(data));
					} catch (e) {
						reject(
							new Error(`Failed to parse JSON from ${safeUrlLabel}: ${e.message}`),
						);
					}
				});
			},
		);

		req.on("error", (err) => {
			reject(new Error(`Network error querying ${safeUrlLabel}: ${err.message}`));
		});

		req.on("timeout", () => {
			req.destroy();
			reject(
				new Error(
					`Request timed out after ${CONFIG.REQUEST_TIMEOUT_MS}ms (${safeUrlLabel})`,
				),
			);
		});
	});
}

module.exports = {
	CONFIG,
	HTTP_KEEPALIVE_AGENT,
	HTTPS_KEEPALIVE_AGENT,
	isBlockedWebhookHost,
	redactUrlSecrets,
	loadEnv,
	parseEnvContent,
	fetchJsonWithConfig,
};
