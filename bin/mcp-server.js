#!/usr/bin/env node
/**
 * Model Context Protocol (MCP) Server for Disaster Risk Reduction (DRR)
 * Standard stdio transport: newline-delimited JSON-RPC 2.0
 */

const readline = require("readline");
const { ingestGdacsAlerts } = require("../lib/gdacs");
const { spatialExposureJoin } = require("../lib/spatial");
const { evaluateSeismicFragility, evaluateFloodDamage, evaluateWindDamage } = require("../lib/fragility");
const { evaluateVulnerabilityMatrix } = require("../lib/vulnerability");
const { generateCapXml, validateCapXml, generateEmergencyBrief } = require("../lib/cap");
const { ingestUsgsEarthquakes } = require("../lib/usgs");
const { fetchWeatherForecast } = require("../lib/openmeteo");
const { pushDraftDisasterRecord, fetchExposureFromDelta } = require("../lib/delta");
const { runMonitoringCycle } = require("../lib/monitor");

const SERVER_NAME = "drr-analytics-mcp";
const SERVER_VERSION = "1.3.0";
const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
	{
		name: "drr_gdacs_fetch",
		description:
			"Ingest and filter GDACS (Global Disaster Alert and Coordination System) active alerts by severity, event type (EQ, TC, FL, VO), or country.",
		inputSchema: {
			type: "object",
			properties: {
				minAlertLevel: {
					type: "string",
					enum: ["Green", "Orange", "Red"],
					description: "Minimum alert score threshold (defaults to Green)",
				},
				eventType: {
					type: "string",
					description: "Event type: EQ (Earthquake), TC (Cyclone), FL (Flood), VO (Volcano)",
				},
				country: {
					type: "string",
					description: "Filter by country name or substring",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test GeoJSON payload to parse instead of fetching live network",
				},
			},
		},
	},
	{
		name: "drr_usgs_earthquake_fetch",
		description:
			"Query the USGS Earthquake Hazards Program for real-time seismic events and calculate estimated Peak Ground Acceleration (PGA in g) from MMI / magnitude.",
		inputSchema: {
			type: "object",
			properties: {
				minMagnitude: {
					type: "number",
					description: "Minimum earthquake magnitude (e.g. 4.5, 6.0)",
				},
				limit: {
					type: "number",
					description: "Maximum number of events to retrieve (default: 20)",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test GeoJSON payload to parse instead of live network",
				},
			},
		},
	},
	{
		name: "drr_openmeteo_forecast",
		description:
			"Retrieve Open-Meteo multi-day weather forecasts and evaluate Anticipatory Action triggers for flash floods, riverine inundation, and storm wind gusts.",
		inputSchema: {
			type: "object",
			properties: {
				latitude: {
					type: "number",
					description: "Target location latitude (e.g. 23.8)",
				},
				longitude: {
					type: "number",
					description: "Target location longitude (e.g. 90.4)",
				},
				days: {
					type: "number",
					description: "Forecast window in days (default: 5)",
				},
				samplePayload: {
					type: "object",
					description: "Optional offline/test forecast payload to parse instead of live network",
				},
			},
		},
	},
	{
		name: "drr_spatial_exposure_join",
		description:
			"Execute deterministic spatial joins between a hazard footprint (Polygon/MultiPolygon GeoJSON) and exposed assets (FeatureCollection of schools, hospitals, population).",
		inputSchema: {
			type: "object",
			required: ["hazardGeoJSON", "exposureGeoJSON"],
			properties: {
				hazardGeoJSON: {
					type: "object",
					description: "GeoJSON Feature or FeatureCollection of hazard zone polygon(s)",
				},
				exposureGeoJSON: {
					type: "object",
					description: "GeoJSON FeatureCollection of exposed infrastructure or population points",
				},
				epicenter: {
					type: "array",
					items: { type: "number" },
					description: "Optional [longitude, latitude] of epicenter / center",
				},
				bufferKm: {
					type: "number",
					description: "Optional radius buffer in kilometers around epicenter",
				},
			},
		},
	},
	{
		name: "drr_fragility_eval",
		description:
			"Calculate GEM/HAZUS structural damage state probabilities (slight, moderate, extensive, complete) and Mean Damage Ratio (MDR) for a given hazard intensity.",
		inputSchema: {
			type: "object",
			required: ["hazardType", "intensity"],
			properties: {
				hazardType: {
					type: "string",
					enum: ["earthquake", "flood", "wind"],
					description: "Type of peril",
				},
				intensity: {
					type: "number",
					description: "Intensity parameter: PGA in g (for earthquake), inundation depth in meters (flood), or wind speed in km/h (wind)",
				},
				taxonomy: {
					type: "string",
					description: "Building taxonomy class: URM, C1_PRE_CODE, C1_MODERATE_CODE, C2, S1, W1 (defaults to URM)",
				},
				occupancy: {
					type: "string",
					description: "Occupancy type for flood: residential_1story, residential_2story, commercial",
				},
			},
		},
	},
	{
		name: "drr_vulnerability_matrix_calc",
		description:
			"Compute the composite vulnerability matrix, estimated direct economic losses (Sendai Target C), displaced persons (Target B), and critical infrastructure impacts (Target D).",
		inputSchema: {
			type: "object",
			required: ["spatialReport"],
			properties: {
				spatialReport: {
					type: "object",
					description: "Report object returned by drr_spatial_exposure_join",
				},
				hazardType: {
					type: "string",
					enum: ["earthquake", "flood", "wind"],
					description: "Peril type (earthquake, flood, wind)",
				},
				intensity: {
					type: "number",
					description: "Hazard intensity metric (PGA in g, depth in m, or wind in km/h)",
				},
				defaultTaxonomy: {
					type: "string",
					description: "Fallback structural taxonomy if not defined in asset properties",
				},
			},
		},
	},
	{
		name: "drr_cap_alert_generate_validate",
		description:
			"Generate and validate an ITU-T X.1303 / OASIS CAP v1.2 standard XML emergency alert, or produce an emergency operations situation brief in markdown.",
		inputSchema: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["generate_xml", "validate_xml", "generate_brief"],
					description: "Action mode: generate_xml, validate_xml, or generate_brief",
				},
				alertParams: {
					type: "object",
					description: "Parameters for CAP XML generation (identifier, sender, status, info)",
				},
				xmlString: {
					type: "string",
					description: "Raw XML string to validate (required for validate_xml mode)",
				},
				context: {
					type: "object",
					description: "Combined hazard, spatial, and vulnerability context (for generate_brief mode)",
				},
			},
		},
	},
	{
		name: "drr_delta_push_draft_record",
		description:
			"Push a validated post-disaster assessment into DELTA Resilience as a 'Draft' record with status: 'draft', source: 'drr-agent-plugin', and Sendai Target B, C, D metrics.",
		inputSchema: {
			type: "object",
			required: ["assessment"],
			properties: {
				assessment: {
					type: "object",
					description: "Assessment object from drr_vulnerability_matrix_calc or manual input",
				},
				name: {
					type: "string",
					description: "Optional disaster event name (e.g. 'Mw 7.2 Mainshock Emergency')",
				},
				notes: {
					type: "string",
					description: "Audit trail notes or context",
				},
				mock: {
					type: "boolean",
					description: "Set to true for dry-run/mock validation without making network calls",
				},
			},
		},
	},
	{
		name: "drr_delta_fetch_exposure",
		description:
			"Query DELTA Resilience core database via MCP for baseline administrative divisions, sector assets, or historical disaster records.",
		inputSchema: {
			type: "object",
			properties: {
				entity: {
					type: "string",
					enum: ["division", "disaster-record", "organization"],
					description: "Entity type to fetch (default: division)",
				},
				filter: {
					type: "object",
					description: "Filter parameters (e.g. page, pageSize)",
				},
				mock: {
					type: "boolean",
					description: "Set to true for mock response without making network calls",
				},
			},
		},
	},
	{
		name: "drr_monitor_check",
		description:
			"Execute an automated monitoring cycle against multi-source disaster feeds (USGS, GDACS, Open-Meteo) using alerts-config.json rules, and trigger spatial/DELTA alerts.",
		inputSchema: {
			type: "object",
			properties: {
				configPath: {
					type: "string",
					description: "Optional custom path to alerts-config.json",
				},
				mock: {
					type: "boolean",
					description: "Set to true to run in dry-run mode",
				},
			},
		},
	},
];

