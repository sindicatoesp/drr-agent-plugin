const assert = require("assert");
const {
	parseEnvContent,
	CONFIG,
	isBlockedWebhookHost,
	redactUrlSecrets,
	HTTP_KEEPALIVE_AGENT,
	HTTPS_KEEPALIVE_AGENT,
} = require("../lib/config");

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

// 2. Test CONFIG defaults & keep-alive agents
assert(CONFIG.GDACS_FEED_URL.includes("gdacs.org"));
assert(CONFIG.USGS_API_URL.includes("earthquake.usgs.gov"));
assert(CONFIG.OPENMETEO_API_URL.includes("open-meteo.com"));
assert.strictEqual(typeof CONFIG.REQUEST_TIMEOUT_MS, "number");
assert(HTTP_KEEPALIVE_AGENT && HTTP_KEEPALIVE_AGENT.keepAlive === true);
assert(HTTPS_KEEPALIVE_AGENT && HTTPS_KEEPALIVE_AGENT.keepAlive === true);

// 3. Test SSRF host blocking (isBlockedWebhookHost)
assert.strictEqual(isBlockedWebhookHost("localhost"), true, "localhost must be blocked");
assert.strictEqual(isBlockedWebhookHost("sub.localhost"), true, "*.localhost must be blocked");
assert.strictEqual(isBlockedWebhookHost("127.0.0.1"), true, "127.0.0.1 loopback must be blocked");
assert.strictEqual(isBlockedWebhookHost("127.255.0.1"), true, "127.0.0.0/8 must be blocked");
assert.strictEqual(isBlockedWebhookHost("0.0.0.0"), true, "0.0.0.0 must be blocked");
assert.strictEqual(isBlockedWebhookHost("10.0.0.1"), true, "10.0.0.0/8 RFC1918 must be blocked");
assert.strictEqual(isBlockedWebhookHost("172.16.0.1"), true, "172.16.0.0/12 RFC1918 must be blocked");
assert.strictEqual(isBlockedWebhookHost("172.31.255.1"), true, "172.31.x.x RFC1918 must be blocked");
assert.strictEqual(isBlockedWebhookHost("172.32.0.1"), false, "172.32.0.1 public IP must be allowed");
assert.strictEqual(isBlockedWebhookHost("192.168.1.1"), true, "192.168.0.0/16 RFC1918 must be blocked");
assert.strictEqual(isBlockedWebhookHost("169.254.169.254"), true, "Cloud metadata IP must be blocked");
assert.strictEqual(isBlockedWebhookHost("metadata.google.internal"), true, "Cloud metadata hostname must be blocked");
assert.strictEqual(isBlockedWebhookHost("100.64.0.1"), true, "CGNAT 100.64.0.0/10 must be blocked");
assert.strictEqual(isBlockedWebhookHost("[::1]"), true, "IPv6 loopback must be blocked");
assert.strictEqual(isBlockedWebhookHost("::ffff:127.0.0.1"), true, "IPv4-mapped IPv6 loopback must be blocked");
assert.strictEqual(isBlockedWebhookHost("fe80::1"), true, "IPv6 link-local must be blocked");
assert.strictEqual(isBlockedWebhookHost("fd00::1"), true, "IPv6 ULA must be blocked");
assert.strictEqual(isBlockedWebhookHost("hooks.slack.com"), false, "Public webhook host must be allowed");
assert.strictEqual(isBlockedWebhookHost("8.8.8.8"), false, "Public IPv4 must be allowed");

// 4. Test URL secret redaction
const secretUrl = "https://customer-api.open-meteo.com/v1/flood?latitude=13.7&apikey=super_secret_key_999&token=tok_abc";
const redacted = redactUrlSecrets(secretUrl);
assert(!redacted.includes("super_secret_key_999"), "apikey value must be redacted");
assert(!redacted.includes("tok_abc"), "token value must be redacted");
assert(redacted.includes("REDACTED"), "Redacted placeholder must be present");

console.log("✅ Configuration tests passed!");

