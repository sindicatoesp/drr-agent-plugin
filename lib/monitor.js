/**
 * Automated Monitoring & Early Warning Engine (Single-Run Shadow Mode + Daemon Wrapper)
 *
 * Implements:
 * - Section 3 Architecture Pipeline:
 *   validate config -> acquire lease -> load state -> establish fetch window -> fetch ->
 *   normalize -> reconcile -> assess -> commit results/state -> export summary -> release lease -> exit
 * - SR-01: Separate orchestration from scheduling (`runOnce(config, dependencies, signal)`) with injected
 *          clock, transport, state store, and model adapters; external writes disabled by default (`readOnly: true`).
 * - SR-02: Run identity (`runId`, `commitSha`, `configHash`, `modelVersions`, `scopeId`, `startedAt`, `deadlineAt`),
 *          UTC timestamps with `+00:00` offset, separated `sourceIssuedAt`/`retrievedAt`/`assessedAt`/`committedAt`,
 *          forecast issue/valid times, and separated execution vs. assessment idempotency identity.
 * - SR-03: Overall run deadline, per-request timeouts, bounded assessment budget, cancellation propagation,
 *          signal handling, and reserved time for final status persistence and artifact export.
 * - SR-04: Versioned summary schema (`success`, `degraded`, `failed`, `skipped`), feed health,
 *          distinction between `no_matching_events` and `no_usable_data`, exit code mapping (`0`, `2`, `1`, skipped policy),
 *          and hazard detections treated as successful assessment outputs.
 * - Section 9 Configuration Contract (`validateMonitorConfig`).
 *
 * Pure Node.js standard library only.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const {
	CONFIG,
	HTTP_KEEPALIVE_AGENT,
	HTTPS_KEEPALIVE_AGENT,
	isBlockedWebhookHost,
	fetchJsonWithConfig,
} = require("./config");
const { parseGdacsFeed, ingestGdacsAlerts } = require("./gdacs");
const { parseUsgsFeed, ingestUsgsEarthquakes } = require("./usgs");
const { analyzeFloodRisk, fetchWeatherForecast } = require("./openmeteo");
const { spatialExposureJoin, isEventInCountry, createGeodesicBuffer } = require("./spatial");
const { evaluateVulnerabilityMatrix } = require("./vulnerability");
const { generateCapXml, validateCapXml, generateEmergencyBrief, generateVisualSitRepHtml } = require("./cap");
const { pushDraftDisasterRecord } = require("./delta");
const { matchAndDeduplicateEvents } = require("./events");
const { computeSnapshotHash } = require("./contracts");
const { listRegisteredMethods } = require("./registry");
const { redactSensitiveObject } = require("./security");
const {
	ProviderBudgetTracker,
	executeWithRetry,
	evaluateSourceFreshness,
	DEFAULT_FRESHNESS_THRESHOLDS_MS,
} = require("./retry");
const {
	APPROVED_RETENTION_POLICIES,
	toUtcIsoWithOffset,
	computeEventIdentity,
	computeAssessmentKey,
	createStateStore,
} = require("./state-store");

const MONITOR_SUMMARY_SCHEMA_VERSION = "1.0";

const ALLOWED_CONFIG_ENV_PREFIXES = [
	"DRR_",
	"DELTA_",
	"WEBHOOK",
	"SLACK_",
	"TEAMS_",
	"TARGET_",
	"GDACS_",
	"USGS_",
	"OPENMETEO_",
];
const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024; // 64 KB cap for webhook ack responses

const ALLOWED_MODES = new Set(["single-run", "daemon"]);
const ALLOWED_STATE_BACKENDS = new Set([
	"cas-file-store",
	"file",
	"memory-cas-store",
	"memory",
	"stateless",
	"local-scratch",
]);
const SCOPE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// Exposure GeoJSON cache keyed by file path & mtimeMs to eliminate redundant parsing across cycles
const exposureFileCache = new Map();

function loadCachedExposureFile(filePath) {
	if (!filePath || !fs.existsSync(filePath)) return null;
	try {
		const stat = fs.statSync(filePath);
		const cached = exposureFileCache.get(filePath);
		if (cached && cached.mtimeMs === stat.mtimeMs) {
			return cached.geojson;
		}
		const geojson = JSON.parse(fs.readFileSync(filePath, "utf8"));
		exposureFileCache.set(filePath, { mtimeMs: stat.mtimeMs, geojson });
		return geojson;
	} catch (_) {
		return null;
	}
}

let cachedCommitSha = null;
let cachedModelVersionsMap = null;

function resolveCurrentCommitSha() {
	if (process.env.GITHUB_SHA) return String(process.env.GITHUB_SHA).trim();
	if (cachedCommitSha) return cachedCommitSha;
	try {
		cachedCommitSha = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: path.join(__dirname, ".."),
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return cachedCommitSha;
	} catch (_) {
		cachedCommitSha = "unknown-commit";
		return cachedCommitSha;
	}
}

function getRegisteredModelVersionsMap() {
	if (cachedModelVersionsMap) return { ...cachedModelVersionsMap };
	const map = {};
	for (const m of listRegisteredMethods()) {
		map[m.id] = m.version;
	}
	cachedModelVersionsMap = map;
	return { ...map };
}

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
 * Validate and normalize the Section 9 Monitoring Configuration Contract
 * @param {object} rawConfig
 * @returns {object} { valid, normalized, errors, warnings }
 */
