#!/usr/bin/env node
/**
 * Command-Line Interface (CLI) for DRR Analytics & Agent Plugin
 */

const fs = require("fs");
const { ingestGdacsAlerts } = require("../lib/gdacs");
const {
	spatialExposureJoin,
	validateGeoJson,
	repairGeoJsonGeometry,
	transformCrs,
	computeRasterZonalStats,
} = require("../lib/spatial");
const { evaluateSeismicFragility, evaluateFloodDamage, evaluateWindDamage } = require("../lib/fragility");
const { evaluateVulnerabilityMatrix } = require("../lib/vulnerability");
const { generateCapXml, validateCapXml, generateEmergencyBrief, generateVisualSitRepHtml } = require("../lib/cap");
const { ingestUsgsEarthquakes } = require("../lib/usgs");
const { fetchWeatherForecast } = require("../lib/openmeteo");
const { aggregateBasinRainfall, screenRiverDischarge } = require("../lib/hydro");
const { pushDraftDisasterRecord, fetchDeltaDocs, fetchDeltaHazards, validateDeltaSchema } = require("../lib/delta");
const { runOnce, runMonitoringCycle, startMonitoringDaemon } = require("../lib/monitor");
const { validateInputContract } = require("../lib/contracts");
const { listRegisteredMethods, checkDomainApplicability } = require("../lib/registry");
const { runReplayValidation } = require("../lib/replay");
const { validateSendaiSubmission } = require("../lib/sendai");
const { crosswalkHazard } = require("../lib/hips");
const { matchAndDeduplicateEvents } = require("../lib/events");
const { propagateUncertainty } = require("../lib/uncertainty");
const { calculateExpectedAnnualLoss, evaluateMitigationCostBenefit } = require("../lib/appraisal");
const { ingestSensorThings, toSensorGeoJSON } = require("../lib/sensorthings");

