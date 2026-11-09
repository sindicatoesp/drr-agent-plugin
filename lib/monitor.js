/**
 * Automated Monitoring & Early Warning Daemon Engine
 * Polls multi-source telemetry feeds (USGS, GDACS, Open-Meteo), evaluates declarative
 * thresholds from alerts-config.json, runs spatial/fragility models, pushes draft
 * records to DELTA, writes alert bundles, and dispatches universal webhooks.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { CONFIG } = require("./config");
const { ingestGdacsAlerts } = require("./gdacs");
const { ingestUsgsEarthquakes } = require("./usgs");
const { fetchWeatherForecast } = require("./openmeteo");
const { spatialExposureJoin, isEventInCountry } = require("./spatial");
const { evaluateVulnerabilityMatrix } = require("./vulnerability");
const { generateCapXml, validateCapXml, generateEmergencyBrief, generateVisualSitRepHtml } = require("./cap");
const { pushDraftDisasterRecord } = require("./delta");

const ALLOWED_CONFIG_ENV_PREFIXES = ["DRR_", "DELTA_", "WEBHOOK", "SLACK_", "TEAMS_", "TARGET_", "GDACS_", "USGS_", "OPENMETEO_"];

/**
 * Load and parse declarative monitoring configuration with environment variable substitution
 * @param {string} configPath - Path to alerts-config.json
 * @returns {object} Resolved configuration
 */
function loadMonitoringRules(configPath) {
	const defaultPath = path.join(__dirname, "..", "alerts-config.json");
	const examplePath = path.join(__dirname, "..", "alerts-config.example.json");
	const resolvedPath =
		configPath || (fs.existsSync(defaultPath) ? defaultPath : examplePath);

	if (!fs.existsSync(resolvedPath)) {
		throw new Error(`Monitoring config file not found: ${resolvedPath}`);
	}

	let content = fs.readFileSync(resolvedPath, "utf8");
	// Replace ${VAR_NAME} with process.env[VAR_NAME] for allowed DRR/DELTA/Webhook variables
	content = content.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, key) => {
		const isAllowed = ALLOWED_CONFIG_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
		if (!isAllowed) return "";
		return process.env[key] || "";
	});

	const config = JSON.parse(content);
	config.outputDirectory = path.resolve(
		path.dirname(resolvedPath),
		config.outputDirectory || "./alerts",
	);

	if (config.defaultExposureFile) {
		config.defaultExposureFile = path.resolve(
			path.dirname(resolvedPath),
			config.defaultExposureFile,
		);
	}

	return config;
}

/**
 * Dispatch universal JSON webhook payload (compatible with Slack, MS Teams Workflows, custom endpoints)
 * @param {string} webhookUrl - HTTP/HTTPS endpoint
 * @param {object} payload - Alert notification payload
 * @returns {Promise<object>} Status report
 */
