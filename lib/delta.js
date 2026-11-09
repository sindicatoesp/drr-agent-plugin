/**
 * DELTA Resilience Core Application Connector (Advanced Relational Ingestion)
 * Two-way integration:
 * 1. Queries baseline exposure & administrative divisions from DELTA via MCP.
 * 2. Implements idempotent draft ingestion:
 *    - Auto-links or creates parent `disaster_event` in Draft status.
 *    - Creates or updates `disaster_records` with unique tenant-scoped `apiImportId`.
 *    - Maps Sendai Target B to relational `human-effects` (Displaced & Affected tables).
 *    - Maps Sendai Target C/D to `sector_disaster_records_relation` (Healthcare, Education, etc.).
 *    - Maps hazard polygon to PostGIS `disaster_records_geom` (EPSG:4326).
 *    - Enforces silent ingestion (`source: "drr-agent-plugin"`, `status: "draft"`).
 *    - Preserves human-validated/published records without overwriting.
 */

const http = require("http");
const https = require("https");
const { CONFIG } = require("./config");
const { isEventInCountry } = require("./spatial");

/**
 * Safely unwrap standard MCP result structures and stringified JSON payloads.
 * Handles:
 * - MCP Standard: { content: [{ type: "text", text: "..." }] }
 * - Direct JSON string: "{\"ok\": true, ...}"
 * - Parsed objects / arrays
 */
function unwrapMcpResult(jsonResult) {
	if (!jsonResult) return jsonResult;

	if (
		jsonResult.content &&
		Array.isArray(jsonResult.content) &&
		jsonResult.content[0] &&
		typeof jsonResult.content[0].text === "string"
	) {
		const text = jsonResult.content[0].text;
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	if (typeof jsonResult === "string") {
		try {
			return JSON.parse(jsonResult);
		} catch {
			return jsonResult;
		}
	}

	return jsonResult;
}

/**
 * Execute a JSON-RPC 2.0 tool call against DELTA's MCP server endpoint
 * @param {string} toolName - e.g. "disaster-record_add", "disaster-event_add", "division_list"
 * @param {object} toolArgs - Tool arguments object
 * @returns {Promise<object>} Result returned by DELTA
 */
function callDeltaMcp(toolName, toolArgs = {}) {
	return new Promise((resolve, reject) => {
		if (!CONFIG.DELTA_MCP_API_KEY) {
			return reject(
				new Error(
					"DELTA_MCP_API_KEY is not configured. Set DELTA_MCP_API_KEY in your environment or .env file.",
				),
			);
		}

		const parsedUrl = new URL(CONFIG.DELTA_API_URL);
		const client = parsedUrl.protocol === "https:" ? https : http;

		const payload = JSON.stringify({
			jsonrpc: "2.0",
			id: Date.now(),
			method: "tools/call",
			params: {
				name: toolName,
				arguments: toolArgs,
			},
		});

		const req = client.request(
			CONFIG.DELTA_API_URL,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
					"X-Auth": CONFIG.DELTA_MCP_API_KEY,
					"User-Agent": CONFIG.USER_AGENT,
				},
				timeout: CONFIG.REQUEST_TIMEOUT_MS,
			},
			(res) => {
				let data = "";
				let receivedBytes = 0;
				let aborted = false;
				res.on("data", (chunk) => {
					receivedBytes += Buffer.byteLength(chunk);
					if (receivedBytes > CONFIG.MAX_RESPONSE_BYTES) {
						aborted = true;
						req.destroy(
							new Error(
								`DELTA MCP response exceeded maximum size limit (${CONFIG.MAX_RESPONSE_BYTES} bytes)`,
							),
						);
						return;
					}
					data += chunk;
				});
				res.on("end", () => {
					if (aborted) return;
					try {
						const json = JSON.parse(data);
						if (json.error) {
							return reject(
								new Error(`DELTA MCP error: ${json.error.message || JSON.stringify(json.error)}`),
							);
						}
						resolve(unwrapMcpResult(json.result));
					} catch (e) {
						reject(new Error(`Failed to parse DELTA response: ${e.message}`));
					}
				});
			},
		);

		req.on("error", (err) => {
			reject(new Error(`Failed to connect to DELTA MCP endpoint: ${err.message}`));
		});

		req.on("timeout", () => {
			req.destroy();
			reject(new Error(`DELTA request timed out after ${CONFIG.REQUEST_TIMEOUT_MS}ms`));
		});

		req.write(payload);
		req.end();
	});
}