function validateMonitorConfig(rawConfig = {}) {
	const errors = [];
	const warnings = [];

	const mode = rawConfig.mode || "single-run";
	if (!ALLOWED_MODES.has(mode)) {
		errors.push({
			code: "INVALID_MONITOR_MODE",
			field: "mode",
			message: `Invalid mode '${mode}'. Allowed values: 'single-run', 'daemon'.`,
		});
	}

	// Default operating mode: read-only shadow monitoring (Section 1 & SR-01)
	const readOnly = rawConfig.readOnly !== undefined ? Boolean(rawConfig.readOnly) : true;

	const scopeId = rawConfig.scopeId !== undefined ? String(rawConfig.scopeId) : "global";
	if (!SCOPE_ID_RE.test(scopeId)) {
		errors.push({
			code: "INVALID_SCOPE_ID",
			field: "scopeId",
			message: `Invalid scopeId '${scopeId}'. Must match ${SCOPE_ID_RE.source}.`,
		});
	}

	const workflowJobTimeoutMs = Number(rawConfig.workflowJobTimeoutMs ?? 600000); // 10m default workflow ceiling
	const runDeadlineMs = Number(rawConfig.runDeadlineMs ?? 45000);
	if (!Number.isFinite(runDeadlineMs) || runDeadlineMs <= 0) {
		errors.push({
			code: "INVALID_RUN_DEADLINE",
			field: "runDeadlineMs",
			message: `runDeadlineMs must be a positive number, got '${rawConfig.runDeadlineMs}'.`,
		});
	} else if (runDeadlineMs >= workflowJobTimeoutMs) {
		errors.push({
			code: "DEADLINE_EXCEEDS_JOB_TIMEOUT",
			field: "runDeadlineMs",
			message: `runDeadlineMs (${runDeadlineMs}ms) must be strictly below workflowJobTimeoutMs (${workflowJobTimeoutMs}ms).`,
		});
	}

	const requestTimeoutMs = Number(
		rawConfig.requestTimeoutMs ?? Math.min(CONFIG.REQUEST_TIMEOUT_MS || 8000, Math.floor(runDeadlineMs * 0.5)),
	);
	if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
		errors.push({
			code: "INVALID_REQUEST_TIMEOUT",
			field: "requestTimeoutMs",
			message: `requestTimeoutMs must be a positive number, got '${rawConfig.requestTimeoutMs}'.`,
		});
	} else if (Number.isFinite(runDeadlineMs) && requestTimeoutMs >= runDeadlineMs) {
		errors.push({
			code: "REQUEST_TIMEOUT_EXCEEDS_RUN_DEADLINE",
			field: "requestTimeoutMs",
			message: `requestTimeoutMs (${requestTimeoutMs}ms) must be strictly below runDeadlineMs (${runDeadlineMs}ms).`,
		});
	}

	const maxAttempts = Number(rawConfig.maxAttempts ?? 3);
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
		errors.push({
			code: "INVALID_MAX_ATTEMPTS",
			field: "maxAttempts",
			message: `maxAttempts must be a positive bounded integer in [1, 10], got '${rawConfig.maxAttempts}'.`,
		});
	}

	const backoffBaseMs = Number(rawConfig.backoffBaseMs ?? 200);
	const backoffCapMs = Number(rawConfig.backoffCapMs ?? 2000);
	if (!Number.isFinite(backoffBaseMs) || backoffBaseMs <= 0) {
		errors.push({
			code: "INVALID_BACKOFF_BASE",
			field: "backoffBaseMs",
			message: `backoffBaseMs must be positive, got '${rawConfig.backoffBaseMs}'.`,
		});
	}
	if (!Number.isFinite(backoffCapMs) || backoffCapMs <= 0 || backoffCapMs < backoffBaseMs) {
		errors.push({
			code: "INVALID_BACKOFF_CAP",
			field: "backoffCapMs",
			message: `backoffCapMs (${rawConfig.backoffCapMs}) must be positive and >= backoffBaseMs (${backoffBaseMs}).`,
		});
	}

	const overlapWindowMs = Number(rawConfig.overlapWindowMs ?? 15 * 60 * 1000); // 15m late-update reconciliation overlap
	if (!Number.isFinite(overlapWindowMs) || overlapWindowMs < 0) {
		errors.push({
			code: "INVALID_OVERLAP_WINDOW",
			field: "overlapWindowMs",
			message: `overlapWindowMs must be a non-negative number, got '${rawConfig.overlapWindowMs}'.`,
		});
	}

	const leaseTtlMs = Number(rawConfig.leaseTtlMs ?? Math.max(runDeadlineMs + 15000, 60000));
	const leaseRenewMs = Number(rawConfig.leaseRenewMs ?? Math.floor(leaseTtlMs / 3));
	if (!Number.isFinite(leaseTtlMs) || leaseTtlMs <= 0) {
		errors.push({
			code: "INVALID_LEASE_TTL",
			field: "leaseTtlMs",
			message: `leaseTtlMs must be positive, got '${rawConfig.leaseTtlMs}'.`,
		});
	}
	if (!Number.isFinite(leaseRenewMs) || leaseRenewMs <= 0 || leaseRenewMs >= leaseTtlMs) {
		errors.push({
			code: "INVALID_LEASE_RENEW",
			field: "leaseRenewMs",
			message: `leaseRenewMs (${rawConfig.leaseRenewMs}) must be positive and strictly below leaseTtlMs (${leaseTtlMs}).`,
		});
	}

	const stateBackend = String(rawConfig.stateBackend || "cas-file-store").toLowerCase();
	if (!ALLOWED_STATE_BACKENDS.has(stateBackend)) {
		errors.push({
			code: "INVALID_STATE_BACKEND",
			field: "stateBackend",
			message: `Unsupported stateBackend '${rawConfig.stateBackend}'. Allowed: ${Array.from(ALLOWED_STATE_BACKENDS).join(", ")}.`,
		});
	}
	if (
		rawConfig.requireStateful === true &&
		(stateBackend === "stateless" || stateBackend === "local-scratch")
	) {
		errors.push({
			code: "STATEFUL_BACKEND_REQUIRED",
			field: "stateBackend",
			message: "Stateful monitoring requires an authoritative stateBackend ('cas-file-store' or 'memory-cas-store'), not 'stateless'.",
		});
	}

	const retentionPolicy = String(rawConfig.retentionPolicy || "standard-30d");
	if (!APPROVED_RETENTION_POLICIES[retentionPolicy]) {
		errors.push({
			code: "INVALID_RETENTION_POLICY",
			field: "retentionPolicy",
			message: `Unapproved retentionPolicy '${retentionPolicy}'. Approved: ${Object.keys(APPROVED_RETENTION_POLICIES).join(", ")}.`,
		});
	}

	const skippedExitCode = Number(rawConfig.skippedExitCode ?? 0);
	const reserveCleanupMs = Math.max(50, Number(rawConfig.reserveCleanupMs ?? 250));
	const maxAssessmentsPerRun = Math.max(1, Number(rawConfig.maxAssessmentsPerRun ?? 25));

	return {
		valid: errors.length === 0,
		normalized: {
			...rawConfig,
			mode,
			readOnly,
			scopeId,
			workflowJobTimeoutMs,
			runDeadlineMs,
			requestTimeoutMs,
			maxAttempts,
			backoffBaseMs,
			backoffCapMs,
			overlapWindowMs,
			leaseTtlMs,
			leaseRenewMs,
			stateBackend,
			retentionPolicy,
			skippedExitCode,
			reserveCleanupMs,
			maxAssessmentsPerRun,
		},
		errors,
		warnings,
	};
}

/**
 * Map structured run status to CLI exit code (SR-04)
 * - success -> 0
 * - degraded -> 2
 * - failed -> 1
 * - skipped -> explicit policy (default 0 for benign lock_held, or configurable non-zero)
 */
function mapOutcomeToExitCode(status, options = {}) {
	if (status === "success") return 0;
	if (status === "degraded") return 2;
	if (status === "skipped") {
		return typeof options.skippedExitCode === "number" ? options.skippedExitCode : 0;
	}
	return 1;
}

/**
 * Dispatch universal JSON webhook payload (compatible with Slack, MS Teams Workflows, custom endpoints)
 * @param {string} webhookUrl - HTTP/HTTPS endpoint
 * @param {object} payload - Alert notification payload
 * @param {object} options - Optional overrides ({ allowPrivateHosts: boolean })
 * @returns {Promise<object>} Status report
 */
