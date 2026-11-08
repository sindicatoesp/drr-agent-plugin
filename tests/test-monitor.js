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

// 4. Test Country Scoping & National DELTA Push Guard
async function testCountryFilter() {
	const mockPayloads = {
		usgs: {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					id: "us_chile_quake",
					properties: {
						mag: 7.0,
						place: "Offshore Maule, Chile",
						time: 1730000000000,
						mmi: 7.2,
					},
					geometry: { type: "Point", coordinates: [-73.5, -35.8] },
				},
				{
					type: "Feature",
					id: "us_vanuatu_quake",
					properties: {
						mag: 6.5,
						place: "Port-Vila, Vanuatu",
						time: 1730000000000,
						mmi: 6.8,
					},
					geometry: { type: "Point", coordinates: [168.3, -17.7] },
				},
			],
		},
	};

	const tempConfigPath = path.join(__dirname, "temp-vanuatu-config.json");

	// Test A: filterFeeds = true (only Vanuatu earthquake triggers alert)
	fs.writeFileSync(
		tempConfigPath,
		JSON.stringify({
			rules: { earthquake: { enabled: true, minMagnitude: 6.0 } },
			countryFilter: {
				enabled: true,
				targetCountries: ["Vanuatu", "VU"],
				filterFeeds: true,
				strictDeltaPush: true,
			},
		}),
	);

	const summaryFiltered = await runMonitoringCycle({
		configPath: tempConfigPath,
		mock: true,
		mockPayloads,
	});

	assert.strictEqual(summaryFiltered.qualifyingEventsTriggered, 1, "Only Vanuatu event should qualify");
	assert.strictEqual(summaryFiltered.alerts[0].eventId, "usgs_us_vanuatu_quake");
	assert.strictEqual(summaryFiltered.alerts[0].deltaRecord.success, true);

	// Test B: filterFeeds = false, strictDeltaPush = true (both trigger alerts, but DELTA push only for Vanuatu)
	fs.writeFileSync(
		tempConfigPath,
		JSON.stringify({
			rules: { earthquake: { enabled: true, minMagnitude: 6.0 } },
			countryFilter: {
				enabled: true,
				targetCountries: ["Vanuatu", "VU"],
				filterFeeds: false,
				strictDeltaPush: true,
			},
		}),
	);

	const summaryGlobal = await runMonitoringCycle({
		configPath: tempConfigPath,
		mock: true,
		mockPayloads,
	});

	assert.strictEqual(summaryGlobal.qualifyingEventsTriggered, 2, "Both events should trigger alerts globally");
	const chileAlert = summaryGlobal.alerts.find((a) => a.eventId === "usgs_us_chile_quake");
	const vanuatuAlert = summaryGlobal.alerts.find((a) => a.eventId === "usgs_us_vanuatu_quake");
	assert.strictEqual(chileAlert.deltaRecord.skipped, true, "Chile quake should be skipped from DELTA push");
	assert.strictEqual(chileAlert.deltaRecord.reason, "country_mismatch");
	assert.strictEqual(vanuatuAlert.deltaRecord.success, true, "Vanuatu quake should be pushed to DELTA");

	fs.unlinkSync(tempConfigPath);
	fs.rmSync(path.join(__dirname, "..", "alerts"), { recursive: true, force: true });
	console.log("✅ Country filtering and DELTA push guard tests passed!");
}

async function run() {
	await testWebhook();
	await testCycle();
	await testCountryFilter();
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