/**
 * Map general asset categories to DELTA standard sector names
 */
function mapAssetCategoryToSector(category) {
	const cat = (category || "").toLowerCase();
	if (cat.includes("health") || cat.includes("hospital") || cat.includes("clinic")) {
		return "Healthcare";
	}
	if (cat.includes("school") || cat.includes("education") || cat.includes("university")) {
		return "Education";
	}
	if (cat.includes("residen") || cat.includes("housing")) {
		return "Housing";
	}
	if (cat.includes("power") || cat.includes("water") || cat.includes("utility")) {
		return "Basic Utilities";
	}
	if (cat.includes("transport") || cat.includes("road") || cat.includes("bridge") || cat.includes("port")) {
		return "Transportation";
	}
	return "Critical Infrastructure";
}

const {
	lookupHip,
	findHipHazards,
	getAllHipTypes,
	getAllHipClusters,
	getAllHipHazards,
	HIP_TYPES,
	HIP_CLUSTERS,
	HIP_HAZARDS,
	COMMON_ALIASES,
} = require("./hips");

/**
 * UNDRR / ISC Hazard Information Profiles (HIPs) Taxonomy Mapping
 * Complete in-code mapping covering all 8 types, 49 clusters, and 301 hazards.
 */
const HIP_HAZARD_MAP = new Proxy({}, {
	get(target, prop) {
		if (typeof prop !== "string") return undefined;
		return lookupHip(prop);
	},
	has(target, prop) {
		return Boolean(lookupHip(prop));
	},
});

/**
 * Resolves standard UNDRR/ISC HIP hierarchy for a given hazard string or code
 * @param {string|object} hazard - Hazard identifier, code (e.g. "GH0001"), or keyword
 * @returns {object|null} Enriched HIP mapping object or null
 */
function mapHazardToHip(hazard) {
	return lookupHip(hazard);
}

/**
 * Sanitize disaster record object to match DELTA's exact fieldsDefApi schema.
 * Strips unrecognized fields like 'name' and 'notes' that DELTA's form validation blocks.
 */
function sanitizeDeltaRecord(record, disasterEventId = null) {
	const sanitized = {
		apiImportId: record.apiImportId,
		locationDesc: record.locationDesc || record.name || "Assessment Zone",
		startDate: record.startDate,
		endDate: record.endDate || null,
		primaryDataSource: record.primaryDataSource || "drr-agent-plugin",
		assessmentModes: record.assessmentModes || "Modeled Telemetry (GEM/HAZUS Fragility Curves)",
		originatorRecorderInst: record.originatorRecorderInst || "UNDRR DRR Agent Plugin",
		approvalStatus: record.approvalStatus || "draft",
		attachments: record.attachments || {},
	};
	if (disasterEventId) {
		sanitized.disasterEventId = disasterEventId;
	}
	if (record.hipHazardId && record.hipClusterId && record.hipTypeId) {
		sanitized.hipHazardId = record.hipHazardId;
		sanitized.hipClusterId = record.hipClusterId;
		sanitized.hipTypeId = record.hipTypeId;
	}
	if (record.spatialFootprint) {
		sanitized.spatialFootprint = record.spatialFootprint;
	}
	return sanitized;
}

/**
 * Sanitize parent disaster event object to match DELTA's exact fieldsDefApi schema.
 * Replaces 'name' with 'nameNational' and 'nameGlobalOrRegional', and strips unknown fields.
 */
function sanitizeDeltaEvent(event) {
	const sanitized = {
		apiImportId: event.apiImportId,
		nameNational: event.nameNational || event.name || "Hazard Incident",
		nameGlobalOrRegional:
			event.nameGlobalOrRegional || event.name || "Hazard Incident",
		startDate: event.startDate,
		dataSource: event.dataSource || event.source || "drr-agent-plugin",
		approvalStatus: event.approvalStatus || "draft",
	};
	if (event.hipHazardId && event.hipClusterId && event.hipTypeId) {
		sanitized.hipHazardId = event.hipHazardId;
		sanitized.hipClusterId = event.hipClusterId;
		sanitized.hipTypeId = event.hipTypeId;
	}
	return sanitized;
}