async function handleToolCall(name, args) {
	switch (name) {
		case "drr_gdacs_fetch": {
			const events = await ingestGdacsAlerts(args.samplePayload || null, {
				minAlertLevel: args.minAlertLevel,
				eventType: args.eventType,
				country: args.country,
			});
			return { totalEvents: events.length, events: events.slice(0, 20) };
		}

		case "drr_usgs_earthquake_fetch": {
			const earthquakes = await ingestUsgsEarthquakes({
				minMagnitude: args.minMagnitude,
				limit: args.limit,
				samplePayload: args.samplePayload,
			});
			return { totalEvents: earthquakes.length, earthquakes: earthquakes.slice(0, 20) };
		}

		case "drr_openmeteo_forecast": {
			return fetchWeatherForecast({
				latitude: args.latitude,
				longitude: args.longitude,
				days: args.days,
				samplePayload: args.samplePayload,
			});
		}

		case "drr_spatial_exposure_join": {
			return spatialExposureJoin(
				args.hazardGeoJSON,
				args.exposureGeoJSON,
				{ epicenter: args.epicenter, bufferKm: args.bufferKm },
			);
		}

		case "drr_fragility_eval": {
			if (args.hazardType === "earthquake") {
				return evaluateSeismicFragility(args.taxonomy || "URM", args.intensity);
			} else if (args.hazardType === "flood") {
				return evaluateFloodDamage(args.intensity, args.occupancy);
			} else if (args.hazardType === "wind") {
				return evaluateWindDamage(args.intensity);
			}
			throw new Error(`Unsupported hazard type: ${args.hazardType}`);
		}

		case "drr_vulnerability_matrix_calc": {
			return evaluateVulnerabilityMatrix(args.spatialReport, {
				type: args.hazardType,
				intensity: args.intensity,
				defaultTaxonomy: args.defaultTaxonomy,
			});
		}

		case "drr_cap_alert_generate_validate": {
			const mode = args.mode || "generate_xml";
			if (mode === "generate_xml") {
				const xml = generateCapXml(args.alertParams || {});
				const validation = validateCapXml(xml);
				return { xml, validation };
			} else if (mode === "validate_xml") {
				return validateCapXml(args.xmlString || "");
			} else if (mode === "generate_brief") {
				const brief = generateEmergencyBrief(args.context || {});
				return { markdownBrief: brief };
			}
			throw new Error(`Invalid mode: ${mode}`);
		}

		case "drr_delta_push_draft_record": {
			return pushDraftDisasterRecord(args.assessment || {}, {
				mock: args.mock !== undefined ? args.mock : false,
			});
		}

		case "drr_delta_fetch_exposure": {
			return fetchExposureFromDelta(args.entity || "division", args.filter || {}, {
				mock: args.mock !== undefined ? args.mock : false,
			});
		}

		case "drr_monitor_check": {
			return runMonitoringCycle({
				configPath: args.configPath,
				mock: args.mock !== undefined ? args.mock : false,
			});
		}

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

// JSON-RPC 2.0 stdio loop
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false,
});