function dispatchWebhook(webhookUrl, payload, options = {}) {
	return new Promise((resolve) => {
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

		const allowPrivate =
			options.allowPrivateHosts === true || CONFIG.ALLOW_PRIVATE_WEBHOOKS === true;
		if (!allowPrivate && isBlockedWebhookHost(parsedUrl.hostname)) {
			return resolve({
				dispatched: false,
				reason: `SSRF guard blocked private or local webhook host: ${parsedUrl.hostname}`,
			});
		}

		const isHttps = parsedUrl.protocol === "https:";
		const client = isHttps ? https : http;
		const agent = isHttps ? HTTPS_KEEPALIVE_AGENT : HTTP_KEEPALIVE_AGENT;

		const body = JSON.stringify({
			text: payload.headline || "DRR Emergency Alert Notification",
			summary: payload.summary || "",
			alertLevel: payload.alertLevel || "Orange",
			event: payload.event || "Natural Hazard Warning",
			sendaiMetrics: payload.sendaiMetrics || {},
			deltaRecordId: payload.deltaRecordId || null,
			timestamp: new Date().toISOString(),
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
				agent,
				timeout: CONFIG.REQUEST_TIMEOUT_MS,
			},
			(res) => {
				let receivedBytes = 0;
				res.on("data", (chunk) => {
					receivedBytes += Buffer.byteLength(chunk);
					if (receivedBytes > MAX_WEBHOOK_RESPONSE_BYTES) {
						req.destroy();
						resolve({
							dispatched: false,
							error: "Webhook response exceeded maximum allowed size",
						});
					}
				});
				res.on("end", () => {
					resolve({
						dispatched: res.statusCode >= 200 && res.statusCode < 300,
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
 * Process a single qualifying hazard event through the early warning assessment pipeline
 * Supports `readOnly` shadow mode (SR-01): blocks consequential outbound actions (webhooks, DELTA writes, public CAP)
 * when `options.readOnly === true`.
 */
async function processQualifyingEvent(event, config, options = {}) {
	const readOnly = options.readOnly === true;
	const writeLocalArtifacts = options.writeLocalArtifacts !== false;
	const outputDir = config.outputDirectory || "./alerts";
	if (writeLocalArtifacts && !fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	// 1. Acquire Exposure Layer
	let exposureGeoJSON = options.exposureGeoJSON;
	if (!exposureGeoJSON && config.defaultExposureFile) {
		exposureGeoJSON = loadCachedExposureFile(config.defaultExposureFile);
	}
	if (!exposureGeoJSON) {
		exposureGeoJSON = { type: "FeatureCollection", features: [] };
	}

	// 2. Derive Hazard Footprint Geometry
	let hazardGeoJSON = event.geometry;
	let epicenter = null;
	if (event.coordinates) {
		epicenter = event.coordinates; // [lon, lat]
		if (!hazardGeoJSON || hazardGeoJSON.type === "Point") {
			hazardGeoJSON = createGeodesicBuffer(epicenter, 50.0, 24);
		}
	}

	// 3. Deterministic Spatial Exposure Join
	const spatialAdapter = options.modelAdapters?.spatialExposureJoin || spatialExposureJoin;
	const spatialReport = spatialAdapter(
		hazardGeoJSON || { type: "Polygon", coordinates: [] },
		exposureGeoJSON,
		{ epicenter, bufferKm: 35.0 },
	);

	// 4. Hazard Routing & Fragility Calculation
	const evtTypeCode = String(event.eventType || event.hazardType || "").toUpperCase();
	let hazardType = "other";
	let intensity = null;
	let intensityUnit = null;
	if (evtTypeCode === "FL" || evtTypeCode === "FLOOD") {
		hazardType = "flood";
		intensity = event.estimatedInundationDepthMeters ?? null;
		intensityUnit = "m";
	} else if (evtTypeCode === "TC" || evtTypeCode === "CYCLONE" || evtTypeCode === "WIND") {
		hazardType = "wind";
		intensity = event.windSpeedKmh ?? event.maxWindSpeedKmh ?? null;
		intensityUnit = "km/h";
	} else if (evtTypeCode === "EQ" || evtTypeCode === "EARTHQUAKE" || event.magnitude !== undefined) {
		hazardType = "earthquake";
		intensity = event.estimatedPgaG ?? null;
		intensityUnit = "g";
	} else {
		hazardType = event.hazardType || event.eventTypeLabel || "other";
	}

	const vulnAdapter =
		options.modelAdapters?.evaluateVulnerabilityMatrix || evaluateVulnerabilityMatrix;
	let vulnerabilityReport;
	if ((hazardType === "earthquake" || hazardType === "flood" || hazardType === "wind") && intensity !== null) {
		vulnerabilityReport = vulnAdapter(spatialReport, {
			type: hazardType,
			intensity,
			unit: intensityUnit,
			defaultTaxonomy: "URM",
		});
	} else {
		vulnerabilityReport = {
			status: "incomplete_intensity_unavailable",
			hazardAssessment: {
				hazardType,
				hazardIntensity: null,
				intensityUnit: intensityUnit || "unavailable",
			},
			sendaiFrameworkMetrics: {
				targetB_AffectedPeople: {
					totalExposedPopulation: spatialReport.summary.totalExposedPopulation,
					estimatedDisplacedPopulation: null,
					b1DirectlyAffected: null,
					sendaiMappingStatus: "exposure_only_intensity_unavailable",
				},
				targetC_DirectEconomicLoss: {
					totalExposedAssetValueUsd: spatialReport.summary.totalExposedAssetValueUsd,
					estimatedDirectEconomicLossUsd: null,
					aggregateLossRatioPercentage: 0,
				},
				targetD_CriticalInfrastructure: {
					totalDamagedFacilities: 0,
					physicalDamage: { damagedFacilities: 0 },
					serviceDisruption: { disruptedFacilities: null, disruptionStatus: "requires_operational_assessment" },
				},
			},
			evaluatedAssetsCount: spatialReport.summary.totalExposedAssets,
			topDamagedAssets: [],
			evidenceBasis: "observed",
			verificationStatus: "unreviewed",
			approvalStatus: "draft",
			reportingEligibility: "pending",
			warnings: [
				{
					code: "HAZARD_INTENSITY_UNAVAILABLE",
					message: `Hazard type '${hazardType}' event lacked quantitative intensity metric for fragility modeling; produced exposure-only report.`,
				},
			],
		};
	}

	// 5. Generate OASIS CAP v1.2 XML Alert (always forced to Draft in readOnly shadow mode)
	const blockedActions = [];
	if (readOnly && config.autoPublishActualCap === true) {
		blockedActions.push({
			action: "publish_actual_cap",
			reason: "shadow_mode_read_only_blocks_public_warning",
		});
	}
	const capStatus = !readOnly && config.autoPublishActualCap === true ? "Actual" : "Draft";
	const capXml = generateCapXml({
		identifier: `DELTA-MONITOR-${event.id || Date.now()}`,
		sender: "early-warning@delta.preventionweb.net",
		status: capStatus,
		msgType: "Alert",
		scope: "Public",
		info: {
			category: hazardType === "earthquake" ? "Geo" : "Met",
			event: `${event.title || event.eventName || "Natural Hazard"} Emergency Warning`,
			urgency: "Immediate",
			severity: event.magnitude >= 6.5 || event.alertLevel === "Red" ? "Extreme" : "Severe",
			certainty: "Observed",
			headline: `EMERGENCY ALERT: ${event.title || event.eventName || "Major Disaster"}`,
			description: `Automated detection by DRR Early Warning Monitor. Intensity: ${intensity !== null ? `${intensity} ${intensityUnit}` : "unavailable (exposure screening only)"}. Estimated exposed population: ${spatialReport.summary.totalExposedPopulation.toLocaleString()}.`,
			instruction: "Follow national civil protection evacuation directives immediately.",
			areaDesc: event.place || event.country || "Affected Region",
			coordinates: hazardGeoJSON?.coordinates ? hazardGeoJSON.coordinates[0] : null,
		},
	});

	const capValidation = validateCapXml(capXml);

	// 6. Generate Emergency Situation Brief & Visual SitRep HTML
	const contextPayload = {
		hazard: {
			eventName: event.title || event.eventName || "Hazard Event",
			hazardType,
			alertLevel: event.alertLevel || "Orange",
			country: event.country || event.place || "Affected Region",
			hazardIntensity: intensity !== null ? `${intensity} (${intensityUnit})` : "Exposure Screening",
		},
		spatial: spatialReport,
		vulnerability: vulnerabilityReport,
	};
	const brief = generateEmergencyBrief(contextPayload);
	const visualSitRep = generateVisualSitRepHtml(contextPayload);

	// 7. Save Local Artifacts if requested
	const rawPrefix = String(event.id || `alert_${Date.now()}`)
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.replace(/^[_-]+/, "")
		.slice(0, 120);
	const filePrefix = rawPrefix || `alert_${Date.now()}`;
	const capPath = path.join(outputDir, `${filePrefix}.cap.xml`);
	const briefPath = path.join(outputDir, `${filePrefix}.brief.md`);
	const sitrepPath = path.join(outputDir, `${filePrefix}.sitrep.html`);
	const reportPath = path.join(outputDir, `${filePrefix}.assessment.json`);

	if (writeLocalArtifacts) {
		await Promise.all([
			fs.promises.writeFile(capPath, capXml, "utf8"),
			fs.promises.writeFile(briefPath, brief, "utf8"),
			fs.promises.writeFile(sitrepPath, visualSitRep, "utf8"),
			fs.promises.writeFile(
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
			),
		]);
	}

	// 8. DELTA Push (strictly blocked in readOnly shadow mode: SR-01 & Section 1)
	let deltaResult = null;
	if (readOnly) {
		if (config.autoPushToDelta !== false || typeof options.publicWriteAdapter === "function") {
			blockedActions.push({
				action: "delta_record_push",
				reason: "shadow_mode_read_only_blocks_external_write",
			});
		}
		deltaResult = {
			success: false,
			blocked: true,
			skipped: true,
			reason: "shadow_mode_read_only",
		};
	} else if (config.autoPushToDelta !== false) {
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

	// 9. Webhook Dispatch (strictly blocked in readOnly shadow mode: SR-01 & Section 1)
	let webhookResult = null;
	if (readOnly) {
		if (config.webhookUrl) {
			blockedActions.push({
				action: "webhook_dispatch",
				reason: "shadow_mode_read_only_blocks_webhook",
			});
		}
		webhookResult = {
			dispatched: false,
			blocked: true,
			reason: "shadow_mode_read_only",
		};
	} else if (config.webhookUrl) {
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
		readOnly,
		blockedActions,
		filesCreated: writeLocalArtifacts
			? { capXml: capPath, brief: briefPath, assessment: reportPath, sitrepHtml: sitrepPath }
			: null,
		spatialReport,
		vulnerabilityReport,
		capValidation,
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
 * Generate a human-readable Markdown summary for workflow step summary / review export (Section 8 & 12)
 */
function formatMonitorMarkdownSummary(summary) {
	const lines = [];
	lines.push(`# DRR Scheduled Monitoring Summary (\`${summary.status.toUpperCase()}\`)`);
	lines.push("");
	lines.push(`- **Run ID**: \`${summary.runId}\``);
	lines.push(`- **Scope ID**: \`${summary.scopeId}\``);
	lines.push(`- **Mode**: \`${summary.mode}\` (Read-Only Shadow: \`${summary.readOnly}\`)`);
	lines.push(`- **Status**: \`${summary.status}\` (Exit Code: \`${summary.exitCode}\`)`);
	lines.push(`- **Coverage Status**: \`${summary.coverageStatus}\``);
	lines.push(`- **Started At (UTC)**: \`${summary.startedAt}\``);
	lines.push(`- **Completed At (UTC)**: \`${summary.completedAt}\``);
	lines.push(`- **Commit SHA**: \`${summary.commitSha}\``);
	lines.push(`- **Config Hash**: \`${summary.configHash}\``);
	lines.push(`- **State Backend**: \`${summary.persistence?.backendType || "none"}\` (Stateless: \`${summary.persistence?.stateless}\`)`);
	lines.push("");
	lines.push("## Assessment & Event Counts");
	lines.push("");
	lines.push(`- **Events Fetched**: ${summary.counts.eventsFetched}`);
	lines.push(`- **Qualifying Events**: ${summary.counts.qualifyingEvents}`);
	lines.push(`- **New Assessments Executed**: ${summary.counts.assessed}`);
	lines.push(`- **Duplicate Assessments Skipped (Idempotent)**: ${summary.counts.skippedDuplicates}`);
	lines.push(`- **Ambiguous Cross-Source Duplicates Held**: ${summary.counts.ambiguousDuplicatesHeld}`);
	lines.push(`- **Hazards Detected**: ${summary.counts.hazardsDetected}`);
	lines.push("");
	lines.push("## Feed Health");
	lines.push("");
	lines.push("| Source | Status | Attempts | Events | Freshness | Cursor Advanced |");
	lines.push("| :--- | :--- | :---: | :---: | :--- | :---: |");
	for (const [src, fh] of Object.entries(summary.feedHealth || {})) {
		lines.push(
			`| \`${src}\` | \`${fh.status}\` | ${fh.attempts || 0} | ${fh.eventsReturned ?? 0} | \`${fh.freshness?.status || "n/a"}\` | \`${Boolean(fh.checkpointAdvanced)}\` |`,
		);
	}
	if (summary.warnings?.length > 0) {
		lines.push("");
		lines.push("## Warnings");
		for (const w of summary.warnings) {
			lines.push(`- **[${w.code}]**: ${w.message}`);
		}
	}
	if (summary.errors?.length > 0) {
		lines.push("");
		lines.push("## Errors");
		for (const e of summary.errors) {
			lines.push(`- **[${e.code || e.category}]**: ${e.message}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

/**
 * Bounded Single-Run Monitoring Pipeline (`runOnce`) (SR-01..SR-04, PS-01..PS-05, RT-01..RT-04, CC-01..CC-03)
 *
 * Recommended pipeline:
 * validate config -> acquire lease -> load state -> establish fetch window -> fetch ->
 * normalize -> reconcile -> assess -> commit results/state -> export summary -> release lease -> exit
 *
 * @param {object} rawConfig - Monitoring configuration options
 * @param {object} dependencies - Injected { clock, transport, stateStore, modelAdapters, sleepFn, randomFn, publicWriteAdapter }
 * @param {AbortSignal|null} externalSignal - Optional external cancellation signal
 * @returns {Promise<object>} Structured versioned summary with exitCode
 */
async function runOnce(rawConfig = {}, dependencies = {}, externalSignal = null) {
	const clock = dependencies.clock || { now: () => Date.now() };
	const nowFn = typeof clock.now === "function" ? () => clock.now() : () => Date.now();
	const sleepFn = dependencies.sleepFn || undefined;
	const randomFn = dependencies.randomFn || Math.random;

	const startEpochMs = nowFn();
	const startedAtIso = toUtcIsoWithOffset(startEpochMs);

	// Merge declarative file rules if configPath provided or default rules needed
	let fileRulesConfig = {};
	if (rawConfig.configPath || !rawConfig.rules) {
		try {
			fileRulesConfig = loadMonitoringRules(rawConfig.configPath);
		} catch (cfgErr) {
			if (rawConfig.configPath) {
				const failedSummary = {
					schemaVersion: MONITOR_SUMMARY_SCHEMA_VERSION,
					runId: `run_invalid_cfg_${startEpochMs}`,
					status: "failed",
					exitCode: 1,
					mode: rawConfig.mode || "single-run",
					readOnly: rawConfig.readOnly !== false,
					scopeId: rawConfig.scopeId || "global",
					startedAt: startedAtIso,
					completedAt: toUtcIsoWithOffset(nowFn()),
					commitSha: resolveCurrentCommitSha(),
					configHash: "invalid",
					coverageStatus: "no_usable_data",
					counts: {
						eventsFetched: 0,
						qualifyingEvents: 0,
						assessed: 0,
						skippedDuplicates: 0,
						ambiguousDuplicatesHeld: 0,
						hazardsDetected: 0,
					},
					feedHealth: {},
					missingInputs: [],
					warnings: [],
					errors: [
						{
							category: "invalid_configuration_or_input",
							code: "CONFIG_FILE_NOT_FOUND",
							message: redactSensitiveObject(cfgErr.message),
						},
					],
				};
				return failedSummary;
			}
		}
	}

	const mergedConfig = {
		...fileRulesConfig,
		...rawConfig,
		rules: rawConfig.rules || fileRulesConfig.rules || {
			earthquake: { enabled: true, minMagnitude: 5.5 },
			gdacs: { enabled: true, minAlertLevel: "Orange" },
		},
	};

	// Step 1: Validate Configuration Contract (Section 9)
	const cfgValidation = validateMonitorConfig(mergedConfig);
	if (!cfgValidation.valid) {
		const failedSummary = {
			schemaVersion: MONITOR_SUMMARY_SCHEMA_VERSION,
			runId: `run_cfg_err_${startEpochMs}`,
			status: "failed",
			exitCode: 1,
			mode: mergedConfig.mode || "single-run",
			readOnly: mergedConfig.readOnly !== false,
			scopeId: mergedConfig.scopeId || "global",
			startedAt: startedAtIso,
			completedAt: toUtcIsoWithOffset(nowFn()),
			commitSha: resolveCurrentCommitSha(),
			configHash: "invalid",
			coverageStatus: "no_usable_data",
			counts: {
				eventsFetched: 0,
				qualifyingEvents: 0,
				assessed: 0,
				skippedDuplicates: 0,
				ambiguousDuplicatesHeld: 0,
				hazardsDetected: 0,
			},
			feedHealth: {},
			missingInputs: [],
			warnings: cfgValidation.warnings,
			errors: cfgValidation.errors.map((e) => ({
				category: "invalid_configuration_or_input",
				...e,
			})),
		};
		await exportSummaryArtifacts(mergedConfig, failedSummary);
		return failedSummary;
	}

	const config = cfgValidation.normalized;
	const deadlineEpochMs = startEpochMs + config.runDeadlineMs;
	const deadlineAtIso = toUtcIsoWithOffset(deadlineEpochMs);

	// Step 2: Generate Run Identity & Reproducibility Metadata (SR-02)
	const commitSha = config.commitSha || resolveCurrentCommitSha();
	const modelVersions = getRegisteredModelVersionsMap();
	const configHash = `sha256:${computeSnapshotHash({
		scopeId: config.scopeId,
		rules: config.rules,
		countryFilter: config.countryFilter,
		overlapWindowMs: config.overlapWindowMs,
		modelVersions,
	})}`;
	const runNonce =
		config.runId ||
		`run_${startEpochMs}_${crypto.randomBytes(4).toString("hex")}`;
	const runId = runNonce;

	// Setup bounded internal AbortController linked to overall deadline & external signal (SR-03)
	const runAbortController = new AbortController();
	let deadlineTimer = null;
	const effectiveDeadlineTimeoutMs = Math.max(
		20,
		config.runDeadlineMs - config.reserveCleanupMs,
	);

	const onExternalAbort = () => {
		runAbortController.abort(new Error("Cancelled by external termination signal"));
	};
	if (externalSignal) {
		if (externalSignal.aborted) {
			onExternalAbort();
		} else {
			externalSignal.addEventListener("abort", onExternalAbort, { once: true });
		}
	}

	deadlineTimer = setTimeout(() => {
		const err = new Error(`Run deadline (${config.runDeadlineMs}ms) reached`);
		err.code = "RUN_DEADLINE_EXCEEDED";
		runAbortController.abort(err);
	}, effectiveDeadlineTimeoutMs);
	if (deadlineTimer && typeof deadlineTimer.unref === "function") {
		deadlineTimer.unref();
	}

	const warnings = [...cfgValidation.warnings];
	const errors = [];
	const missingInputs = [];
	const blockedSideEffects = [];

	// SR-01 & Test Matrix: If a public-write adapter is configured in shadow mode, block invocation explicitly
	if (config.readOnly && typeof dependencies.publicWriteAdapter === "function") {
		blockedSideEffects.push({
			adapter: "publicWriteAdapter",
			blocked: true,
			reason: "Shadow mode (readOnly: true) blocks public-write adapter invocation.",
		});
		warnings.push({
			code: "SHADOW_MODE_PUBLIC_WRITE_BLOCKED",
			message: "Configured publicWriteAdapter was blocked by read-only shadow mode.",
		});
	}

	let stateStore = null;
	let lease = null;
	let leaseRenewTimer = null;

	try {
		// Step 3: Instantiate State Backend & Acquire Storage-Level Lease (PS-01, CC-02, CC-03)
		stateStore = dependencies.stateStore || createStateStore(config);

		if (stateStore.stateless) {
			warnings.push({
				code: "STATELESS_RUN_MODE",
				message:
					"Runner is operating with local stateless storage; cross-run deduplication and checkpoint continuity are disabled.",
			});
		}

		const leaseAcquisition = await stateStore.acquireLease({
			ownerId: runId,
			scopeId: config.scopeId,
			ttlMs: config.leaseTtlMs,
			waitMs: Number(config.leaseWaitMs ?? 0),
			pollIntervalMs: Number(config.leasePollIntervalMs ?? 50),
			nowFn,
			sleepFn,
		});

		if (!leaseAcquisition.acquired) {
			// CC-03: Emit structured `skipped: lock_held` result rather than unlabelled success
			const skippedSummary = {
				schemaVersion: MONITOR_SUMMARY_SCHEMA_VERSION,
				runId,
				status: "skipped",
				skipReason: leaseAcquisition.reason || "lock_held",
				exitCode: mapOutcomeToExitCode("skipped", config),
				mode: config.mode,
				readOnly: config.readOnly,
				scopeId: config.scopeId,
				commitSha,
				configHash,
				modelVersions,
				startedAt: startedAtIso,
				deadlineAt: deadlineAtIso,
				completedAt: toUtcIsoWithOffset(nowFn()),
				coverageStatus: "skipped_lock_held",
				leaseConflict: {
					scopeId: config.scopeId,
					heldBy: leaseAcquisition.heldBy || null,
					expiresAt: leaseAcquisition.expiresAt || null,
					fencingToken: leaseAcquisition.fencingToken || null,
				},
				persistence: {
					backendType: stateStore.backendType,
					stateless: stateStore.stateless,
					crossRunDeduplicationEnabled: !stateStore.stateless,
					committed: false,
				},
				counts: {
					eventsFetched: 0,
					qualifyingEvents: 0,
					assessed: 0,
					skippedDuplicates: 0,
					ambiguousDuplicatesHeld: 0,
					hazardsDetected: 0,
				},
				feedHealth: {},
				missingInputs: [],
				blockedSideEffects,
				warnings,
				errors: [],
			};
			await exportSummaryArtifacts(config, skippedSummary);
			return skippedSummary;
		}

		lease = leaseAcquisition.lease;

		// Start background lease renewal timer if leaseRenewMs < runDeadlineMs (CC-02)
		if (config.leaseRenewMs > 0 && config.leaseRenewMs < config.runDeadlineMs) {
			leaseRenewTimer = setInterval(async () => {
				if (!lease || runAbortController.signal.aborted) return;
				try {
					const renewed = await stateStore.renewLease({
						ownerId: runId,
						fencingToken: lease.fencingToken,
						ttlMs: config.leaseTtlMs,
						nowFn,
					});
					if (!renewed.renewed) {
						const lostErr = new Error(
							`Lease renewal failed (${renewed.code}): ${renewed.reason}`,
						);
						lostErr.code = renewed.code || "LEASE_OWNERSHIP_LOST";
						runAbortController.abort(lostErr);
					}
				} catch (_) {}
			}, config.leaseRenewMs);
			if (leaseRenewTimer && typeof leaseRenewTimer.unref === "function") {
				leaseRenewTimer.unref();
			}
		}

		// Step 4: Load Authoritative State & Record Active Run (PS-01, PS-02)
		const loaded = await stateStore.loadState({ nowMs: nowFn() });
		const ledgerState = loaded.state;

		await stateStore.saveRunRecord({
			ownerId: runId,
			fencingToken: lease.fencingToken,
			nowFn,
			runRecord: {
				runId,
				status: "running",
				scopeId: config.scopeId,
				commitSha,
				configHash,
				modelVersions,
				startedAt: startedAtIso,
				deadlineAt: deadlineAtIso,
				errors: [],
			},
		});

		// Load exposure GeoJSON and compute exposureVersion hash (PS-02, PS-03)
		let sharedExposureGeoJSON = config.exposureGeoJSON || null;
		if (!sharedExposureGeoJSON && config.defaultExposureFile) {
			sharedExposureGeoJSON = loadCachedExposureFile(config.defaultExposureFile);
		}
		if (!sharedExposureGeoJSON) {
			sharedExposureGeoJSON = { type: "FeatureCollection", features: [] };
			missingInputs.push({
				field: "exposureGeoJSON",
				message: "No exposure GeoJSON supplied or loaded; spatial exposure join will evaluate against empty asset collection.",
			});
		}
		const exposureVersion = `sha256:${computeSnapshotHash(sharedExposureGeoJSON).slice(0, 16)}`;

		// Step 5: Establish Fetch Window per Source with Overlap Window (PS-04, CC-01)
		const rules = config.rules || {};
		const enabledSources = [];
		if (rules.earthquake && rules.earthquake.enabled !== false) {
			enabledSources.push("usgs");
		}
		if (rules.gdacs && rules.gdacs.enabled !== false) {
			enabledSources.push("gdacs");
		}
		if (rules.openmeteo && rules.openmeteo.enabled === true) {
			enabledSources.push("openmeteo");
		}

		const fetchWindows = {};
		const nowCurrentMs = nowFn();
		for (const src of enabledSources) {
			const cpKey = `${config.scopeId}::${src}`;
			const cp = ledgerState.checkpoints[cpKey] || null;
			const baseCursorMs = cp?.lastWindowEnd ? Date.parse(cp.lastWindowEnd) : null;
			const windowStartMs =
				baseCursorMs && !Number.isNaN(baseCursorMs)
					? Math.max(0, baseCursorMs - config.overlapWindowMs)
					: nowCurrentMs - 24 * 60 * 60 * 1000;
			fetchWindows[src] = {
				sourceId: src,
				previousCursor: cp?.cursor || null,
				windowStart: toUtcIsoWithOffset(windowStartMs),
				windowEnd: toUtcIsoWithOffset(nowCurrentMs),
				windowStartMs,
				windowEndMs: nowCurrentMs,
			};
		}

		// Step 6: Fetch & Normalize Feeds with Single-Layer Retry, Backoff & Freshness Checks (RT-01..RT-04)
		const budgetTracker = new ProviderBudgetTracker({
			maxRequestsPerProvider: config.maxRequestsPerProvider ?? Math.max(config.maxAttempts * 2, 4),
			maxConcurrentPerProvider: config.maxConcurrentPerProvider ?? 2,
		});

		const transport = dependencies.transport || {};
		const mockPayloads =
			config.mockPayloads ||
			(config.mock === true
				? {
						usgs: {
							type: "FeatureCollection",
							metadata: { generated: nowFn() },
							features: [
								{
									type: "Feature",
									id: "mock_usgs_eq_1",
									properties: {
										mag: 6.2,
										place: "12 km SW of Palu, Indonesia",
										time: nowFn() - 60000,
										mmi: 6.5,
									},
									geometry: { type: "Point", coordinates: [119.8, -0.9, 10.0] },
								},
							],
						},
						gdacs: {
							type: "FeatureCollection",
							sourceIssuedAt: toUtcIsoWithOffset(nowFn() - 120000),
							features: [
								{
									type: "Feature",
									properties: {
										eventid: 999901,
										eventname: "Mock Cyclone Alert",
										eventtype: "TC",
										alertlevel: "Orange",
										country: "Vanuatu",
										fromdate: toUtcIsoWithOffset(nowFn() - 120000),
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
		const feedHealth = {};
		const fetchedBySource = {};
		const rawSnapshots = [];

		for (const src of enabledSources) {
			if (runAbortController.signal.aborted) {
				feedHealth[src] = {
					sourceId: src,
					status: "cancelled",
					attempts: 0,
					eventsReturned: 0,
					freshness: null,
					checkpointAdvanced: false,
					error: {
						category: "cancelled_or_deadline",
						code: "RUN_CANCELLED",
						message: "Source fetch skipped because run was cancelled or reached deadline.",
					},
				};
				continue;
			}

			const isSyntheticFixture = Boolean(mockPayloads && mockPayloads[src]);
			const fetchResult = await executeWithRetry(
				async ({ attempt, timeoutMs, signal }) => {
					if (typeof transport[src] === "function") {
						return transport[src]({
							attempt,
							timeoutMs,
							signal,
							window: fetchWindows[src],
							config,
						});
					}
					if (typeof transport.fetchSource === "function") {
						return transport.fetchSource(src, {
							attempt,
							timeoutMs,
							signal,
							window: fetchWindows[src],
							config,
						});
					}
					if (isSyntheticFixture) {
						return mockPayloads[src];
					}
					if (src === "usgs") {
						const minMag = rules.earthquake?.minMagnitude || CONFIG.USGS_MIN_MAGNITUDE || 4.5;
						const limit = rules.earthquake?.limit || CONFIG.USGS_DEFAULT_LIMIT || 20;
						const url = `${CONFIG.USGS_API_URL}?format=geojson&minmagnitude=${minMag}&limit=${limit}&orderby=time`;
						return fetchJsonWithConfig(url);
					}
					if (src === "gdacs") {
						return fetchJsonWithConfig(CONFIG.GDACS_FEED_URL);
					}
					if (src === "openmeteo") {
						const lat = rules.openmeteo?.latitude ?? 23.8;
						const lon = rules.openmeteo?.longitude ?? 90.4;
						const days = rules.openmeteo?.days ?? 5;
						const url = `${CONFIG.OPENMETEO_API_URL}?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,wind_speed_10m_max&forecast_days=${days}&timezone=auto`;
						return fetchJsonWithConfig(url);
					}
					throw new Error(`Unsupported source '${src}'`);
				},
				{
					provider: src,
					maxAttempts: config.maxAttempts,
					backoffBaseMs: config.backoffBaseMs,
					backoffCapMs: config.backoffCapMs,
					requestTimeoutMs: config.requestTimeoutMs,
					runDeadlineEpochMs: deadlineEpochMs,
					reserveCleanupMs: config.reserveCleanupMs,
					nowFn,
					sleepFn,
					randomFn,
					signal: runAbortController.signal,
					budgetTracker,
				},
			);

			const retrievedAtIso = toUtcIsoWithOffset(nowFn());

			if (!fetchResult.ok) {
				errors.push({
					sourceId: src,
					...fetchResult.terminalError,
				});
				feedHealth[src] = {
					sourceId: src,
					status: fetchResult.deferred ? "deferred" : "failed",
					attempts: fetchResult.attempts,
					attemptLog: fetchResult.attemptLog,
					eventsReturned: 0,
					freshness: null,
					checkpointAdvanced: false,
					error: fetchResult.terminalError,
				};
				continue;
			}

			// Normalize feed & evaluate freshness using sourceIssuedAt (RT-04)
			try {
				const rawData = fetchResult.value;
				let normalizedList = [];
				let latestSourceIssuedAt = null;

				if (src === "usgs") {
					const minMag = rules.earthquake?.minMagnitude || 5.5;
					const parsed = parseUsgsFeed(rawData, {
						minMagnitude: minMag,
						retrievedAt: retrievedAtIso,
					});
					normalizedList = parsed.map((e) => ({ ...e, source: "USGS", sourceId: "usgs" }));
					const metadataTime = rawData?.metadata?.generated
						? toUtcIsoWithOffset(rawData.metadata.generated)
						: null;
					const eventMaxTime = parsed.reduce((acc, ev) => {
						if (!ev.sourceIssuedAt) return acc;
						return !acc || Date.parse(ev.sourceIssuedAt) > Date.parse(acc)
							? ev.sourceIssuedAt
							: acc;
					}, null);
					latestSourceIssuedAt = metadataTime || eventMaxTime || rawData?.sourceIssuedAt || null;
				} else if (src === "gdacs") {
					const minLevel = rules.gdacs?.minAlertLevel || "Orange";
					const parsed = parseGdacsFeed(rawData, {
						minAlertLevel: minLevel,
						retrievedAt: retrievedAtIso,
					});
					normalizedList = parsed.map((e) => ({ ...e, source: "GDACS", sourceId: "gdacs" }));
					const eventMaxTime = parsed.reduce((acc, ev) => {
						if (!ev.sourceIssuedAt) return acc;
						return !acc || Date.parse(ev.sourceIssuedAt) > Date.parse(acc)
							? ev.sourceIssuedAt
							: acc;
					}, null);
					latestSourceIssuedAt = rawData?.sourceIssuedAt || eventMaxTime || null;
				} else if (src === "openmeteo") {
					const forecast = analyzeFloodRisk(rawData, {
						triggerPolicy: rules.openmeteo?.triggerPolicy,
						retrievedAt: retrievedAtIso,
					});
					latestSourceIssuedAt =
						forecast.forecastMetadata?.issueTime || rawData?.sourceIssuedAt || null;
					if (forecast.anticipatoryAction?.triggerThresholdMet) {
						normalizedList = [
							{
								id: `openmeteo_${forecast.forecastMetadata?.modelRun || "run"}_${forecast.peakPrecipitationDate || "day"}`,
								externalId: `openmeteo_${forecast.forecastMetadata?.issueTime || forecast.peakPrecipitationDate || "forecast"}`,
								source: "OPENMETEO",
								sourceId: "openmeteo",
								eventType: "FL",
								hazardType: "flood",
								title: `Open-Meteo Rainfall Screening (${forecast.anticipatoryAction.alertColor})`,
								alertLevel: forecast.anticipatoryAction.alertColor,
								country: rules.openmeteo?.country || "Target Basin",
								coordinates: [
									Number(rules.openmeteo?.longitude ?? 90.4),
									Number(rules.openmeteo?.latitude ?? 23.8),
								],
								sourceIssuedAt: latestSourceIssuedAt,
								retrievedAt: retrievedAtIso,
								forecastMetadata: forecast.forecastMetadata,
								estimatedInundationDepthMeters:
									forecast.anticipatoryAction.estimatedInundationDepthMeters,
							},
						];
					}
				}

				const freshnessThresholdMs =
					config.freshnessThresholdsMs?.[src] || DEFAULT_FRESHNESS_THRESHOLDS_MS[src];
				const freshness = evaluateSourceFreshness({
					provider: src,
					sourceIssuedAt: latestSourceIssuedAt,
					retrievedAt: retrievedAtIso,
					freshnessThresholdMs,
					isSyntheticFixture,
					isCachedFallback: Boolean(rawData?._isCachedFallback),
					nowMs: nowFn(),
				});

				if (freshness.warnings.length > 0) {
					warnings.push(...freshness.warnings);
				}

				rawSnapshots.push({
					sourceId: src,
					payloadHash: `sha256:${computeSnapshotHash(rawData)}`,
					sourceIssuedAt: freshness.sourceIssuedAt,
					retrievedAt: retrievedAtIso,
					payload: rawData,
				});

				fetchedBySource[src] = {
					events: normalizedList,
					freshness,
					latestSourceIssuedAt: freshness.sourceIssuedAt,
				};

				feedHealth[src] = {
					sourceId: src,
					status: freshness.stale ? "degraded_stale" : "healthy",
					attempts: fetchResult.attempts,
					attemptLog: fetchResult.attemptLog,
					eventsReturned: normalizedList.length,
					freshness,
					checkpointAdvanced: false,
					error: null,
				};
			} catch (parseErr) {
				const parseFailure = {
					sourceId: src,
					category: "schema_mismatch",
					code: "FEED_PARSE_ERROR",
					retryable: false,
					message: redactSensitiveObject(parseErr.message),
				};
				errors.push(parseFailure);
				feedHealth[src] = {
					sourceId: src,
					status: "failed",
					attempts: fetchResult.attempts,
					attemptLog: fetchResult.attemptLog,
					eventsReturned: 0,
					freshness: null,
					checkpointAdvanced: false,
					error: parseFailure,
				};
			}
		}

		// Step 7: Provider-Specific Reconciliation, Geographic Coverage Check & Cross-Source Deduplication (PS-03, PS-04, RT-04)
		const targetCountries =
			config.countryFilter?.targetCountries ||
			config.targetCountries ||
			(CONFIG.TARGET_COUNTRIES && !CONFIG.TARGET_COUNTRIES.includes("*")
				? CONFIG.TARGET_COUNTRIES
				: ["*"]);
		const bbox = config.countryFilter?.bbox || config.bbox || null;
		const filterFeeds = config.countryFilter?.filterFeeds === true;

		const isEventPermitted = (event, rule = {}) => {
			const ruleCountries = rule.targetCountries || targetCountries;
			const ruleBbox = rule.bbox || bbox;
			const shouldFilter =
				filterFeeds || (rule.targetCountries && !rule.targetCountries.includes("*"));
			if (shouldFilter && !ruleCountries.includes("*")) {
				return isEventInCountry(event, ruleCountries, ruleBbox);
			}
			return true;
		};

		// Build existing catalog from durable state for cross-source deduplication (PS-03)
		const existingCatalogFromState = Object.values(ledgerState.events || {}).map((entry) => {
			const latestRev = entry.revisions[entry.revisions.length - 1] || {};
			const evPayload = latestRev.normalizedPayload || {};
			return {
				canonicalId: `evt_${entry.sourceId}_${entry.externalEventId}`,
				externalKeys: [`${entry.sourceId.toUpperCase()}::${entry.externalEventId}`],
				sources: [entry.sourceId.toUpperCase()],
				source: entry.sourceId.toUpperCase(),
				externalId: entry.externalEventId,
				hazardType: evPayload.hazardType || evPayload.eventType || "earthquake",
				coordinates: evPayload.coordinates || null,
				timestamp: latestRev.sourceIssuedAt || evPayload.time || null,
				revision: entry.revisions.length,
			};
		});

		const allFetchedEvents = [];
		for (const src of Object.keys(fetchedBySource)) {
			// Include any retained retryQueue items from prior partial batches for this source (PS-04)
			const priorRetryItems = Array.isArray(ledgerState.retryQueue?.[src])
				? ledgerState.retryQueue[src]
				: [];
			const combined = [...priorRetryItems, ...fetchedBySource[src].events];
			fetchedBySource[src].events = combined;
			allFetchedEvents.push(...combined);
		}

		const dedupReport = matchAndDeduplicateEvents(
			allFetchedEvents,
			existingCatalogFromState,
			{ allowAutoMergeExactId: true },
		);

		const ambiguousIdsSet = new Set(
			dedupReport.possibleDuplicates.map((d) => d.incomingId).filter(Boolean),
		);

		// Step 8: Assess Qualifying Events within Bounded Budget & Deadline (SR-02, SR-03, PS-03)
		const normalizedEventsToCommit = [];
		const assessmentsToCommit = [];
		const batchAssessmentKeys = new Set();
		const alertsOutput = [];
		const checkpointUpdates = {};
		const retryableItemsBySource = {};

		let eventsFetchedCount = 0;
		let qualifyingEventsCount = 0;
		let assessedCount = 0;
		let skippedDuplicatesCount = 0;
		let hazardsDetectedCount = 0;

		for (const src of enabledSources) {
			const sourceBundle = fetchedBySource[src];
			if (!sourceBundle) {
				// Failed source: do not advance checkpoint (PS-04, RT-04)
				checkpointUpdates[src] = { advanceAllowed: false, partialBatch: false };
				continue;
			}

			const srcEvents = sourceBundle.events || [];
			eventsFetchedCount += srcEvents.length;
			let sourcePartialBatch = false;
			const sourceRemainingRetryItems = [];

			for (let idx = 0; idx < srcEvents.length; idx++) {
				const ev = srcEvents[idx];

				// Check deadline / cancellation & assessment budget before starting next event (SR-03)
				const remainingMs = deadlineEpochMs - nowFn() - config.reserveCleanupMs;
				if (
					runAbortController.signal.aborted ||
					remainingMs <= 0 ||
					assessedCount >= config.maxAssessmentsPerRun
				) {
					sourcePartialBatch = true;
					sourceRemainingRetryItems.push(...srcEvents.slice(idx));
					warnings.push({
						code: "PARTIAL_BATCH_DEFERRED",
						sourceId: src,
						message: `Deferred ${srcEvents.length - idx} remaining event(s) from '${src}' due to run deadline, signal, or assessment budget.`,
					});
					break;
				}

				const ruleForSource =
					src === "usgs"
						? rules.earthquake
						: src === "gdacs"
							? rules.gdacs
							: rules.openmeteo || {};

				const qualifiesByThreshold =
					src === "usgs"
						? ev.magnitude >= (rules.earthquake?.minMagnitude || 5.5)
						: src === "gdacs"
							? ev.alertLevel === "Red" || ev.alertLevel === "Orange"
							: true;

				if (!qualifiesByThreshold) continue;
				if (!isEventPermitted(ev, ruleForSource)) {
					missingInputs.push({
						field: "geographicCoverage",
						eventId: ev.id,
						message: `Event '${ev.id}' (${ev.place || ev.country || "unknown"}) excluded by configured country/bbox scope.`,
					});
					continue;
				}

				qualifyingEventsCount++;
				hazardsDetectedCount++;

				const evIdentity = computeEventIdentity(ev);
				normalizedEventsToCommit.push(ev);

				// PS-03: If cross-source duplicate is ambiguous, keep reviewable rather than auto-merging
				if (ambiguousIdsSet.has(evIdentity.externalEventId) || ambiguousIdsSet.has(ev.id)) {
					warnings.push({
						code: "AMBIGUOUS_CROSS_SOURCE_DUPLICATE_HELD",
						eventId: ev.id,
						message: `Event '${ev.id}' matches a spatiotemporal candidate from another source and is held for human review.`,
					});
				}

				// Determine method & parameter versions for assessment idempotency key (SR-02, PS-03)
				const methodId = "vulnerability.sendai_composite";
				const methodVersion = modelVersions[methodId] || "1.1";
				const parameterVersion = config.parameterVersion || "GEM-v2.0/HAZUS-MH-2.1";

				const { assessmentKey, compositeDescriptor } = computeAssessmentKey({
					eventRevisionKey: evIdentity.eventRevisionKey,
					methodId,
					methodVersion,
					parameterVersion,
					exposureVersion,
					configHash,
				});

				// PS-03: Check if assessment already exists in durable state OR current batch
				const alreadyInStorage = Boolean(ledgerState.assessments?.[assessmentKey]);
				const alreadyInBatch = batchAssessmentKeys.has(assessmentKey);

				if (alreadyInStorage || alreadyInBatch) {
					skippedDuplicatesCount++;
					continue;
				}
				batchAssessmentKeys.add(assessmentKey);

				const assessedAtIso = toUtcIsoWithOffset(nowFn());
				const processedAlert = await processQualifyingEvent(ev, config, {
					readOnly: config.readOnly,
					writeLocalArtifacts: config.writeLocalArtifacts !== false,
					mock: config.mock === true,
					exposureGeoJSON: sharedExposureGeoJSON,
					modelAdapters: dependencies.modelAdapters,
					publicWriteAdapter: dependencies.publicWriteAdapter,
				});

				assessedCount++;
				alertsOutput.push({
					...processedAlert,
					assessmentKey,
					eventRevisionKey: evIdentity.eventRevisionKey,
				});

				assessmentsToCommit.push({
					assessmentKey,
					compositeDescriptor,
					eventKey: evIdentity.eventKey,
					eventRevisionKey: evIdentity.eventRevisionKey,
					sourceId: evIdentity.sourceId,
					externalEventId: evIdentity.externalEventId,
					methodId,
					methodVersion,
					parameterVersion,
					exposureVersion,
					configHash,
					sourceIssuedAt: ev.sourceIssuedAt
						? toUtcIsoWithOffset(ev.sourceIssuedAt)
						: null,
					retrievedAt: ev.retrievedAt ? toUtcIsoWithOffset(ev.retrievedAt) : assessedAtIso,
					assessedAt: assessedAtIso,
					evidenceBasis:
						processedAlert.vulnerabilityReport?.evidenceBasis || "modelled",
					verificationStatus:
						processedAlert.vulnerabilityReport?.verificationStatus || "unreviewed",
					approvalStatus: "draft",
					limitations:
						processedAlert.vulnerabilityReport?.provenance?.limitations || [
							"Automated preliminary assessment; requires human validation before official reporting.",
						],
					result: {
						summary: processedAlert.summary,
						hazardAssessment: processedAlert.vulnerabilityReport?.hazardAssessment,
						sendaiFrameworkMetrics:
							processedAlert.vulnerabilityReport?.sendaiFrameworkMetrics,
						capValidation: processedAlert.capValidation,
					},
				});
			}

			if (sourcePartialBatch) {
				retryableItemsBySource[src] = sourceRemainingRetryItems;
				checkpointUpdates[src] = {
					advanceAllowed: false,
					partialBatch: true,
				};
				feedHealth[src].status = "degraded_partial_batch";
				feedHealth[src].checkpointAdvanced = false;
			} else {
				const cursorToken =
					sourceBundle.latestSourceIssuedAt || fetchWindows[src].windowEnd;
				checkpointUpdates[src] = {
					advanceAllowed: true,
					cursor: cursorToken,
					windowStart: fetchWindows[src].windowStart,
					windowEnd: fetchWindows[src].windowEnd,
					lastSourceIssuedAt: sourceBundle.latestSourceIssuedAt,
				};
				feedHealth[src].checkpointAdvanced = true;
			}
		}

		// Step 9: Determine Coverage & Outcome Status (SR-04, RT-04, Invariants)
		const totalSources = enabledSources.length;
		const healthySources = enabledSources.filter(
			(s) => feedHealth[s]?.status === "healthy",
		).length;
		const staleOrPartialSources = enabledSources.filter(
			(s) =>
				feedHealth[s]?.status === "degraded_stale" ||
				feedHealth[s]?.status === "degraded_partial_batch" ||
				feedHealth[s]?.status === "deferred",
		).length;
		const failedSources = enabledSources.filter(
			(s) =>
				!feedHealth[s] ||
				feedHealth[s].status === "failed" ||
				feedHealth[s].status === "cancelled",
		).length;

		let runStatus = "success";
		let coverageStatus = "complete_coverage";

		if (totalSources === 0 || (healthySources === 0 && staleOrPartialSources === 0)) {
			// All sources failed or none usable -> failed ("no_usable_data"), NEVER a misleading all-clear!
			runStatus = "failed";
			coverageStatus = "no_usable_data";
		} else if (failedSources > 0 || staleOrPartialSources > 0 || runAbortController.signal.aborted) {
			// Partial feed failure or stale feed or partial batch -> degraded
			runStatus = "degraded";
			coverageStatus =
				failedSources > 0
					? "partial_source_coverage_degraded"
					: "stale_or_deferred_coverage_degraded";
		} else if (qualifyingEventsCount === 0) {
			// Healthy feeds returned 0 qualifying events -> explicit "no_matching_events" coverage, NOT a zero-risk claim
			runStatus = "success";
			coverageStatus = "no_matching_events_in_covered_scope";
		} else {
			// Hazard detected is a successful assessment output, not a software failure! (SR-04)
			runStatus = "success";
			coverageStatus = "hazards_detected_and_assessed";
		}

		// Step 10: Atomically Commit Results & Checkpoints under Fencing Token Protection (PS-04, CC-02)
		const completedAtIso = toUtcIsoWithOffset(nowFn());
		const commitResult = await stateStore.commitRunTransaction({
			ownerId: runId,
			fencingToken: lease.fencingToken,
			nowFn,
			signal: dependencies.abortDuringCommitSignal || null,
			runRecord: {
				runId,
				status: runStatus,
				scopeId: config.scopeId,
				commitSha,
				configHash,
				modelVersions,
				startedAt: startedAtIso,
				deadlineAt: deadlineAtIso,
				completedAt: completedAtIso,
				coverageStatus,
				counts: {
					eventsFetched: eventsFetchedCount,
					qualifyingEvents: qualifyingEventsCount,
					assessed: assessedCount,
					skippedDuplicates: skippedDuplicatesCount,
					ambiguousDuplicatesHeld: dedupReport.possibleDuplicates.length,
					hazardsDetected: hazardsDetectedCount,
				},
				errors,
			},
			normalizedEvents: normalizedEventsToCommit,
			assessments: assessmentsToCommit,
			checkpointUpdates,
			retryableItemsBySource,
			ambiguousDuplicates: dedupReport.possibleDuplicates,
			rawSnapshots,
		});

		const summary = redactSensitiveObject({
			schemaVersion: MONITOR_SUMMARY_SCHEMA_VERSION,
			runId,
			status: runStatus,
			exitCode: mapOutcomeToExitCode(runStatus, config),
			mode: config.mode,
			readOnly: config.readOnly,
			scopeId: config.scopeId,
			commitSha,
			configHash,
			exposureVersion,
			modelVersions,
			startedAt: startedAtIso,
			deadlineAt: deadlineAtIso,
			completedAt: completedAtIso,
			committedAt: commitResult.committedAt,
			coverageStatus,
			coverageNote:
				qualifyingEventsCount === 0 && runStatus === "success"
					? "No events met configured screening thresholds in the monitored window and sources; this indicates no matching feed events, not an absence of physical hazard risk."
					: null,
			persistence: {
				backendType: stateStore.backendType,
				stateless: stateStore.stateless,
				crossRunDeduplicationEnabled: !stateStore.stateless,
				committed: commitResult.committed,
				stateVersion: commitResult.stateVersion,
				fencingToken: commitResult.fencingToken,
				stats: commitResult.stats,
			},
			counts: {
				eventsFetched: eventsFetchedCount,
				qualifyingEvents: qualifyingEventsCount,
				assessed: assessedCount,
				skippedDuplicates: skippedDuplicatesCount,
				ambiguousDuplicatesHeld: dedupReport.possibleDuplicates.length,
				hazardsDetected: hazardsDetectedCount,
			},
			feedHealth,
			providerBudgets: budgetTracker.getSummary(),
			alerts: alertsOutput,
			identityAudit: dedupReport,
			missingInputs,
			blockedSideEffects,
			warnings,
			errors,
			// Backwards-compatibility fields for existing callers of runMonitoringCycle
			timestamp: completedAtIso,
			eventsChecked: eventsFetchedCount,
			qualifyingEventsTriggered: qualifyingEventsCount,
		});

		// Step 11: Export Machine-Readable & Human-Readable Summaries (Section 8)
		await exportSummaryArtifacts(config, summary);

		return summary;
	} catch (fatalErr) {
		const completedAtIso = toUtcIsoWithOffset(nowFn());
		const errCode = fatalErr.code || "FATAL_RUN_ERROR";
		const failedSummary = redactSensitiveObject({
			schemaVersion: MONITOR_SUMMARY_SCHEMA_VERSION,
			runId,
			status: "failed",
			exitCode: 1,
			mode: config.mode,
			readOnly: config.readOnly,
			scopeId: config.scopeId,
			commitSha,
			configHash,
			modelVersions,
			startedAt: startedAtIso,
			deadlineAt: deadlineAtIso,
			completedAt: completedAtIso,
			coverageStatus: "no_usable_data",
			persistence: {
				backendType: stateStore?.backendType || config.stateBackend,
				stateless: Boolean(stateStore?.stateless),
				crossRunDeduplicationEnabled: stateStore ? !stateStore.stateless : false,
				committed: false,
			},
			counts: {
				eventsFetched: 0,
				qualifyingEvents: 0,
				assessed: 0,
				skippedDuplicates: 0,
				ambiguousDuplicatesHeld: 0,
				hazardsDetected: 0,
			},
			feedHealth: {},
			missingInputs,
			blockedSideEffects,
			warnings,
			errors: [
				...errors,
				{
					category:
						errCode === "STATE_BACKEND_UNAVAILABLE" || errCode === "STATE_CORRUPT"
							? "state_backend_failure"
							: errCode.includes("FENCING") || errCode.includes("LEASE")
								? "lease_or_fencing_conflict"
								: "runtime_failure",
					code: errCode,
					message: fatalErr.message,
				},
			],
		});
		await exportSummaryArtifacts(config, failedSummary);
		return failedSummary;
	} finally {
		// Step 12: Clean up all timers, event listeners, and release owned lease (SR-01, SR-03, CC-02)
		if (deadlineTimer) clearTimeout(deadlineTimer);
		if (leaseRenewTimer) clearInterval(leaseRenewTimer);
		if (externalSignal) {
			externalSignal.removeEventListener("abort", onExternalAbort);
		}
		if (stateStore && lease) {
			try {
				await stateStore.releaseLease({
					ownerId: runId,
					fencingToken: lease.fencingToken,
					nowFn,
				});
			} catch (_) {}
		}
	}
}

/**
 * Export machine-readable JSON summary and human-readable Markdown summary if configured
 */
async function exportSummaryArtifacts(config = {}, summary = {}) {
	try {
		if (config.summaryOutputPath) {
			const outPath = path.resolve(config.summaryOutputPath);
			const dir = path.dirname(outPath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			await fs.promises.writeFile(outPath, JSON.stringify(summary, null, 2), "utf8");
		}
		if (config.markdownSummaryPath) {
			const mdPath = path.resolve(config.markdownSummaryPath);
			const dir = path.dirname(mdPath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			await fs.promises.writeFile(mdPath, formatMonitorMarkdownSummary(summary), "utf8");
		}
	} catch (_) {}
}

/**
 * Backwards-compatible `runMonitoringCycle(options)` wrapper around `runOnce` (SR-01)
 * Preserves existing return fields (`timestamp`, `eventsChecked`, `qualifyingEventsTriggered`, `alerts`, `identityAudit`)
 * while supporting full single-run options.
 */
async function runMonitoringCycle(options = {}) {
	const fallbackMockPayloads =
		options.mockPayloads ||
		(options.mock
			? {
					usgs: {
						type: "FeatureCollection",
						metadata: { generated: Date.now() },
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
									fromdate: new Date().toISOString(),
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

	// Preserve legacy test expectations when called directly via `runMonitoringCycle({ mock: true })`
	// unless caller explicitly sets readOnly: true or stateBackend
	const readOnly = options.readOnly !== undefined ? options.readOnly : false;
	const stateBackend = options.stateBackend || "stateless";

	return runOnce(
		{
			...options,
			mode: "single-run",
			readOnly,
			stateBackend,
			mockPayloads: fallbackMockPayloads,
		},
		options.dependencies || {},
		options.signal || null,
	);
}

/**
 * Continuous monitoring daemon wrapper around bounded `runOnce` (SR-01, SR-03)
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
	const activeAbortController = new AbortController();

	const run = async () => {
		if (isRunning || activeAbortController.signal.aborted) return;
		isRunning = true;
		try {
			console.log(`[DRR Monitor] [${new Date().toISOString()}] Executing telemetry check...`);
			const summary = await runOnce(
				{
					...options,
					mode: "daemon",
					readOnly: options.readOnly !== undefined ? options.readOnly : true,
					stateBackend: options.stateBackend || "cas-file-store",
				},
				options.dependencies || {},
				activeAbortController.signal,
			);
			console.log(
				`[DRR Monitor] Status: ${summary.status} | Checked ${summary.eventsChecked} events. Triggered ${summary.qualifyingEventsTriggered} qualifying alerts.`,
			);
		} catch (err) {
			console.error(`[DRR Monitor] Error during cycle: ${err.message}`);
		} finally {
			isRunning = false;
		}
	};

	run();
	const timer = setInterval(run, intervalMs);

	const cleanup = () => {
		console.log("\n[DRR Monitor] Stopping daemon gracefully...");
		activeAbortController.abort();
		clearInterval(timer);
		process.exit(0);
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);

	return {
		timer,
		stop: () => {
			activeAbortController.abort();
			clearInterval(timer);
		},
	};
}

module.exports = {
	MONITOR_SUMMARY_SCHEMA_VERSION,
	loadMonitoringRules,
	validateMonitorConfig,
	mapOutcomeToExitCode,
	formatMonitorMarkdownSummary,
	dispatchWebhook,
	processQualifyingEvent,
	runOnce,
	runMonitoringCycle,
	startMonitoringDaemon,
};