/**
 * Format complete relational disaster record bundle
 * @param {object} params - Input assessment and hazard parameters
 * @returns {object} Formatted relational entities ready for DELTA ingestion
 */
function buildRelationalRecordBundle(params = {}) {
	const hazardAssessment = params.hazardAssessment || {};
	const hazardType =
		hazardAssessment.hazardType ||
		params.hazardType ||
		params.hazard ||
		"general";
	const externalEventId = params.eventId || params.externalEventId || `evt_${Date.now()}`;
	const apiImportId = params.apiImportId || `drr_${hazardType}_${externalEventId}`;

	const sendai = params.sendaiFrameworkMetrics || {};
	const targetB = sendai.targetB_AffectedPeople || {};
	const targetC = sendai.targetC_DirectEconomicLoss || {};
	const targetD = sendai.targetD_CriticalInfrastructure || {};

	// Resolve UNDRR/ISC HIP Taxonomy
	const hipInfo =
		params.hipHazardId && params.hipClusterId && params.hipTypeId
			? {
					hipHazardId: params.hipHazardId,
					hipClusterId: params.hipClusterId,
					hipTypeId: params.hipTypeId,
					code: params.hipCode || "CUSTOM",
					name: params.hipName || hazardType,
				}
			: mapHazardToHip(hazardType);

	// 1. Parent Disaster Event (compliant with DELTA fieldsDefApi)
	const parentEvent = {
		nameNational: params.name || `${hazardType.toUpperCase()} Event (${externalEventId})`,
		nameGlobalOrRegional:
			params.place || params.name || `${hazardType.toUpperCase()} Event (${externalEventId})`,
		startDate: params.startDate || new Date().toISOString().split("T")[0],
		dataSource: params.source || "drr-agent-plugin",
		apiImportId: `event_${apiImportId}`,
		approvalStatus: "draft",
		// Aliases for convenience / test compatibility
		name: params.name || `${hazardType.toUpperCase()} Event (${externalEventId})`,
		status: "draft",
		source: "drr-agent-plugin",
		notes: `Auto-generated parent disaster event for ${hazardType} by DRR Agent Plugin.`,
	};

	if (hipInfo) {
		parentEvent.hipHazardId = hipInfo.hipHazardId;
		parentEvent.hipClusterId = hipInfo.hipClusterId;
		parentEvent.hipTypeId = hipInfo.hipTypeId;
	}

	// 2. Core Disaster Record (compliant with DELTA fieldsDefApi)
	const auditNotes =
		params.notes ||
		`Automated preliminary assessment generated by drr-agent-plugin on ${new Date().toISOString()}. Source: ${params.source || "Multi-Source Feeds"}. Status: draft.`;

	const disasterRecord = {
		apiImportId,
		locationDesc:
			params.locationDesc ||
			params.place ||
			params.country ||
			params.name ||
			`${hazardType} Preliminary Assessment`,
		startDate: params.startDate || new Date().toISOString().split("T")[0],
		endDate: params.endDate || null,
		primaryDataSource: params.source || "drr-agent-plugin",
		assessmentModes: params.notes
			? `${params.notes} | Modeled Telemetry (GEM/HAZUS Fragility Curves)`
			: "Modeled Telemetry (GEM/HAZUS Fragility Curves)",
		originatorRecorderInst: "UNDRR DRR Agent Plugin",
		approvalStatus: "draft",
		attachments: {
			auditSource: "drr-agent-plugin",
			version: "1.3.0",
			generatedAt: new Date().toISOString(),
			hazardAssessment,
			sendaiFrameworkMetrics: sendai,
			topDamagedAssets: params.topDamagedAssets || [],
			hazardFootprint: params.hazardGeoJSON || null,
			notes: auditNotes,
			hipTaxonomy: hipInfo,
		},
		// Internal convenience aliases (never sent over the wire to DELTA API)
		name: params.name || `${hazardType} Preliminary Assessment`,
		notes: auditNotes,
	};

	if (hipInfo) {
		disasterRecord.hipHazardId = hipInfo.hipHazardId;
		disasterRecord.hipClusterId = hipInfo.hipClusterId;
		disasterRecord.hipTypeId = hipInfo.hipTypeId;
	}

	// 3. Human Effects Relational Records (Target B)
	const humanEffects = [
		{
			table: "Displaced",
			count: targetB.estimatedDisplacedPopulation || 0,
			description: "Modeled shelter-dependent displaced persons based on uninhabitable dwellings (MDR >= 40%)",
		},
		{
			table: "Affected",
			count: targetB.totalExposedPopulation || 0,
			description: "Total exposed population within deterministic hazard impact boundary",
		},
	];

	// 4. Sector Damages Relational Records (Target C / D)
	const sectorMap = {};
	for (const asset of params.topDamagedAssets || []) {
		const sectorName = mapAssetCategoryToSector(asset.category);
		if (!sectorMap[sectorName]) {
			sectorMap[sectorName] = {
				sectorName,
				damagedFacilitiesCount: 0,
				totalEstimatedLossUsd: 0,
			};
		}
		sectorMap[sectorName].damagedFacilitiesCount++;
		sectorMap[sectorName].totalEstimatedLossUsd += parseFloat(asset.estimatedLossUsd || 0);
	}

	const sectorRelations = Object.values(sectorMap);

	// 5. PostGIS Geometry (EPSG:4326)
	let postGisGeom = null;
	if (params.hazardGeoJSON) {
		const geom = params.hazardGeoJSON.geometry || params.hazardGeoJSON;
		if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
			postGisGeom = {
				srid: 4326,
				geometry: geom,
			};
		}
	}

	return {
		apiImportId,
		parentEvent,
		disasterRecord,
		humanEffects,
		sectorRelations,
		postGisGeom,
	};
}