function dispatchWebhook(webhookUrl, payload) {
	return new Promise((resolve, reject) => {
		if (!webhookUrl || !webhookUrl.startsWith("http") || webhookUrl.includes("${")) {
			return resolve({ dispatched: false, reason: "No valid webhookUrl configured" });
		}

		let parsedUrl;
		try {
			parsedUrl = new URL(webhookUrl);
		} catch (e) {
			return resolve({ dispatched: false, reason: "Invalid webhookUrl syntax" });
		}

		if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
			return resolve({ dispatched: false, reason: "Unsupported webhookUrl protocol" });
		}

		const client = parsedUrl.protocol === "https:" ? https : http;

		// Universal payload structure
		const body = JSON.stringify({
			text: payload.headline || "DRR Emergency Alert Notification",
			summary: payload.summary || "",
			alertLevel: payload.alertLevel || "Orange",
			event: payload.event || "Natural Hazard Warning",
			sendaiMetrics: payload.sendaiMetrics || {},
			deltaRecordId: payload.deltaRecordId || null,
			timestamp: new Date().toISOString(),
			// Slack / Teams Block Kit compatibility
			blocks: [
				{
					type: "header",
					text: { type: "plain_text", text: `🚨 ${payload.headline || "Disaster Alert"}` },
				},
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `*Severity:* ${payload.severity || "Severe"} | *Urgency:* ${payload.urgency || "Immediate"}\n*Sendai Target B (Displaced):* ${(payload.sendaiMetrics?.estimatedDisplaced || 0).toLocaleString()}\n*Sendai Target C (Direct Loss):* \$${(payload.sendaiMetrics?.estimatedDirectLossUsd || 0).toLocaleString()} USD\n*Source:* ${payload.source || "DRR Agent Plugin"}`,
					},
				},
			],
		});

		const req = client.request(
			webhookUrl,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
					"User-Agent": CONFIG.USER_AGENT,
				},
				timeout: CONFIG.REQUEST_TIMEOUT_MS,
			},
			(res) => {
				let respData = "";
				res.on("data", (chunk) => (respData += chunk));
				res.on("end", () => {
					resolve({
						dispatched: true,
						statusCode: res.statusCode,
						statusMessage: res.statusMessage,
					});
				});
			},
		);

		req.on("error", (err) => {
			resolve({ dispatched: false, error: err.message });
		});

		req.on("timeout", () => {
			req.destroy();
			resolve({ dispatched: false, error: "Webhook request timed out" });
		});

		req.write(body);
		req.end();
	});
}

/**
 * Process a single qualifying hazard event through the automated early warning pipeline
 * @param {object} event - Normalized hazard event (USGS, GDACS, or Open-Meteo)
 * @param {object} config - Monitoring configuration object
 * @param {object} options - Execution options ({ mock: boolean, exposureGeoJSON: object })
 * @returns {Promise<object>} Processing report
 */
