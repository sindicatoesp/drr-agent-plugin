const assert = require("assert");
const { generateCapXml, validateCapXml, geojsonToCapPolygon } = require("../lib/cap");

console.log("Testing OASIS CAP v1.2 XML Generation & Validation...");

// 1. Polygon conversion
const ring = [[85.3, 27.7], [85.4, 27.7], [85.4, 27.8], [85.3, 27.8]];
const capPoly = geojsonToCapPolygon(ring);
assert.strictEqual(capPoly, "27.70000,85.30000 27.70000,85.40000 27.80000,85.40000 27.80000,85.30000");

// 2. Generate XML
const xml = generateCapXml({
	identifier: "TEST-ALERT-001",
	sender: "ops@undrr.org",
	status: "Actual",
	msgType: "Alert",
	scope: "Public",
	info: {
		category: "Geo",
		event: "Earthquake Warning",
		urgency: "Immediate",
		severity: "Extreme",
		certainty: "Observed",
		headline: "Major 7.2 Earthquake Shaking Detected",
		description: "Violent shaking reported across provincial capital.",
		instruction: "Take cover under sturdy furniture immediately.",
		areaDesc: "Central Valley",
		coordinates: ring,
	},
});

assert(xml.includes("<identifier>TEST-ALERT-001</identifier>"));
assert(xml.includes("<severity>Extreme</severity>"));
assert(xml.includes("urn:oasis:names:tc:emergency:cap:1.2"));

// 3. Validate generated XML
const validation = validateCapXml(xml);
assert.strictEqual(validation.isValid, true, `Generated XML must be valid: ${validation.errors.join(", ")}`);
assert.strictEqual(validation.errors.length, 0);

// 4. Test validation failure on invalid CAP
const badXml = "<alert><status>InvalidStatus</status></alert>";
const badValidation = validateCapXml(badXml);
assert.strictEqual(badValidation.isValid, false);
assert(badValidation.errors.length > 0);

console.log("✅ CAP XML tests passed!");