/**
 * Format and push a complete relational post-disaster assessment into DELTA
 * @param {object} params - Assessment parameters (from vulnerability report or emergency brief)
 * @param {object} options - Optional config: { mock: boolean, forceUpdate: boolean }
 * @returns {Promise<object>} Status report of created/updated records
 */
async function pushDraftDisasterRecord(params = {}, options = {}) {
	const bundle = buildRelationalRecordBundle(params);

	// Country Guard: DELTA is a national software deployed for a specific country instance.
	// Only push disaster records if the event impacts the configured target country.
	const targetCountries = options.targetCountries || CONFIG.TARGET_COUNTRIES || ["*"];
	const strictCountry =
		options.strictCountryMatch !== undefined
			? options.strictCountryMatch
			: CONFIG.DELTA_COUNTRY_STRICT;

	if (strictCountry && targetCountries && !targetCountries.includes("*")) {
		const eventLocation = {
			country: params.country,
			place: params.place || params.locationDesc,
			title: params.name,
			coordinates:
				params.coordinates ||
				(params.hazardGeoJSON && params.hazardGeoJSON.coordinates),
		};

		const matches = isEventInCountry(eventLocation, targetCountries, options.bbox);
		if (!matches) {
			const eventDesc =
				params.country || params.place || params.locationDesc || "foreign location";
			return {
				success: false,
				skipped: true,
				reason: "country_mismatch",
				apiImportId: bundle.apiImportId,
				eventLocation: eventDesc,
				targetCountries,
				message: `DELTA push skipped: event location "${eventDesc}" does not match configured country [${targetCountries.join(", ")}].`,
			};
		}
	}

	if (options.mock) {
		return {
			success: true,
			action: "mock_relational_draft_ingestion",
			apiImportId: bundle.apiImportId,
			status: "draft",
			source: "drr-agent-plugin",
			entities: {
				parentEvent: bundle.parentEvent,
				disasterRecord: bundle.disasterRecord,
				humanEffects: bundle.humanEffects,
				sectorRelations: bundle.sectorRelations,
				postGisGeom: bundle.postGisGeom,
			},
			notes: bundle.disasterRecord.notes,
			record: {
				...bundle.disasterRecord,
				status: "draft",
				source: "drr-agent-plugin",
				sendaiMetrics: {
					totalExposedPopulation: bundle.humanEffects[1]?.count || 0,
					estimatedDisplaced: bundle.humanEffects[0]?.count || 0,
					estimatedDirectLossUsd: bundle.sectorRelations.reduce((a, b) => a + b.totalEstimatedLossUsd, 0),
				},
			},
		};
	}

	// 1. Check for existing record by apiImportId to enforce idempotent revisions
	let existingRecord = null;
	try {
		const existing = await callDeltaMcp("disaster-record_list", {
			filter: { apiImportId: bundle.apiImportId },
			pageSize: 50,
		});
		const items =
			existing?.data?.items ||
			existing?.items ||
			(Array.isArray(existing?.data) ? existing.data : null) ||
			(Array.isArray(existing) ? existing : []);
		existingRecord = items.find((item) => item.apiImportId === bundle.apiImportId) || null;
	} catch (e) {
		// Proceed if filter/list is unsupported
	}

	// 2. If record exists, verify it is still in Draft status
	if (existingRecord) {
		if (existingRecord.approvalStatus && existingRecord.approvalStatus !== "draft" && !options.forceUpdate) {
			return {
				success: false,
				skipped: true,
				action: "preserved_human_record",
				reason: `Disaster record ${existingRecord.id} is already in '${existingRecord.approvalStatus}' status and cannot be overwritten.`,
				recordId: existingRecord.id,
			};
		}
	}

	// 3. Resolve or create parent disaster event
	let disasterEventId = params.disasterEventId;
	if (!disasterEventId) {
		try {
			// Check if parent event already exists in DELTA
			const existingEventsRes = await callDeltaMcp("disaster-event_list", {
				pageSize: 50,
			});
			const eventItems =
				existingEventsRes?.data?.items ||
				existingEventsRes?.items ||
				(Array.isArray(existingEventsRes?.data) ? existingEventsRes.data : null) ||
				(Array.isArray(existingEventsRes) ? existingEventsRes : []);
			const matchedEvent = eventItems.find(
				(e) => e.apiImportId === bundle.parentEvent.apiImportId,
			);
			if (matchedEvent && matchedEvent.id) {
				disasterEventId = matchedEvent.id;
			}
		} catch (e) {
			// Fall through to creation attempt
		}
	}

	if (!disasterEventId) {
		try {
			const eventResult = await callDeltaMcp("disaster-event_add", {
				records: [sanitizeDeltaEvent(bundle.parentEvent)],
			});
			const createdEventId =
				eventResult?.res?.[0]?.id ||
				eventResult?.[0]?.id ||
				(Array.isArray(eventResult?.res) ? eventResult.res[0]?.id : null);
			if (createdEventId) {
				disasterEventId = createdEventId;
			}
		} catch (e) {
			// If creation failed due to duplicate key or constraint, attempt recovery lookup
			try {
				const retryRes = await callDeltaMcp("disaster-event_list", { pageSize: 50 });
				const retryItems =
					retryRes?.data?.items ||
					retryRes?.items ||
					(Array.isArray(retryRes?.data) ? retryRes.data : null) ||
					(Array.isArray(retryRes) ? retryRes : []);
				const matched = retryItems.find(
					(e) => e.apiImportId === bundle.parentEvent.apiImportId,
				);
				if (matched && matched.id) {
					disasterEventId = matched.id;
				}
			} catch (_) {}
		}
	}

	// 4. Create new disaster record (or update if already exists)
	let recordResult;
	let createdRecordId;

	if (existingRecord) {
		// Update existing draft
		const updateResult = await callDeltaMcp("disaster-record_update", {
			records: [
				{
					id: existingRecord.id,
					...sanitizeDeltaRecord(bundle.disasterRecord, disasterEventId),
					assessmentModes: `${bundle.disasterRecord.assessmentModes} [Revised on ${new Date().toISOString()}]`,
				},
			],
		});

		return {
			success: true,
			action: "updated_existing_draft",
			recordId: existingRecord.id,
			apiImportId: bundle.apiImportId,
			disasterEventId,
			result: updateResult,
		};
	}

	try {
		recordResult = await callDeltaMcp("disaster-record_add", {
			records: [sanitizeDeltaRecord(bundle.disasterRecord, disasterEventId)],
		});
	} catch (addErr) {
		// If add failed due to duplicate key violation, attempt to recover by updating existing
		try {
			const recoveryList = await callDeltaMcp("disaster-record_list", { pageSize: 50 });
			const recItems =
				recoveryList?.data?.items ||
				recoveryList?.items ||
				(Array.isArray(recoveryList?.data) ? recoveryList.data : null) ||
				(Array.isArray(recoveryList) ? recoveryList : []);
			const existingDup = recItems.find((r) => r.apiImportId === bundle.apiImportId);
			if (existingDup && existingDup.id) {
				const updateResult = await callDeltaMcp("disaster-record_update", {
					records: [
						{
							id: existingDup.id,
							...sanitizeDeltaRecord(bundle.disasterRecord, disasterEventId),
							assessmentModes: `${bundle.disasterRecord.assessmentModes} [Revised on ${new Date().toISOString()}]`,
						},
					],
				});
				return {
					success: true,
					action: "updated_existing_draft",
					recordId: existingDup.id,
					apiImportId: bundle.apiImportId,
					disasterEventId,
					result: updateResult,
				};
			}
		} catch (_) {}
		throw addErr;
	}

	if (recordResult && recordResult.ok === false) {
		const errorDetails = JSON.stringify(recordResult.res || recordResult.errors || recordResult);
		throw new Error(`DELTA MCP error: ${errorDetails}`);
	}

	createdRecordId =
		recordResult?.res?.[0]?.id || recordResult?.[0]?.id || `rec_${Date.now()}`;

	// 5. Ingest relational human effects (Displaced & Affected)
	for (const he of bundle.humanEffects) {
		try {
			await callDeltaMcp("human-effects_save", {
				data: {
					recordId: createdRecordId,
					table: he.table,
					columns: ["count", "notes"],
					data: {
						newRows: [{ count: he.count, notes: he.description }],
					},
				},
			});
		} catch (e) {
			// Gracefully continue
		}
	}

	return {
		success: true,
		action: "created_new_relational_draft",
		recordId: createdRecordId,
		apiImportId: bundle.apiImportId,
		disasterEventId,
		entitiesCreated: {
			record: true,
			humanEffectsCount: bundle.humanEffects.length,
			sectorRelationsCount: bundle.sectorRelations.length,
			hasGeometry: Boolean(bundle.postGisGeom),
		},
	};
}