function sendResponse(id, result, error = null) {
	const res = { jsonrpc: "2.0", id };
	if (error) {
		res.error = error;
	} else {
		res.result = result;
	}
	process.stdout.write(JSON.stringify(res) + "\n");
}

rl.on("line", async (line) => {
	const trimmed = line.trim();
	if (!trimmed) return;

	let msg;
	try {
		msg = JSON.parse(trimmed);
	} catch (err) {
		sendResponse(null, null, { code: -32700, message: "Parse error" });
		return;
	}

	const { id, method, params } = msg;

	// Notification (no id)
	if (id === undefined || id === null) {
		return;
	}

	try {
		switch (method) {
			case "initialize":
				sendResponse(id, {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
				});
				break;

			case "tools/list":
				sendResponse(id, { tools: TOOLS });
				break;

			case "tools/call":
				if (!params || !params.name) {
					sendResponse(id, null, {
						code: -32602,
						message: "Invalid params: name required",
					});
					return;
				}
				const toolResult = await handleToolCall(params.name, params.arguments || {});
				sendResponse(id, {
					content: [
						{
							type: "text",
							text: JSON.stringify(toolResult, null, 2),
						},
					],
				});
				break;

			case "ping":
				sendResponse(id, {});
				break;

			default:
				sendResponse(id, null, {
					code: -32601,
					message: `Method not found: ${method}`,
				});
				break;
		}
	} catch (err) {
		sendResponse(id, null, {
			code: -32000,
			message: err.message || "Internal server error",
		});
	}
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
