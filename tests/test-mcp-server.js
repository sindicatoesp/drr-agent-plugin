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

function waitForResponse(id, timeoutMs = 2000) {
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
	assert.strictEqual(listRes.result.tools.length, 10);

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

	// 6. tools/call: drr_delta_push_draft_record (mock: true)
	send({
		jsonrpc: "2.0",
		id: 6,
		method: "tools/call",
		params: {
			name: "drr_delta_push_draft_record",
			arguments: {
				mock: true,
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

	child.kill();
	console.log("✅ MCP Server Stdio tests passed!");
}

run().catch((err) => {
	console.error(err);
	child.kill();
	process.exit(1);
});
