const assert = require("assert");
const { parseEnvContent, CONFIG } = require("../lib/config");

console.log("Testing Configuration & .env Parser...");

// 1. Test .env content parser
const sampleEnv = `
# Comment line
GDACS_FEED_URL="https://custom-mirror.undrr.org/gdacs.geojson"
USGS_MIN_MAGNITUDE=5.0
DRR_REQUEST_TIMEOUT_MS=12000
OPENMETEO_API_KEY='sample-key-123'
`;

const parsed = parseEnvContent(sampleEnv);
assert.strictEqual(parsed.GDACS_FEED_URL, "https://custom-mirror.undrr.org/gdacs.geojson");
assert.strictEqual(parsed.USGS_MIN_MAGNITUDE, "5.0");
assert.strictEqual(parsed.DRR_REQUEST_TIMEOUT_MS, "12000");
assert.strictEqual(parsed.OPENMETEO_API_KEY, "sample-key-123");

// 2. Test CONFIG defaults
assert(CONFIG.GDACS_FEED_URL.includes("gdacs.org"));
assert(CONFIG.USGS_API_URL.includes("earthquake.usgs.gov"));
assert(CONFIG.OPENMETEO_API_URL.includes("open-meteo.com"));
assert.strictEqual(typeof CONFIG.REQUEST_TIMEOUT_MS, "number");

console.log("✅ Configuration tests passed!");
