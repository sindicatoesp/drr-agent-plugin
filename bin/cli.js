#!/usr/bin/env node
/**
 * Command-Line Interface (CLI) for DRR Analytics & Agent Plugin
 */

const fs = require("fs");
const path = require("path");
const { ingestGdacsAlerts } = require("../lib/gdacs");
const { spatialExposureJoin } = require("../lib/spatial");
const { evaluateSeismicFragility, evaluateFloodDamage, evaluateWindDamage } = require("../lib/fragility");
const { evaluateVulnerabilityMatrix } = require("../lib/vulnerability");
const { generateCapXml, validateCapXml, generateEmergencyBrief } = require("../lib/cap");
const { ingestUsgsEarthquakes } = require("../lib/usgs");
const { fetchWeatherForecast } = require("../lib/openmeteo");
const { pushDraftDisasterRecord, fetchExposureFromDelta } = require("../lib/delta");

function printHelp() {
	console.log(`
DRR Analytics & Agent Plugin CLI v1.2.0
Disaster Risk Reduction Tools: GDACS, USGS, Open-Meteo, Spatial Joins, Fragility, CAP Alerts & DELTA Integration

Usage:
  drr-tool <command> [options]

Commands:
  gdacs                Fetch or parse GDACS active hazard alerts
    --min-level <level>   Min alert score (Green, Orange, Red)
    --type <code>         Event type (EQ, TC, FL, VO)
    --file <path>         Local GeoJSON file instead of live fetch

  usgs                 Query USGS Earthquake Hazards Program feeds
    --min-mag <val>       Min magnitude threshold (default: 4.5)
    --limit <num>         Number of events (default: 20)
    --file <path>         Local USGS GeoJSON file instead of live fetch

  forecast             Open-Meteo Anticipatory Action flood & weather risk
    --lat <num>           Latitude (default: 23.8)
    --lon <num>           Longitude (default: 90.4)
    --days <num>          Forecast days (default: 5)
    --file <path>         Local forecast JSON file instead of live fetch

  fragility            Evaluate GEM/HAZUS structural fragility curves
    --hazard <type>       earthquake, flood, or wind (default: earthquake)
    --intensity <val>     PGA in g (e.g. 0.35), flood depth in m, or wind in km/h
    --taxonomy <code>     Building class (URM, C1_PRE_CODE, C1_MODERATE_CODE, C2, S1, W1)

  spatial-join         Perform deterministic spatial exposure join
    --hazard <file>       Path to hazard footprint GeoJSON
    --exposure <file>     Path to exposed assets GeoJSON FeatureCollection
    --buffer <km>         Buffer radius around epicenter in km

  vulnerability        Compute vulnerability matrix and Sendai Target B, C, D losses
    --spatial <file>      Path to JSON report output from spatial-join
    --hazard <type>       earthquake, flood, or wind
    --intensity <val>     Hazard intensity metric

  cap-generate         Generate OASIS CAP v1.2 XML Alert
    --headline <text>     Alert headline
    --severity <level>    Extreme, Severe, Moderate, Minor
    --urgency <level>     Immediate, Expected, Future
    --event <text>        Event name (e.g. "Earthquake Warning")
    --area-desc <desc>    Geographic description
    --output <file>       Write XML to file (default: stdout)

  cap-validate         Validate a CAP XML file
    <file>                Path to CAP XML file to validate

  delta-push           Push a validated assessment to DELTA Resilience as a Draft record
    --file <path>         Path to vulnerability report JSON
    --name <string>       Optional event title
    --mock                Dry-run simulation without making network requests

Examples:
  drr-tool usgs --min-mag 5.5
  drr-tool delta-push --file vulnerability-report.json --mock
  drr-tool fragility --hazard earthquake --intensity 0.40 --taxonomy URM
  drr-tool cap-validate examples/earthquake-hazus-scenario/output-cap-alert.xml
`);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}

	const command = args[0];
	const options = {};
	for (let i = 1; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			const key = args[i].replace(/^--/, "");
			const next = args[i + 1];
			if (next && !next.startsWith("--")) {
				options[key] = next;
				i++;
			} else {
				options[key] = true;
			}
		} else if (!options._file) {
			options._file = args[i];
		}
	}

	try {
		switch (command) {
			case "fragility": {
				const hazard = options.hazard || "earthquake";
				const intensity = parseFloat(options.intensity || 0.3);
				const taxonomy = options.taxonomy || "URM";

				let result;
				if (hazard === "earthquake") {
					result = evaluateSeismicFragility(taxonomy, intensity);
				} else if (hazard === "flood") {
					result = evaluateFloodDamage(intensity, options.occupancy);
				} else if (hazard === "wind") {
					result = evaluateWindDamage(intensity);
				} else {
					throw new Error(`Unknown hazard type: ${hazard}`);
				}
				console.log(JSON.stringify(result, null, 2));
				break;
			}

			case "gdacs": {
				let samplePayload = null;
				if (options.file) {
					samplePayload = JSON.parse(fs.readFileSync(options.file, "utf8"));
				}
				const events = await ingestGdacsAlerts(samplePayload, {
					minAlertLevel: options["min-level"] || "Green",
					eventType: options.type,
					country: options.country,
				});
				console.log(JSON.stringify({ totalEvents: events.length, events: events.slice(0, 10) }, null, 2));
				break;
			}

			case "usgs": {
				let samplePayload = null;
				if (options.file) {
					samplePayload = JSON.parse(fs.readFileSync(options.file, "utf8"));
				}
				const earthquakes = await ingestUsgsEarthquakes({
					minMagnitude: options["min-mag"] ? parseFloat(options["min-mag"]) : 4.5,
					limit: options.limit ? parseInt(options.limit, 10) : 20,
					samplePayload,
				});
				console.log(JSON.stringify({ totalEvents: earthquakes.length, earthquakes: earthquakes.slice(0, 10) }, null, 2));
				break;
			}

			case "forecast": {
				let samplePayload = null;
				if (options.file) {
					samplePayload = JSON.parse(fs.readFileSync(options.file, "utf8"));
				}
				const forecast = await fetchWeatherForecast({
					latitude: options.lat ? parseFloat(options.lat) : 23.8,
					longitude: options.lon ? parseFloat(options.lon) : 90.4,
					days: options.days ? parseInt(options.days, 10) : 5,
					samplePayload,
				});
				console.log(JSON.stringify(forecast, null, 2));
				break;
			}

			case "spatial-join": {
				if (!options.hazard || !options.exposure) {
					console.error("Error: --hazard and --exposure files are required.");
					process.exit(1);
				}
				const hazardGeoJSON = JSON.parse(fs.readFileSync(options.hazard, "utf8"));
				const exposureGeoJSON = JSON.parse(fs.readFileSync(options.exposure, "utf8"));
				const report = spatialExposureJoin(hazardGeoJSON, exposureGeoJSON, {
					bufferKm: options.buffer ? parseFloat(options.buffer) : undefined,
				});
				console.log(JSON.stringify(report, null, 2));
				break;
			}

			case "vulnerability": {
				if (!options.spatial) {
					console.error("Error: --spatial report JSON file is required.");
					process.exit(1);
				}
				const spatialReport = JSON.parse(fs.readFileSync(options.spatial, "utf8"));
				const matrix = evaluateVulnerabilityMatrix(spatialReport, {
					type: options.hazard || "earthquake",
					intensity: parseFloat(options.intensity || 0.3),
					defaultTaxonomy: options.taxonomy || "URM",
				});
				console.log(JSON.stringify(matrix, null, 2));
				break;
			}

			case "cap-generate": {
				const xml = generateCapXml({
					info: {
						headline: options.headline || "Disaster Alert",
						severity: options.severity || "Severe",
						urgency: options.urgency || "Immediate",
						event: options.event || "Emergency Warning",
						areaDesc: options["area-desc"] || "Impact Zone",
					},
				});
				if (options.output) {
					fs.writeFileSync(options.output, xml, "utf8");
					console.log(`Generated CAP XML written to ${options.output}`);
				} else {
					console.log(xml);
				}
				break;
			}

			case "cap-validate": {
				const filePath = options.file || options._file;
				if (!filePath) {
					console.error("Error: Please provide a CAP XML file path to validate.");
					process.exit(1);
				}
				const xmlContent = fs.readFileSync(filePath, "utf8");
				const res = validateCapXml(xmlContent);
				console.log(JSON.stringify(res, null, 2));
				if (!res.isValid) process.exit(1);
				break;
			}

			case "delta-push": {
				if (!options.file) {
					console.error("Error: --file <vulnerability-report.json> is required.");
					process.exit(1);
				}
				const assessment = JSON.parse(fs.readFileSync(options.file, "utf8"));
				const result = await pushDraftDisasterRecord(assessment, {
					mock: options.mock === true,
				});
				console.log(JSON.stringify(result, null, 2));
				break;
			}

			default:
				console.error(`Unknown command: ${command}. Run with --help for usage.`);
				process.exit(1);
		}
	} catch (err) {
		console.error(`Execution error: ${err.message}`);
		process.exit(1);
	}
}

main();