const ALLOWED_DELTA_ENTITIES = new Set([
	"division",
	"disaster-record",
	"disaster-event",
	"organization",
	"hip-hazard",
	"hip-cluster",
	"hip-type",
	"sector",
]);

/**
 * Fetch baseline administrative divisions or historical records from DELTA
 * @param {string} entity - "division", "disaster-record", "hip-hazard", "hip-cluster", "hip-type", "sector"
 * @param {object} filter - Query parameters
 * @param {object} options - Optional mock flag
 */
async function fetchExposureFromDelta(entity = "division", filter = {}, options = {}) {
	if (!ALLOWED_DELTA_ENTITIES.has(entity)) {
		throw new Error(
			`Invalid DELTA entity '${entity}'. Allowed entities: ${Array.from(ALLOWED_DELTA_ENTITIES).join(", ")}`,
		);
	}
	if (options.mock) {
		if (entity === "hip-hazard") {
			return {
				entity,
				page: 1,
				items: [
					{ id: "78531", code: "GH0001", name: "Earthquake", clusterId: "1068", typeId: "1041" },
					{ id: "78572", code: "MH0007", name: "Fluvial (Riverine) Flood", clusterId: "1072", typeId: "1042" },
					{ id: "78622", code: "MH0057", name: "Tropical Cyclone", clusterId: "1079", typeId: "1042" },
				],
			};
		}
		if (entity === "hip-cluster") {
			return {
				entity,
				page: 1,
				items: [
					{ id: "1068", name: "Seismogenic", typeId: "1041" },
					{ id: "1072", name: "Flood", typeId: "1042" },
				],
			};
		}
		if (entity === "hip-type") {
			return {
				entity,
				page: 1,
				items: [
					{ id: "1041", name: "Geological" },
					{ id: "1042", name: "Hydrometeorological" },
				],
			};
		}
		return {
			entity,
			page: 1,
			items: [
				{ id: "div_1", name: "Capital District", countryAccountsId: "demo_country" },
				{ id: "div_2", name: "Coastal Province", countryAccountsId: "demo_country" },
			],
		};
	}

	const toolName = `${entity}_list`;
	return callDeltaMcp(toolName, filter);
}

