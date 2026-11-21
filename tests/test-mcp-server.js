const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");

console.log("Testing MCP JSON-RPC 2.0 Server Stdio Transport...");

const serverPath = path.join(__dirname, "../bin/mcp-server.js");
const child = spawn("node", [serverPath], {
	stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const responses = [];

child.stdout.on("data", (chunk) => {
	buffer += chunk.toString();
	const lines = buffer.split("\n");
	buffer = lines.pop(); // keep last incomplete line

	for (const line of lines) {
		if (line.trim()) {
			try {
				responses.push(JSON.parse(line));
			} catch (e) {}
		}
	}
});

function send(msg) {
	child.stdin.write(JSON.stringify(msg) + "\n");
}

function waitForResponse(id, timeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const check = () => {
			const found = responses.find((r) => r.id === id);
			if (found) return resolve(found);
			if (Date.now() - start > timeoutMs) {
				return reject(new Error(`Timed out waiting for response id: ${id}`));
			}
			setTimeout(check, 20);
		};
		check();
	});
}

async function run() {
	// 1. initialize
	send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
	const initRes = await waitForResponse(1);
	assert(initRes, "Expected initialize response");
	assert.strictEqual(initRes.result.serverInfo.name, "drr-analytics-mcp");

	// 2. tools/list
	send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
	const listRes = await waitForResponse(2);
	assert(listRes, "Expected tools/list response");
	assert.strictEqual(listRes.result.tools.length, 32);

	// 3. tools/call: drr_fragility_eval
	send({
		jsonrpc: "2.0",
		id: 3,
		method: "tools/call",
		params: {
			name: "drr_fragility_eval",
			arguments: {
				hazardType: "earthquake",
				intensity: 0.35,
				taxonomy: "URM",
			},
		},
	});
	const callRes = await waitForResponse(3);
	assert(callRes, "Expected tools/call response");
	const parsedContent = JSON.parse(callRes.result.content[0].text);
	assert(parsedContent.meanDamageRatio > 0, "MDR must be > 0");
	assert.strictEqual(parsedContent.taxonomy, "URM");

	// 4. tools/call: drr_usgs_earthquake_fetch
	send({
		jsonrpc: "2.0",
		id: 4,
		method: "tools/call",
		params: {
			name: "drr_usgs_earthquake_fetch",
			arguments: {
				minMagnitude: 5.0,
				samplePayload: {
					type: "FeatureCollection",
					features: [
						{
							type: "Feature",
							id: "us7000test",
							properties: { mag: 6.2, place: "Offshore Maule, Chile", mmi: 6.5 },
							geometry: { type: "Point", coordinates: [-73.5, -35.8, 25.0] },
						},
					],
				},
			},
		},
	});
	const usgsRes = await waitForResponse(4);
	assert(usgsRes, "Expected USGS response");
	const usgsParsed = JSON.parse(usgsRes.result.content[0].text);
	assert.strictEqual(usgsParsed.totalEvents, 1);
	assert.strictEqual(usgsParsed.earthquakes[0].magnitude, 6.2);

	// 5. tools/call: drr_openmeteo_forecast
	send({
		jsonrpc: "2.0",
		id: 5,
		method: "tools/call",
		params: {
			name: "drr_openmeteo_forecast",
			arguments: {
				samplePayload: {
					daily: {
						time: ["2026-09-01", "2026-09-02"],
						precipitation_sum: [80.0, 140.0],
						wind_speed_10m_max: [45.0, 60.0],
					},
				},
			},
		},
	});
	const meteoRes = await waitForResponse(5);
	assert(meteoRes, "Expected Open-Meteo response");
	const meteoParsed = JSON.parse(meteoRes.result.content[0].text);
	assert.strictEqual(meteoParsed.anticipatoryAction.alertColor, "Red");

	// 6. tools/call: drr_delta_push_draft_record (mock: true, forwarding name & notes)
	send({
		jsonrpc: "2.0",
		id: 6,
		method: "tools/call",
		params: {
			name: "drr_delta_push_draft_record",
			arguments: {
				mock: true,
				name: "MCP Forwarded Quake Title",
				notes: "MCP Forwarded Audit Note",
				assessment: {
					hazardAssessment: { hazardType: "flood", hazardIntensity: 1.5 },
					sendaiFrameworkMetrics: {
						targetB_AffectedPeople: { totalExposedPopulation: 5000, estimatedDisplacedPopulation: 1200 },
						targetC_DirectEconomicLoss: { estimatedDirectEconomicLossUsd: 4500000 },
					},
				},
			},
		},
	});
	const deltaRes = await waitForResponse(6);
	assert(deltaRes, "Expected DELTA response");
	const deltaParsed = JSON.parse(deltaRes.result.content[0].text);
	assert.strictEqual(deltaParsed.success, true);
	assert.strictEqual(deltaParsed.record.status, "draft");
	assert.strictEqual(deltaParsed.record.source, "drr-agent-plugin");
	assert(deltaParsed.record.locationDesc.includes("MCP Forwarded Quake Title"), "name arg must forward to locationDesc");
	assert(deltaParsed.record.assessmentModes.includes("MCP Forwarded Audit Note"), "notes arg must forward to assessmentModes");

	// 6b. tools/call: drr_delta_docs
	send({
		jsonrpc: "2.0",
		id: 62,
		method: "tools/call",
		params: {
			name: "drr_delta_docs",
			arguments: { mock: true },
		},
	});
	const docsRes = await waitForResponse(62);
	assert(docsRes, "Expected DELTA docs response");
	const docsParsed = JSON.parse(docsRes.result.content[0].text);
	assert(docsParsed.text.includes("DTS Data Model"), "Docs text must contain DTS Data Model");

	// 7. tools/call: drr_cap_alert_generate_validate
	send({
		jsonrpc: "2.0",
		id: 7,
		method: "tools/call",
		params: {
			name: "drr_cap_alert_generate_validate",
			arguments: {
				mode: "generate_xml",
				alertParams: {
					info: {
						event: "Cyclone Warning",
						severity: "Severe",
						urgency: "Immediate",
					},
				},
			},
		},
	});
	const capRes = await waitForResponse(7);
	assert(capRes, "Expected CAP generation response");
	const capParsed = JSON.parse(capRes.result.content[0].text);
	assert(capParsed.validation.isValid, "Generated CAP alert must be valid");
	assert(capParsed.xml.includes("<status>Draft</status>"), "CAP default status must be Draft");

	// 8. tools/call: drr_monitor_check
	send({
		jsonrpc: "2.0",
		id: 8,
		method: "tools/call",
		params: {
			name: "drr_monitor_check",
			arguments: {
				mock: true,
			},
		},
	});
	const monRes = await waitForResponse(8);
	assert(monRes, "Expected monitor response");
	const monParsed = JSON.parse(monRes.result.content[0].text);
	assert(monParsed.timestamp, "Timestamp must be present in monitor output");

	// 9. New R-02..R-15 MCP Tools Coverage over Stdio
	async function callTool(id, toolName, argumentsObj) {
		send({
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: { name: toolName, arguments: argumentsObj },
		});
		const res = await waitForResponse(id);
		assert(res && !res.error, `Tool ${toolName} returned RPC error: ${JSON.stringify(res?.error)}`);
		return JSON.parse(res.result.content[0].text);
	}

	const inputVal = await callTool(9, "drr_input_contract_validate", {
		input: { hazardType: "flood", intensity: 250, intensityUnit: "mm" },
	});
	assert.strictEqual(inputVal.valid, false);
	assert.strictEqual(inputVal.errors[0].code, "UNIT_MISMATCH");

	const provRes = await callTool(10, "drr_source_provenance_manifest", {
		sourceIds: ["usgs:test"],
		evidenceBasis: "modelled",
		approvalStatus: "approved", // must stay draft without verified approval ref
	});
	assert.strictEqual(provRes.governance.approvalStatus, "draft");

	const regList = await callTool(11, "drr_model_registry_list", {});
	assert(Array.isArray(regList.methods) && regList.methods.length >= 7);

	const replayRes = await callTool(12, "drr_assessment_replay_validate", { suite: "synthetic_reference" });
	assert.strictEqual(replayRes.valid, true);

	const sendaiRes = await callTool(13, "drr_sendai_validate", {
		payload: { targetB: { b1DerivedFromDisplacementOnly: true, b1DirectlyAffected: 100, estimatedDisplacedPopulation: 100 } },
	});
	assert.strictEqual(sendaiRes.valid, false);

	const cwRes = await callTool(14, "drr_hazard_crosswalk", { query: "EQ", sourceSystem: "GDACS" });
	assert.strictEqual(cwRes.status, "resolved_exact");
	assert.strictEqual(cwRes.mapping.code, "GH0001");

	const dedupRes = await callTool(15, "drr_event_match_deduplicate", {
		incomingEvents: [{ source: "USGS", externalId: "ev1", hazardType: "earthquake", coordinates: [100, 10], timestamp: "2026-11-10T00:00:00Z" }],
		existingCatalog: [],
	});
	assert.strictEqual(dedupRes.decisions[0].classification, "unique_new_event");

	const geoValRes = await callTool(16, "drr_geojson_validate", {
		geojson: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
	});
	assert.strictEqual(geoValRes.valid, true);

	const repairRes = await callTool(17, "drr_geometry_repair", {
		geojson: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0]]] },
		repairRequested: true,
	});
	assert.strictEqual(repairRes.repaired, true);

	const crsRes = await callTool(18, "drr_crs_transform", {
		input: [100.5, 13.7],
		fromCrs: "EPSG:4326",
		toCrs: "EPSG:3857",
	});
	assert.strictEqual(crsRes.transformed.length, 2);

	const rasterRes = await callTool(19, "drr_raster_zonal_stats", {
		rasterGrid: { crs: "EPSG:4326", bbox: [0, 0, 2, 2], width: 2, height: 2, valueSemantics: "count", values: [1, 2, 3, 4] },
		zoneGeoJSON: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
	});
	assert.strictEqual(rasterRes.stats.integratedTotal, 10);

	const basinRes = await callTool(20, "drr_basin_rainfall_aggregate", {
		stationsOrGrid: [{ id: "s1", dailyPrecipMm: [25, 35] }],
	});
	assert.strictEqual(basinRes.depthStatus, "depth_unavailable");

	const dischRes = await callTool(21, "drr_river_discharge_screen", {
		dailyDischargeM3s: [300, 900],
		returnPeriodThresholds: { q2: 500, q5: 800 },
	});
	assert.strictEqual(dischRes.unit, "m^3/s");
	assert.strictEqual(dischRes.depthStatus, "depth_unavailable");

	const capPubRes = await callTool(22, "drr_cap_publish", {
		xmlString: capParsed.xml,
		channelType: "production",
		destination: "https://cap.example.org/ingest",
	});
	assert.strictEqual(capPubRes.blocked, true);

	const deltaSchemaRes = await callTool(23, "drr_delta_schema_validate", {
		payload: { eventId: "ev_s1", hazardAssessment: { hazardType: "earthquake", hazardIntensity: 0.3 } },
	});
	assert.strictEqual(deltaSchemaRes.valid, true);

	const uncRes = await callTool(24, "drr_uncertainty_propagate", {
		mode: "deterministic_bounds",
		hazardType: "earthquake",
		intensity: 0.35,
		exposedValueUsd: 1000000,
	});
	assert(uncRes.sensitivityRanking.length === 3);

	const ealRes = await callTool(25, "drr_expected_annual_loss", {
		points: [{ returnPeriodYears: 10, loss: 100 }, { returnPeriodYears: 100, loss: 500 }],
		currency: "USD",
		valuationYear: 2026,
	});
	assert(ealRes.expectedAnnualLoss > 0);

	const cbaRes = await callTool(26, "drr_mitigation_cost_benefit", {
		baselineEal: 500000,
		mitigatedEal: 150000,
		capex: 2000000,
		discountRate: 0.05,
		horizonYears: 20,
		currency: "USD",
		valuationYear: 2026,
	});
	assert(cbaRes.quantitativeMetrics.benefitCostRatio > 1);

	const fs = require("fs");
	const stSample = JSON.parse(
		fs.readFileSync(
			path.join(__dirname, "../examples/ogc-sensorthings-gauges/sample-datastreams.json"),
			"utf8",
		),
	);
	const stRes = await callTool(27, "drr_sensorthings_fetch", {
		samplePayload: stSample,
		thresholds: { warning: 2.0, critical: 2.5, unit: "m" },
		asGeoJSON: true,
	});
	assert.strictEqual(stRes.summary.datastreamCount, 3);
	assert.strictEqual(stRes.summary.criticalCount, 1);
	assert.strictEqual(stRes.geojson.type, "FeatureCollection");

	const stacSample = JSON.parse(
		fs.readFileSync(
			path.join(__dirname, "../examples/stac-flood-depth/sample-stac-items.json"),
			"utf8",
		),
	);
	const stacRes = await callTool(28, "drr_stac_hazard_fetch", {
		samplePayload: stacSample,
		asGeoJSON: true,
	});
	assert.strictEqual(stacRes.summary.itemCount, 3);
	assert.strictEqual(stacRes.summary.validatedDepthGridCount, 1);
	assert.strictEqual(stacRes.geojson.type, "FeatureCollection");

	const shakeSample = JSON.parse(
		fs.readFileSync(
			path.join(__dirname, "../examples/fdsn-shakemap-seismic/sample-shakemap-bundle.json"),
			"utf8",
		),
	);
	const shakeRes = await callTool(29, "drr_fdsn_shakemap_fetch", {
		samplePayload: shakeSample,
		asGeoJSON: "contours",
	});
	assert.strictEqual(shakeRes.replacesWald99Gmice, true);
	assert.strictEqual(shakeRes.summary.peakObservedPgaG, 0.528);
	assert.strictEqual(shakeRes.geojson.type, "FeatureCollection");

	// 10. Error propagation verification for invalid input
	send({
		jsonrpc: "2.0",
		id: 99,
		method: "tools/call",
		params: {
			name: "drr_expected_annual_loss",
			arguments: { points: [{ returnPeriodYears: 50, loss: 1000 }], currency: "USD", valuationYear: 2026 },
		},
	});
	const errRes = await waitForResponse(99);
	assert(errRes.error && errRes.error.message.includes("SINGLE_EVENT_CANNOT_ESTABLISH_EAL"));

	fs.rmSync(path.join(__dirname, "../alerts"), { recursive: true, force: true });
	child.kill();
	console.log("✅ MCP Server Stdio tests passed (32 tools + error handling verified)!");
}

run().catch((err) => {
	console.error(err);
	child.kill();
	process.exit(1);
});