async function processQualifyingEvent(event, config, options = {}) {
	const outputDir = config.outputDirectory || "./alerts";
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	// 1. Acquire Exposure Layer
	let exposureGeoJSON = options.exposureGeoJSON;
	if (!exposureGeoJSON && config.defaultExposureFile && fs.existsSync(config.defaultExposureFile)) {
		exposureGeoJSON = JSON.parse(fs.readFileSync(config.defaultExposureFile, "utf8"));
	} else if (!exposureGeoJSON) {
		exposureGeoJSON = { type: "FeatureCollection", features: [] };
	}

	// 2. Derive Hazard Footprint Geometry
	let hazardGeoJSON = event.geometry;
	let epicenter = null;
	if (event.coordinates) {
		epicenter = event.coordinates; // [lon, lat]
		if (!hazardGeoJSON || hazardGeoJSON.type === "Point") {
			// Approximate circular footprint polygon (0.5 degree buffer)
			const lon = epicenter[0];
			const lat = epicenter[1];
			const d = 0.45;
			hazardGeoJSON = {
				type: "Polygon",
				coordinates: [
					[
						[lon - d, lat - d],
						[lon + d, lat - d],
						[lon + d, lat + d],
						[lon - d, lat + d],
						[lon - d, lat - d],
					],
				],
			};
		}
	}

	// 3. Deterministic Spatial Exposure Join
	const spatialReport = spatialExposureJoin(
		hazardGeoJSON || { type: "Polygon", coordinates: [] },
		exposureGeoJSON,
		{ epicenter, bufferKm: 35.0 },
	);

	// 4. GEM/HAZUS Fragility & Sendai Matrix Calculation
	const hazardType = event.eventType === "FL" || event.hazardType === "flood" ? "flood" : "earthquake";
	const intensity = event.estimatedPgaG || event.estimatedInundationDepthMeters || 0.35;

	const vulnerabilityReport = evaluateVulnerabilityMatrix(spatialReport, {
		type: hazardType,
		intensity,
		defaultTaxonomy: "URM",
	});

	// 5. Generate OASIS CAP v1.2 XML Alert
	const capXml = generateCapXml({
		identifier: `DELTA-MONITOR-${event.id || Date.now()}`,
		sender: "early-warning@delta.preventionweb.net",
		status: "Actual",
		msgType: "Alert",
		scope: "Public",
		info: {
			category: hazardType === "earthquake" ? "Geo" : "Met",
			event: `${event.title || event.eventName || "Natural Hazard"} Emergency Warning`,
			urgency: "Immediate",
			severity: event.magnitude >= 6.5 || event.alertLevel === "Red" ? "Extreme" : "Severe",
			certainty: "Observed",
			headline: `EMERGENCY ALERT: ${event.title || event.eventName || "Major Disaster"}`,
			description: `Automated detection by DRR Early Warning Monitor. Intensity: ${intensity}. Estimated affected population: ${spatialReport.summary.totalExposedPopulation.toLocaleString()}.`,
			instruction: "Follow national civil protection evacuation directives immediately.",
			areaDesc: event.place || event.country || "Affected Region",
			coordinates: hazardGeoJSON.coordinates ? hazardGeoJSON.coordinates[0] : null,
		},
	});

	// Validate generated CAP
	const capValidation = validateCapXml(capXml);

	// 6. Generate Emergency Situation Brief & Visual SitRep HTML
	const contextPayload = {
		hazard: {
			eventName: event.title || event.eventName || "Hazard Event",
			hazardType,
			alertLevel: event.alertLevel || "Orange",
			country: event.country || event.place || "Affected Region",
			hazardIntensity: `${intensity} (${hazardType === "earthquake" ? "PGA g" : "m depth"})`,
		},
		spatial: spatialReport,
		vulnerability: vulnerabilityReport,
	};
	const brief = generateEmergencyBrief(contextPayload);
	const visualSitRep = generateVisualSitRepHtml(contextPayload);

	// 7. Save Artifacts to alerts/
	const filePrefix = (event.id || `alert_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
	const capPath = path.join(outputDir, `${filePrefix}.cap.xml`);
	const briefPath = path.join(outputDir, `${filePrefix}.brief.md`);
	const sitrepPath = path.join(outputDir, `${filePrefix}.sitrep.html`);
	const reportPath = path.join(outputDir, `${filePrefix}.assessment.json`);

	fs.writeFileSync(capPath, capXml, "utf8");
	fs.writeFileSync(briefPath, brief, "utf8");
	fs.writeFileSync(sitrepPath, visualSitRep, "utf8");
	fs.writeFileSync(
		reportPath,
		JSON.stringify(
			{
				event,
				spatialReport,
				vulnerabilityReport,
				capValidation,
			},
			null,
			2,
		),
		"utf8",
	);

	// 8. Silently Push Draft Record to DELTA (guarded by national country filter)
	let deltaResult = null;
	if (config.autoPushToDelta !== false) {
		const targetCountries =
			config.countryFilter?.targetCountries ||
			config.targetCountries ||
			(CONFIG.TARGET_COUNTRIES && !CONFIG.TARGET_COUNTRIES.includes("*")
				? CONFIG.TARGET_COUNTRIES
				: null);

		const bbox = config.countryFilter?.bbox || config.bbox || null;
		const strictCountry =
			config.countryFilter?.strictDeltaPush !== undefined
				? config.countryFilter.strictDeltaPush
				: true;

		deltaResult = await pushDraftDisasterRecord(
			{
				...vulnerabilityReport,
				name: event.title || event.eventName || `${hazardType} Incident Assessment`,
				eventId: event.id,
				source: event.source || "drr-agent-plugin-monitor",
				hazardGeoJSON,
				country: event.country || event.place,
				place: event.place,
			},
			{
				mock: options.mock === true,
				targetCountries,
				bbox,
				strictCountryMatch: strictCountry,
			},
		);
	}

	// 9. Dispatch Universal Webhook Notification
	let webhookResult = null;
	if (config.webhookUrl) {
		webhookResult = await dispatchWebhook(config.webhookUrl, {
			headline: `EMERGENCY ALERT: ${event.title || event.eventName}`,
			summary: brief.slice(0, 300),
			severity: event.magnitude >= 6.5 ? "Extreme" : "Severe",
			urgency: "Immediate",
			alertLevel: event.alertLevel || "Orange",
			source: "DRR Agent Plugin Early Warning Monitor",
			sendaiMetrics: {
				totalExposed: spatialReport.summary.totalExposedPopulation,
				estimatedDisplaced:
					vulnerabilityReport.sendaiFrameworkMetrics.targetB_AffectedPeople
						.estimatedDisplacedPopulation,
				estimatedDirectLossUsd:
					vulnerabilityReport.sendaiFrameworkMetrics.targetC_DirectEconomicLoss
						.estimatedDirectEconomicLossUsd,
			},
			deltaRecordId: deltaResult?.recordId || null,
		});
	}

	return {
		eventId: event.id,
		processed: true,
		filesCreated: { capXml: capPath, brief: briefPath, assessment: reportPath, sitrepHtml: sitrepPath },
		deltaRecord: deltaResult,
		webhook: webhookResult,
		summary: {
			totalExposedPopulation: spatialReport.summary.totalExposedPopulation,
			estimatedDisplaced:
				vulnerabilityReport.sendaiFrameworkMetrics.targetB_AffectedPeople
					.estimatedDisplacedPopulation,
			estimatedDirectLossUsd:
				vulnerabilityReport.sendaiFrameworkMetrics.targetC_DirectEconomicLoss
					.estimatedDirectEconomicLossUsd,
		},
	};
}

/**
 * Execute a complete monitoring cycle across feeds
 * @param {object} options - { configPath, mockPayloads, exposureGeoJSON, mock: boolean }
 * @returns {Promise<object>} Cycle execution summary
 */
async function runMonitoringCycle(options = {}) {
	const config = loadMonitoringRules(options.configPath);
	const results = {
		timestamp: new Date().toISOString(),
		eventsChecked: 0,
		qualifyingEventsTriggered: 0,
		alerts: [],
	};

	const rules = config.rules || {};

	// Provide deterministic fallback mock payloads when running in mock / test mode
	const mockPayloads =
		options.mockPayloads ||
		(options.mock
			? {
					usgs: {
						type: "FeatureCollection",
						features: [
							{
								type: "Feature",
								id: "mock_usgs_eq_1",
								properties: {
									mag: 6.2,
									place: "12 km SW of Palu, Indonesia",
									time: Date.now(),
									mmi: 6.5,
								},
								geometry: { type: "Point", coordinates: [119.8, -0.9, 10.0] },
							},
						],
					},
					gdacs: {
						type: "FeatureCollection",
						features: [
							{
								type: "Feature",
								properties: {
									eventid: 999901,
									eventname: "Mock Cyclone Alert",
									eventtype: "TC",
									alertlevel: "Orange",
									country: "Vanuatu",
								},
								geometry: {
									type: "Polygon",
									coordinates: [
										[
											[168.0, -17.5],
											[168.5, -17.5],
											[168.5, -17.0],
											[168.0, -17.0],
											[168.0, -17.5],
										],
									],
								},
							},
						],
					},
				}
			: null);

	// Helper to determine if feed evaluation should filter by country
	const isEventPermitted = (event, rule = {}) => {
		const targetCountries =
			rule.targetCountries ||
			config.countryFilter?.targetCountries ||
			(CONFIG.TARGET_COUNTRIES && !CONFIG.TARGET_COUNTRIES.includes("*")
				? CONFIG.TARGET_COUNTRIES
				: ["*"]);

		const bbox = rule.bbox || config.countryFilter?.bbox || null;
		const filterFeeds =
			config.countryFilter?.filterFeeds === true ||
			(rule.targetCountries && !rule.targetCountries.includes("*"));

		if (filterFeeds && !targetCountries.includes("*")) {
			return isEventInCountry(event, targetCountries, bbox);
		}
		return true;
	};

	// Pre-load default exposure layer once per cycle to avoid redundant disk reads
	let sharedExposureGeoJSON = options.exposureGeoJSON || null;
	if (!sharedExposureGeoJSON && config.defaultExposureFile && fs.existsSync(config.defaultExposureFile)) {
		try {
			sharedExposureGeoJSON = JSON.parse(fs.readFileSync(config.defaultExposureFile, "utf8"));
		} catch (_) {}
	}
	const cycleOptions = {
		...options,
		exposureGeoJSON: sharedExposureGeoJSON || { type: "FeatureCollection", features: [] },
	};

	const checkUsgs = rules.earthquake && rules.earthquake.enabled !== false;
	const checkGdacs = rules.gdacs && rules.gdacs.enabled !== false;
	const minMag = checkUsgs ? rules.earthquake.minMagnitude || 5.5 : 5.5;
	const minLevel = checkGdacs ? rules.gdacs.minAlertLevel || "Orange" : "Orange";

	// Fetch active hazard feeds concurrently
	const [usgsSettled, gdacsSettled] = await Promise.allSettled([
		checkUsgs
			? ingestUsgsEarthquakes({
					minMagnitude: minMag,
					limit: 10,
					samplePayload: mockPayloads?.usgs || null,
				})
			: Promise.resolve([]),
		checkGdacs
			? ingestGdacsAlerts(mockPayloads?.gdacs || null, { minAlertLevel: minLevel })
			: Promise.resolve([]),
	]);

	// 1. Evaluate USGS Earthquakes
	if (checkUsgs && usgsSettled.status === "fulfilled") {
		const earthquakes = usgsSettled.value || [];
		for (const eq of earthquakes) {
			results.eventsChecked++;
			if (eq.magnitude >= minMag) {
				if (!isEventPermitted(eq, rules.earthquake)) {
					continue; // Event outside country filter
				}
				results.qualifyingEventsTriggered++;
				const alert = await processQualifyingEvent(
					{ ...eq, source: "USGS" },
					config,
					cycleOptions,
				);
				results.alerts.push(alert);
			}
		}
	}

	// 2. Evaluate GDACS Feeds
	if (checkGdacs && gdacsSettled.status === "fulfilled") {
		const gdacsEvents = gdacsSettled.value || [];
		for (const evt of gdacsEvents) {
			results.eventsChecked++;
			if (evt.alertLevel === "Red" || evt.alertLevel === "Orange") {
				if (!isEventPermitted(evt, rules.gdacs)) {
					continue; // Event outside country filter
				}
				results.qualifyingEventsTriggered++;
				const alert = await processQualifyingEvent(
					{ ...evt, source: "GDACS" },
					config,
					cycleOptions,
				);
				results.alerts.push(alert);
			}
		}
	}

	return results;
}

/**
 * Start the monitoring daemon runner
 * @param {object} options - Daemon options
 */
function startMonitoringDaemon(options = {}) {
	const config = loadMonitoringRules(options.configPath);
	const intervalMinutes = options.intervalMinutes || config.pollingIntervalMinutes || 15;
	const intervalMs = intervalMinutes * 60 * 1000;

	console.log(
		`[DRR Monitor] Starting automated early warning daemon (polling interval: ${intervalMinutes}m)...`,
	);
	console.log(`[DRR Monitor] Output directory: ${config.outputDirectory}`);

	let isRunning = false;
	const run = async () => {
		if (isRunning) return;
		isRunning = true;
		try {
			console.log(`[DRR Monitor] [${new Date().toISOString()}] Executing telemetry check...`);
			const summary = await runMonitoringCycle(options);
			console.log(
				`[DRR Monitor] Checked ${summary.eventsChecked} events. Triggered ${summary.qualifyingEventsTriggered} qualifying alerts.`,
			);
		} catch (err) {
			console.error(`[DRR Monitor] Error during cycle: ${err.message}`);
		} finally {
			isRunning = false;
		}
	};

	// Immediate first run
	run();

	// Scheduled recurring loop
	const timer = setInterval(run, intervalMs);

	const cleanup = () => {
		console.log("\n[DRR Monitor] Stopping daemon gracefully...");
		clearInterval(timer);
		process.exit(0);
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	return { timer, stop: () => clearInterval(timer) };
}

module.exports = {
	loadMonitoringRules,
	dispatchWebhook,
	processQualifyingEvent,
	runMonitoringCycle,
	startMonitoringDaemon,
};
