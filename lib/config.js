/**
 * Centralized Configuration & Environment Settings for DRR Agent Plugin
 * Zero external dependencies: includes a lightweight .env file parser.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

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
		"https://www.gdacs.org/datareport/resources/GDACS_events.geojson",

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

	// DELTA Resilience Core Application MCP Bridge Settings
	DELTA_API_URL: process.env.DELTA_API_URL || "http://localhost:3000/en/api/mcp",
	DELTA_MCP_API_KEY: process.env.DELTA_MCP_API_KEY || "",

	// Network & Security Settings
	HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy || null,
	HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || null,
	NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || null,
	REQUEST_TIMEOUT_MS: parseInt(process.env.DRR_REQUEST_TIMEOUT_MS || "8000", 10),
	USER_AGENT: process.env.DRR_USER_AGENT || "UNDRR-DRR-Agent-Plugin/1.1",

	// Operational Modes
	OFFLINE_MODE:
		process.env.DRR_OFFLINE_MODE === "true" ||
		process.env.DRR_OFFLINE_MODE === "1",
};

/**
 * Helper to fetch JSON over HTTP/HTTPS with proxy, timeout, and custom headers
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

		const parsedUrl = new URL(url);
		const isHttps = parsedUrl.protocol === "https:";
		const client = isHttps ? https : http;

		const headers = {
			"User-Agent": CONFIG.USER_AGENT,
			Accept: "application/json, application/geo+json, */*",
			...customHeaders,
		};

		// If Open-Meteo commercial API key is set, append to query params if targeting Open-Meteo
		let finalUrl = url;
		if (CONFIG.OPENMETEO_API_KEY && url.includes("open-meteo.com")) {
			if (!parsedUrl.searchParams.has("apikey")) {
				parsedUrl.searchParams.set("apikey", CONFIG.OPENMETEO_API_KEY);
				finalUrl = parsedUrl.toString();
			}
		}

		const req = client.get(
			finalUrl,
			{
				headers,
				timeout: CONFIG.REQUEST_TIMEOUT_MS,
			},
			(res) => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					return reject(
						new Error(`HTTP ${res.statusCode}: ${res.statusMessage} (${url})`),
					);
				}
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					try {
						resolve(JSON.parse(data));
					} catch (e) {
						reject(
							new Error(`Failed to parse JSON from ${url}: ${e.message}`),
						);
					}
				});
			},
		);

		req.on("error", (err) => {
			reject(new Error(`Network error querying ${url}: ${err.message}`));
		});

		req.on("timeout", () => {
			req.destroy();
			reject(
				new Error(
					`Request timed out after ${CONFIG.REQUEST_TIMEOUT_MS}ms (${url})`,
				),
			);
		});
	});
}

module.exports = {
	CONFIG,
	loadEnv,
	parseEnvContent,
	fetchJsonWithConfig,
};
