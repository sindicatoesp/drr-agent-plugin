const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadMonitoringRules, runMonitoringCycle, dispatchWebhook } = require("../lib/monitor");

console.log("Testing Automated Monitoring & Early Warning Daemon Engine...");

// 1. Test loadMonitoringRules
const config = loadMonitoringRules();
assert(config.rules, "Rules object must exist");
assert.strictEqual(config.rules.earthquake.minMagnitude, 5.5);
assert.strictEqual(config.rules.gdacs.minAlertLevel, "Orange");

// 2. Test Webhook Dispatcher with empty URL (graceful handling)
async function testWebhook() {
	const res = await dispatchWebhook("", { headline: "Test" });
	assert.strictEqual(res.dispatched, false);
}

// 3. Test runMonitoringCycle with mock payloads
async function testCycle() {
	const testOutputDir = path.join(__dirname, "tmp_alerts");
	if (fs.existsSync(testOutputDir)) {
		fs.rmSync(testOutputDir, { recursive: true, force: true });
	}

	const mockPayloads = {
		usgs: {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					id: "us_test_quake_700",
					properties: {
						mag: 6.8,
						place: "Offshore Maule, Chile",
						time: 1730000000000,
						mmi: 7.2,
						alert: "orange",
					},
					geometry: {
						type: "Point",
						coordinates: [-73.5, -35.8, 25.0],
					},
				},
				{
					type: "Feature",
					id: "us_test_small_quake",
					properties: { mag: 3.5 },
					geometry: { type: "Point", coordinates: [-70.0, -30.0] },
				},
			],
		},
		gdacs: {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: {
						eventid: 888123,
						eventname: "Tropical Cyclone Test",
						eventtype: "TC",
						alertlevel: "Red",
						alertscore: 2.8,
						country: "Vanuatu",
					},
					geometry: {
						type: "Polygon",
						coordinates: [[[168.0, -17.5], [168.5, -17.5], [168.5, -17.0], [168.0, -17.0], [168.0, -17.5]]],
					},
				},
			],
		},
	};

	const exposureFixture = {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: { name: "District Hospital", category: "healthcare", valueUsd: 15000000, population: 600 },
				geometry: { type: "Point", coordinates: [-73.4, -35.7] },
			},
		],
	};

	const summary = await runMonitoringCycle({
		configPath: path.join(__dirname, "..", "alerts-config.example.json"),
		mock: true,
		mockPayloads,
		exposureGeoJSON: exposureFixture,
	});

	assert(summary.eventsChecked >= 2, `Expected at least 2 events checked, got ${summary.eventsChecked}`);
	assert(summary.qualifyingEventsTriggered >= 2, `Expected at least 2 qualifying events, got ${summary.qualifyingEventsTriggered}`);
	assert.strictEqual(summary.alerts.length, summary.qualifyingEventsTriggered);

	const firstAlert = summary.alerts[0];
	assert(firstAlert.filesCreated.capXml, "CAP XML path must be populated");
	assert(fs.existsSync(firstAlert.filesCreated.capXml), "Generated CAP XML file must exist on disk");
	assert(fs.existsSync(firstAlert.filesCreated.brief), "Generated Situation Brief file must exist on disk");
	assert(fs.existsSync(firstAlert.filesCreated.assessment), "Generated Assessment JSON file must exist on disk");

	// Verify DELTA draft record result
	assert.strictEqual(firstAlert.deltaRecord.status, "draft");
	assert.strictEqual(firstAlert.deltaRecord.source, "drr-agent-plugin");

	// Clean up temp test files
	fs.rmSync(path.join(__dirname, "..", "alerts"), { recursive: true, force: true });
	console.log("✅ Automated Monitoring engine tests passed!");
}

async function run() {
	await testWebhook();
	await testCycle();
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
