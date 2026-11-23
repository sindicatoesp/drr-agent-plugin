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

// 2. Test Webhook Dispatcher with empty URL and SSRF protection
async function testWebhook() {
	const res = await dispatchWebhook("", { headline: "Test" });
	assert.strictEqual(res.dispatched, false);

	const ssrfLoopback = await dispatchWebhook("http://127.0.0.1:8080/internal-admin", { headline: "Test" });
	assert.strictEqual(ssrfLoopback.dispatched, false);
	assert(ssrfLoopback.reason.includes("SSRF guard blocked"), "Loopback webhook must be blocked by SSRF guard");

	const ssrfMetadata = await dispatchWebhook("http://169.254.169.254/latest/meta-data/", { headline: "Test" });
	assert.strictEqual(ssrfMetadata.dispatched, false);
	assert(ssrfMetadata.reason.includes("SSRF guard blocked"), "Cloud metadata webhook must be blocked by SSRF guard");
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
	fs.rmSync(path.join(__dirname, "alerts"), { recursive: true, force: true });
	fs.rmSync(path.join(__dirname, "..", "alerts"), { recursive: true, force: true });
	console.log("✅ Country filtering and DELTA push guard tests passed!");
}

async function testTieredReportingAndExposureCoverage() {
	const { processQualifyingEvent } = require("../lib/monitor");
	const tmpAlertsDir = path.join(__dirname, "tmp-tiered-alerts");
	fs.rmSync(tmpAlertsDir, { recursive: true, force: true });

	const unrelatedExposure = {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: { id: "b1", name: "Remote Building", population: 500, valueUsd: 1000000 },
				geometry: { type: "Point", coordinates: [100.5, 13.5] },
			},
		],
	};

	// 1. GREEN event -> suppressed (ledger_only), 0 files written to disk
	const greenRes = await processQualifyingEvent(
		{
			id: "usgs_green_fiji",
			title: "M 5.5 - Fiji region",
			place: "Fiji region",
			magnitude: 5.5,
			magType: "mww",
			depthKm: 469.9,
			mmi: 1.73,
			estimatedPgaG: 0.0078,
			alertLevel: "green",
			tsunamiAlert: false,
			coordinates: [-177.82, -19.56],
			source: "USGS",
		},
		{ outputDirectory: tmpAlertsDir, reportPolicy: { minReportAlertLevel: "Yellow" } },
		{ exposureGeoJSON: unrelatedExposure, mock: true },
	);
	assert.strictEqual(greenRes.reportMode, "ledger_only");
	assert.strictEqual(greenRes.reportSuppressed, true);
	assert.strictEqual(greenRes.filesCreated, null);
	assert.strictEqual(greenRes.exposureCoverage.status, "outside_exposure_coverage");
	assert(!fs.existsSync(tmpAlertsDir), "GREEN event must not create alert report files by default");

	// 2. YELLOW event -> advisory mode (brief.md + assessment.json only, no CAP/SitRep), rich metadata + honest coverage
	const yellowRes = await processQualifyingEvent(
		{
			id: "usgs_yellow_china",
			title: "M 5.9 - 238 km SW of Yanglong, China",
			place: "238 km SW of Yanglong, China",
			magnitude: 5.9,
			magType: "mww",
			depthKm: 10.0,
			mmi: 7.5,
			estimatedPgaG: 0.3239,
			alertLevel: "yellow",
			tsunamiAlert: false,
			time: "2026-11-22T12:00:00Z",
			url: "https://earthquake.usgs.gov/earthquakes/eventpage/us6000ucly",
			coordinates: [97.5, 37.2],
			source: "USGS",
		},
		{ outputDirectory: tmpAlertsDir, reportPolicy: { minReportAlertLevel: "Yellow", writeFullPackageOnYellow: false } },
		{ exposureGeoJSON: unrelatedExposure, mock: true },
	);
	assert.strictEqual(yellowRes.reportMode, "advisory");
	assert.strictEqual(yellowRes.reportSuppressed, false);
	assert(yellowRes.filesCreated.brief && yellowRes.filesCreated.assessment);
	assert.strictEqual(yellowRes.filesCreated.capXml, undefined);
	assert(fs.existsSync(yellowRes.filesCreated.brief));
	assert(!fs.existsSync(path.join(tmpAlertsDir, "usgs_yellow_china.cap.xml")));

	const yellowBrief = fs.readFileSync(yellowRes.filesCreated.brief, "utf8");
	assert(yellowBrief.includes("🟡 Hazard Advisory Brief"), "YELLOW brief must use yellow badge and advisory heading");
	assert(yellowBrief.includes("M 5.9 (mww)"), "Brief must include magnitude & type");
	assert(yellowBrief.includes("10.0 km"), "Brief must include focal depth");
	assert(yellowBrief.includes("DATA UNAVAILABLE (unknown ≠ 0)"), "Brief must not falsely report 0 exposed when exposure layer is outside region");
	assert(!yellowBrief.includes("Activate civil defense reception centers for approximately **0**"), "Brief must never advise opening shelters for 0 displaced");

	// 3. RED / tsunami event -> full_emergency (all 4 files)
	const redRes = await processQualifyingEvent(
		{
			id: "usgs_red_tsunami",
			title: "M 7.4 - Offshore Tsunami Event",
			place: "Offshore",
			magnitude: 7.4,
			depthKm: 15.0,
			estimatedPgaG: 0.45,
			alertLevel: "green",
			tsunamiAlert: true,
			coordinates: [100.5, 13.5],
			source: "USGS",
		},
		{ outputDirectory: tmpAlertsDir, reportPolicy: { minReportAlertLevel: "Yellow" } },
		{ exposureGeoJSON: unrelatedExposure, mock: true },
	);
	assert.strictEqual(redRes.reportMode, "full_emergency");
	assert.strictEqual(redRes.reportSuppressed, false);
	assert(fs.existsSync(redRes.filesCreated.capXml));
	assert(fs.existsSync(redRes.filesCreated.sitrepHtml));
	const redCap = fs.readFileSync(redRes.filesCreated.capXml, "utf8");
	assert(redCap.includes("<identifier>DRR-MONITOR-usgs_red_tsunami</identifier>"));
	assert(redCap.includes("<sender>monitor@drr-agent-plugin.local</sender>"));
	assert(!redCap.includes("preventionweb.net"));
	assert(redCap.includes("<severity>Extreme</severity>"));
	assert(redCap.includes("<urgency>Immediate</urgency>"));

	fs.rmSync(tmpAlertsDir, { recursive: true, force: true });
	console.log("✅ Tiered reporting policy & honest exposure coverage tests passed!");
}

async function run() {
	await testWebhook();
	await testCycle();
	await testCountryFilter();
	await testTieredReportingAndExposureCoverage();
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