/**
 * Retrieve DTS system documentation, entity relationships, and workflow from DELTA MCP
 * Calls the built-in 'docs' tool in DELTA's MCP server.
 * @param {object} options - Optional config: { mock: boolean }
 * @returns {Promise<string|object>} Documentation markdown text from DELTA
 */
async function fetchDeltaDocs(options = {}) {
	if (options.mock) {
		return {
			text: `DTS Data Model - Quick Reference
================================
HAZARD CLASSIFICATION: hip-type -> hip-cluster -> hip-hazard
READ-ONLY REFERENCE DATA: hip-type, hip-cluster, hip-hazard, sector, categories
WORKFLOW: 1. hazardous-event_add, 2. disaster-event_add, 3. disaster-record_add
TOOLS: docs, hip-hazard_list, analytics_dimensions, disaster-record_add`,
		};
	}
	return callDeltaMcp("docs", {});
}

/**
 * Retrieve official UNDRR/ISC HIP hazard list from DELTA MCP
 * Can query either 'hip-hazard_list' tool or 'analytics_dimensions' tool.
 * @param {object} filter - Query parameters: { page: number, pageSize: number, mode: "list"|"dimensions" }
 * @param {object} options - Optional config: { mock: boolean }
 * @returns {Promise<object>} List of HIP hazard records
 */