function printHelp() {
	console.log(`
DRR Analytics & Agent Plugin CLI v1.4.0
Disaster Risk Reduction Tools: GDACS, USGS, Open-Meteo, OGC SensorThings, Hydro, Spatial/CRS/Raster, Fragility, CAP Alerts, Sendai, DELTA, Uncertainty, Appraisal & Replay

Usage:
  drr-tool <command> [options]

Commands:
  gdacs                Fetch or parse GDACS active hazard alerts
  usgs                 Query USGS Earthquake Hazards Program (Wald99 GMICE PGA)
  forecast             Open-Meteo Anticipatory Action rainfall-threshold screening
  sensorthings         Ingest custom government/private OGC SensorThings API v1.1 gauges
  basin-rainfall       Aggregate rainfall forecasts (mm) across catchment polygon/points
  river-discharge      Screen GloFAS / Open-Meteo river discharge (m^3/s)
  fragility            Evaluate GEM/HAZUS structural fragility curves (requires --intensity)
  spatial-join         Perform deterministic spatial exposure join
  geojson-validate     Validate GeoJSON topology, winding, and antimeridian spans
  geometry-repair      Opt-in GeoJSON ring closure & winding repair (--repair)
  crs-transform        Transform GeoJSON/coordinates between EPSG:4326, EPSG:3857, UTM
  raster-zonal-stats   Compute zonal stats for gridded count/density/continuous rasters
  vulnerability        Compute vulnerability matrix & Sendai metrics (requires --intensity)
  sendai-validate      Validate Sendai Target B/D/normalization semantics
  hazard-crosswalk     Resolve UNDRR-ISC HIP code/alias or generate candidates
  event-dedup          Match & deduplicate multi-source hazard event feeds
  validate-input       Validate DRR assessment input contract & missing-data semantics
  registry             List registered scientific models or check domain applicability
  replay-validate      Run frozen-input reference & hindcast replay validation suite
  uncertainty          Propagate deterministic bounds, OAT sensitivity, or seeded Monte Carlo
  eal                  Integrate multi-return-period loss-exceedance curve (Expected Annual Loss)
  cba                  Evaluate DRR mitigation Cost-Benefit Analysis (NPV, BCR, sensitivity)
  cap-generate         Generate OASIS CAP v1.2 XML Alert (defaults to Draft status)
  cap-validate         Validate CAP XML file (XXE-hardened + separated C-07 state check)
  sitrep               Synthesize executive Situation Brief or visual HTML SitRep
  delta-validate       Validate DELTA relational schema & wire payload integrity
  delta-push           Push schema-validated assessment to DELTA Resilience as Draft
  delta-docs           Query DELTA MCP 'docs' tool for data model & workflow reference
  delta-hazards        Retrieve UNDRR/ISC HIP hazards list
  monitor              Automated multi-source hazard telemetry monitor
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
				if (options.intensity === undefined || options.intensity === true) {
					throw new Error("MISSING_REQUIRED_INPUT: --intensity <number> is required (silent defaults removed).");
				}
				const hazard = options.hazard || "earthquake";
				const intensity = parseFloat(options.intensity);
				const taxonomy = options.taxonomy || "URM";
				const opts = { unit: options.unit, mode: options.mode || "exploratory" };

				let result;
				if (hazard === "earthquake") {
					result = evaluateSeismicFragility(taxonomy, intensity, opts);
				} else if (hazard === "flood") {
					result = evaluateFloodDamage(intensity, options.occupancy || "residential_1story", opts);
				} else if (hazard === "wind") {
					result = evaluateWindDamage(intensity, opts);
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

			case "basin-rainfall": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(aggregateBasinRainfall(payload), null, 2));
				break;
			}

			case "river-discharge": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(screenRiverDischarge(payload), null, 2));
				break;
			}

			case "spatial-join": {
				if (!options.hazard || !options.exposure) {
					throw new Error("Error: --hazard and --exposure files are required.");
				}
				const hazardGeoJSON = JSON.parse(fs.readFileSync(options.hazard, "utf8"));
				const exposureGeoJSON = JSON.parse(fs.readFileSync(options.exposure, "utf8"));
				const report = spatialExposureJoin(hazardGeoJSON, exposureGeoJSON, {
					bufferKm: options.buffer ? parseFloat(options.buffer) : undefined,
				});
				console.log(JSON.stringify(report, null, 2));
				break;
			}

			case "geojson-validate": {
				const geojson = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				const res = validateGeoJson(geojson, { crs: options.crs || "EPSG:4326" });
				console.log(JSON.stringify(res, null, 2));
				if (!res.valid) process.exit(1);
				break;
			}

			case "geometry-repair": {
				const geojson = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(repairGeoJsonGeometry(geojson, { repairRequested: options.repair === true }), null, 2));
				break;
			}

			case "crs-transform": {
				const data = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(transformCrs(data, options.from || "EPSG:4326", options.to || "EPSG:3857"), null, 2));
				break;
			}

			case "raster-zonal-stats": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(computeRasterZonalStats(payload.rasterGrid, payload.zoneGeoJSON, payload.options || {}), null, 2));
				break;
			}

			case "vulnerability": {
				if (!options.spatial) {
					throw new Error("Error: --spatial report JSON file is required.");
				}
				if (options.intensity === undefined || options.intensity === true) {
					throw new Error("MISSING_REQUIRED_INPUT: --intensity <number> is required (silent defaults removed).");
				}
				const spatialReport = JSON.parse(fs.readFileSync(options.spatial, "utf8"));
				const matrix = evaluateVulnerabilityMatrix(spatialReport, {
					type: options.hazard || "earthquake",
					intensity: parseFloat(options.intensity),
					unit: options.unit,
					defaultTaxonomy: options.taxonomy || "URM",
					currency: options.currency || "USD",
					valuationYear: options["valuation-year"] ? parseInt(options["valuation-year"], 10) : null,
				});
				console.log(JSON.stringify(matrix, null, 2));
				break;
			}

			case "sendai-validate": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				const res = validateSendaiSubmission(payload);
				console.log(JSON.stringify(res, null, 2));
				if (!res.valid) process.exit(1);
				break;
			}

			case "hazard-crosswalk": {
				const query = options.query || options._file;
				console.log(JSON.stringify(crosswalkHazard(query, { sourceSystem: options.source }), null, 2));
				break;
			}

			case "event-dedup": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(matchAndDeduplicateEvents(payload.incomingEvents || [], payload.existingCatalog || []), null, 2));
				break;
			}

			case "validate-input": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				const res = validateInputContract(payload, { strictMissingData: options.strict === true });
				console.log(JSON.stringify(res, null, 2));
				if (!res.valid) process.exit(1);
				break;
			}

			case "registry": {
				if (options.method) {
					console.log(JSON.stringify(checkDomainApplicability(options.method, {
						value: options.value !== undefined ? parseFloat(options.value) : undefined,
						assetClass: options.class,
					}, { mode: options.mode || "exploratory" }), null, 2));
				} else {
					console.log(JSON.stringify({ methods: listRegisteredMethods() }, null, 2));
				}
				break;
			}

			case "replay-validate": {
				const res = runReplayValidation({ suite: options.suite || "all" });
				console.log(JSON.stringify(res, null, 2));
				if (!res.valid) process.exit(1);
				break;
			}

			case "uncertainty": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(propagateUncertainty(payload), null, 2));
				break;
			}

			case "eal": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(calculateExpectedAnnualLoss(payload), null, 2));
				break;
			}

			case "cba": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				console.log(JSON.stringify(evaluateMitigationCostBenefit(payload), null, 2));
				break;
			}

			case "cap-generate": {
				const xml = generateCapXml({
					status: options.status || "Draft",
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
					throw new Error("Please provide a CAP XML file path to validate.");
				}
				const xmlContent = fs.readFileSync(filePath, "utf8");
				const res = validateCapXml(xmlContent);
				console.log(JSON.stringify(res, null, 2));
				if (!res.isValid) process.exit(1);
				break;
			}

			case "sitrep": {
				const filePath = options.file || options._file;
				if (!filePath) {
					throw new Error("--file <path-to-assessment.json> is required.");
				}
				const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
				let spatialData = raw.spatialReport || raw.spatial || {};
				if (options.spatial && fs.existsSync(options.spatial)) {
					try {
						spatialData = JSON.parse(fs.readFileSync(options.spatial, "utf8"));
					} catch (_) {}
				}

				const vulnerability = raw.vulnerabilityReport || raw.vulnerability || raw;
				const sendai = vulnerability.sendaiFrameworkMetrics || raw.sendaiFrameworkMetrics;

				const detectedHazardType = options.hazard
					|| raw.hazard?.hazardType
					|| raw.hazardAssessment?.hazardType
					|| raw.event?.hazardType
					|| raw.hazardType
					|| vulnerability.hazardAssessment?.hazardType
					|| "flood";

				const detectedIntensity = options.intensity
					|| raw.hazard?.hazardIntensity
					|| raw.hazardAssessment?.hazardIntensity
					|| raw.event?.intensity
					|| raw.intensity
					|| vulnerability.hazardAssessment?.hazardIntensity
					|| "Unavailable";

				const detectedAlertLevel = options.severity
					|| options["alert-level"]
					|| raw.hazard?.alertLevel
					|| raw.event?.alertLevel
					|| raw.alertLevel
					|| "Orange";

				const detectedEventName = options.name
					|| options.event
					|| raw.name
					|| raw.hazard?.eventName
					|| raw.event?.title
					|| raw.event?.eventName
					|| `${detectedHazardType.charAt(0).toUpperCase() + detectedHazardType.slice(1)} Event`;

				const detectedCountry = options.country
					|| options.region
					|| raw.country
					|| raw.hazard?.country
					|| raw.event?.country
					|| raw.event?.place
					|| "Affected Region";

				const spatialSummary = spatialData.summary || spatialData || {};
				const totalExposedPop = spatialSummary.totalExposedPopulation
					?? sendai?.targetB_AffectedPeople?.totalExposedPopulation
					?? 0;
				const totalExposedVal = spatialSummary.totalExposedAssetValueUsd
					?? sendai?.targetC_DirectEconomicLoss?.totalExposedAssetValueUsd
					?? 0;

				const context = {
					hazard: {
						eventName: detectedEventName,
						hazardType: detectedHazardType,
						alertLevel: detectedAlertLevel,
						country: detectedCountry,
						hazardIntensity: detectedIntensity,
					},
					spatial: {
						summary: {
							totalExposedPopulation: totalExposedPop,
							totalExposedAssetValueUsd: totalExposedVal,
							totalAssetsExposed: spatialSummary.totalAssetsExposed || spatialSummary.totalExposedAssets || raw.evaluatedAssetsCount || 0,
						},
						intersectedAssets: spatialData.exposedAssets || spatialData.intersectedAssets || vulnerability.topDamagedAssets || [],
					},
					vulnerability,
				};
				const isHtml = options.html || (options.output && options.output.endsWith(".html"));
				const output = isHtml ? generateVisualSitRepHtml(context) : generateEmergencyBrief(context);
				if (options.output) {
					fs.writeFileSync(options.output, output, "utf8");
					console.log(`Situation report written to ${options.output}`);
				} else {
					console.log(output);
				}
				break;
			}

			case "delta-validate": {
				const payload = JSON.parse(fs.readFileSync(options.file || options._file, "utf8"));
				const res = validateDeltaSchema(payload);
				console.log(JSON.stringify(res, null, 2));
				if (!res.valid) process.exit(1);
				break;
			}

			case "delta-push": {
				if (!options.file) {
					throw new Error("Error: --file <path-to-vulnerability-report.json> is required for delta-push (synthetic CLI fallback removed).");
				}
				const assessment = JSON.parse(fs.readFileSync(options.file, "utf8"));
				const result = await pushDraftDisasterRecord(
					{
						...assessment,
						...(options.name ? { name: options.name } : {}),
						...(options.notes ? { notes: options.notes } : {}),
					},
					{ mock: options.mock === true },
				);
				console.log(JSON.stringify(result, null, 2));
				break;
			}

			case "delta-docs": {
				const docs = await fetchDeltaDocs({ mock: options.mock === true });
				if (typeof docs === "string") console.log(docs);
				else if (docs.text) console.log(docs.text);
				else console.log(JSON.stringify(docs, null, 2));
				break;
			}

			case "delta-hazards": {
				const page = options.page ? parseInt(options.page, 10) : 1;
				const limit = options.limit ? parseInt(options.limit, 10) : 50;
				const mode = options.dimensions ? "dimensions" : "list";
				const hazards = await fetchDeltaHazards(
					{
						page,
						pageSize: limit,
						mode,
						search: options.search || options.query || options.q,
						clusterId: options.cluster || options.clusterId,
						typeId: options.type || options.typeId,
						local: options.local === true || options.offline === true,
					},
					{ mock: options.mock === true },
				);
				console.log(JSON.stringify(hazards, null, 2));
				break;
			}

			case "monitor": {
				const configPath = options.config || options.rules || options.file;
				const isMock = options.mock === true;
				if (options.once) {
					const cliAbort = new AbortController();
					const onSig = () => cliAbort.abort();
					process.once("SIGINT", onSig);
					process.once("SIGTERM", onSig);
					try {
						const readOnly =
							options["read-only"] !== undefined
								? options["read-only"] !== "false" && options["read-only"] !== false
								: true;
						const summary = await runOnce(
							{
								configPath,
								mode: "single-run",
								readOnly,
								mock: isMock,
								scopeId: options.scope || options["scope-id"] || process.env.DRR_MONITOR_SCOPE_ID || "global",
								stateBackend:
									options["state-backend"] ||
									process.env.DRR_STATE_BACKEND ||
									"cas-file-store",
								stateStorageDir:
									options["state-dir"] ||
									process.env.DRR_STATE_DIR ||
									undefined,
								runDeadlineMs: options["deadline-ms"]
									? parseInt(options["deadline-ms"], 10)
									: process.env.DRR_RUN_DEADLINE_MS
										? parseInt(process.env.DRR_RUN_DEADLINE_MS, 10)
										: undefined,
								requestTimeoutMs: options["request-timeout-ms"]
									? parseInt(options["request-timeout-ms"], 10)
									: undefined,
								maxAttempts: options["max-attempts"]
									? parseInt(options["max-attempts"], 10)
									: undefined,
								overlapWindowMs: options["overlap-window-ms"]
									? parseInt(options["overlap-window-ms"], 10)
									: undefined,
								retentionPolicy:
									options["retention-policy"] ||
									process.env.DRR_RETENTION_POLICY ||
									undefined,
								summaryOutputPath:
									options["summary-out"] ||
									process.env.DRR_SUMMARY_OUT ||
									undefined,
								markdownSummaryPath:
									options["markdown-out"] ||
									process.env.DRR_MARKDOWN_OUT ||
									undefined,
								skippedExitCode: options["skipped-exit-code"]
									? parseInt(options["skipped-exit-code"], 10)
									: 0,
							},
							{},
							cliAbort.signal,
						);
						console.log(JSON.stringify(summary, null, 2));
						if (summary.exitCode && summary.exitCode !== 0) {
							process.exit(summary.exitCode);
						}
					} finally {
						process.removeListener("SIGINT", onSig);
						process.removeListener("SIGTERM", onSig);
					}
				} else {
					const intervalMinutes = options.interval ? parseInt(options.interval, 10) : undefined;
					startMonitoringDaemon({ configPath, intervalMinutes, mock: isMock });
				}
				break;
			}

			case "sensorthings": {
				const samplePayload = options.file
					? JSON.parse(fs.readFileSync(options.file, "utf8"))
					: undefined;
				const thresholds =
					options.warning !== undefined || options.critical !== undefined
						? {
								warning: options.warning !== undefined ? parseFloat(options.warning) : undefined,
								critical: options.critical !== undefined ? parseFloat(options.critical) : undefined,
								unit: options.unit,
							}
						: undefined;
				const report = await ingestSensorThings({
					endpointUrl: options.url,
					observedProperty: options.property,
					filter: options.filter,
					top: options.top ? parseInt(options.top, 10) : undefined,
					observationsTop: options["obs-top"] ? parseInt(options["obs-top"], 10) : undefined,
					thresholds,
					maxAgeMinutes: options["max-age-min"] ? parseFloat(options["max-age-min"]) : undefined,
					excludeSuspect: Boolean(options["exclude-suspect"]),
					samplePayload,
				});
				const output = options["as-geojson"] ? toSensorGeoJSON(report) : report;
				console.log(JSON.stringify(output, null, 2));
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