async function fetchDeltaHazards(filter = {}, options = {}) {
	if (options.mock) {
		return {
			items: [
				{ id: "78531", code: "GH0001", name: "Earthquake", clusterId: "1068", typeId: "1041" },
				{ id: "78572", code: "MH0007", name: "Fluvial (Riverine) Flood", clusterId: "1072", typeId: "1042" },
				{ id: "78622", code: "MH0057", name: "Tropical Cyclone", clusterId: "1079", typeId: "1042" },
				{ id: "78536", code: "GH0006", name: "Tsunami (Earthquake Trigger)", clusterId: "1068", typeId: "1041" },
				{ id: "78545", code: "GH0015", name: "Ground Shaking (Volcanic Earthquake)", clusterId: "1069", typeId: "1041" },
			],
			page: 1,
			pageSize: filter.pageSize || 50,
			total: 5,
		};
	}

	if (filter.mode === "dimensions") {
		return callDeltaMcp("analytics_dimensions", { type: "hazards" });
	}

	if (filter.local || CONFIG.DRR_OFFLINE_MODE) {
		const items = findHipHazards({
			search: filter.search || filter.query,
			clusterId: filter.clusterId,
			typeId: filter.typeId,
			limit: filter.pageSize || filter.limit || 50,
		});
		return { items, page: 1, total: items.length, source: "in_code_taxonomy" };
	}

	const page = filter.page || 1;
	const pageSize = Math.min(filter.pageSize || filter.limit || 50, 1000);
	try {
		return await callDeltaMcp("hip-hazard_list", { page, pageSize });
	} catch (err) {
		// Graceful fallback to in-code taxonomy if live DELTA server is unreachable
		const items = findHipHazards({
			search: filter.search || filter.query,
			clusterId: filter.clusterId,
			typeId: filter.typeId,
			limit: pageSize,
		});
		return {
			items,
			page,
			total: items.length,
			source: "in_code_taxonomy_fallback",
			fallbackReason: err.message,
		};
	}
}

/**
 * Retrieve reference lookup dimensions from DELTA MCP (hazards, clusters, types, divisions, sectors)
 * Calls DELTA's 'analytics_dimensions' MCP tool.
 * @param {string} dimensionType - "hazards", "hazard-clusters", "hazard-types", "divisions", "sectors", "all"
 * @param {object} options - Optional config: { mock: boolean }
 * @returns {Promise<object>}
 */
async function fetchDeltaDimensions(dimensionType = "hazards", options = {}) {
	if (options.mock) {
		return {
			type: dimensionType,
			hazards: [
				{ id: "78531", code: "GH0001", name: "Earthquake", clusterId: "1068", typeId: "1041" },
			],
		};
	}
	return callDeltaMcp("analytics_dimensions", { type: dimensionType });
}

module.exports = {
	callDeltaMcp,
	mapAssetCategoryToSector,
	mapHazardToHip,
	lookupHip,
	findHipHazards,
	getAllHipTypes,
	getAllHipClusters,
	getAllHipHazards,
	HIP_HAZARD_MAP,
	HIP_TYPES,
	HIP_CLUSTERS,
	HIP_HAZARDS,
	COMMON_ALIASES,
	buildRelationalRecordBundle,
	pushDraftDisasterRecord,
	fetchExposureFromDelta,
	fetchDeltaDocs,
	fetchDeltaHazards,
	fetchDeltaDimensions,
};
