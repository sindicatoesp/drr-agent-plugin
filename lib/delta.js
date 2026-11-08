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
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					try {
						const json = JSON.parse(data);
						if (json.error) {
							return reject(
								new Error(`DELTA MCP error: ${json.error.message || JSON.stringify(json.error)}`),
							);
						}
						resolve(json.result);
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

/**
 * UNDRR / ISC Hazard Information Profiles (HIPs) Taxonomy Mapping
 * Maps common hazard keys to standard DELTA HIP definitions:
 * - hipTypeId: High-level classification (Geological: 1041, Hydrometeorological: 1042, Environmental: 1039)
 * - hipClusterId: Hazard Cluster (Seismogenic: 1068, Flood: 1072, Wind Related: 1079, Volcanogenic: 1069)
 * - hipHazardId: Specific Hazard ID (78531 for Earthquake GH0001, 78572 for Fluvial Flood MH0007, etc.)
 */
const HIP_HAZARD_MAP = {
	earthquake: {
		code: "GH0001",
		name: "Earthquake",
		hipHazardId: "78531",
		hipClusterId: "1068",
		hipTypeId: "1041",
	},
	seismic: {
		code: "GH0001",
		name: "Earthquake",
		hipHazardId: "78531",
		hipClusterId: "1068",
		hipTypeId: "1041",
	},
	eq: {
		code: "GH0001",
		name: "Earthquake",
		hipHazardId: "78531",
		hipClusterId: "1068",
		hipTypeId: "1041",
	},
	flood: {
		code: "MH0007",
		name: "Fluvial (Riverine) Flood",
		hipHazardId: "78572",
		hipClusterId: "1072",
		hipTypeId: "1042",
	},
	flash_flood: {
		code: "MH0006",
		name: "Flash Flood",
		hipHazardId: "78571",
		hipClusterId: "1072",
		hipTypeId: "1042",
	},
	fl: {
		code: "MH0007",
		name: "Fluvial (Riverine) Flood",
		hipHazardId: "78572",
		hipClusterId: "1072",
		hipTypeId: "1042",
	},
	cyclone: {
		code: "MH0057",
		name: "Tropical Cyclone",
		hipHazardId: "78622",
		hipClusterId: "1079",
		hipTypeId: "1042",
	},
	hurricane: {
		code: "MH0057",
		name: "Tropical Cyclone",
		hipHazardId: "78622",
		hipClusterId: "1079",
		hipTypeId: "1042",
	},
	typhoon: {
		code: "MH0057",
		name: "Tropical Cyclone",
		hipHazardId: "78622",
		hipClusterId: "1079",
		hipTypeId: "1042",
	},
	wind: {
		code: "MH0057",
		name: "Tropical Cyclone",
		hipHazardId: "78622",
		hipClusterId: "1079",
		hipTypeId: "1042",
	},
	tc: {
		code: "MH0057",
		name: "Tropical Cyclone",
		hipHazardId: "78622",
		hipClusterId: "1079",
		hipTypeId: "1042",
	},
	tsunami: {
		code: "GH0006",
		name: "Tsunami (Earthquake Trigger)",
		hipHazardId: "78536",
		hipClusterId: "1068",
		hipTypeId: "1041",
	},
	volcano: {
		code: "GH0015",
		name: "Ground Shaking (Volcanic Earthquake)",
		hipHazardId: "78545",
		hipClusterId: "1069",
		hipTypeId: "1041",
	},
	vo: {
		code: "GH0015",
		name: "Ground Shaking (Volcanic Earthquake)",
		hipHazardId: "78545",
		hipClusterId: "1069",
		hipTypeId: "1041",
	},
	drought: {
		code: "MH0035",
		name: "Drought",
		hipHazardId: "78600",
		hipClusterId: "1076",
		hipTypeId: "1042",
	},
	dr: {
		code: "MH0035",
		name: "Drought",
		hipHazardId: "78600",
		hipClusterId: "1076",
		hipTypeId: "1042",
	},
	wildfire: {
		code: "EN0013",
		name: "Wildfires",
		hipHazardId: "78521",
		hipClusterId: "1066",
		hipTypeId: "1039",
	},
	wf: {
		code: "EN0013",
		name: "Wildfires",
		hipHazardId: "78521",
		hipClusterId: "1066",
		hipTypeId: "1039",
	},
};

/**
 * Resolves standard UNDRR/ISC HIP hierarchy for a given hazard string
 * @param {string} hazard - Hazard identifier or code
 * @returns {object|null} HIP mapping object or null
 */
function mapHazardToHip(hazard) {
	if (!hazard || typeof hazard !== "string") return null;
	const key = hazard.toLowerCase().replace(/[\s-]/g, "_");
	if (HIP_HAZARD_MAP[key]) {
		return HIP_HAZARD_MAP[key];
	}
	// Substring match
	for (const [k, v] of Object.entries(HIP_HAZARD_MAP)) {
		if (key.includes(k) || k.includes(key)) {
			return v;
		}
	}
	return null;
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
			pageSize: 1,
		});
		if (existing && Array.isArray(existing.items) && existing.items.length > 0) {
			existingRecord = existing.items[0];
		}
	} catch (e) {
		// Proceed if filter is unsupported
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

		// Update existing draft
		const updateResult = await callDeltaMcp("disaster-record_update", {
			records: [
				{
					id: existingRecord.id,
					...sanitizeDeltaRecord(bundle.disasterRecord),
					assessmentModes: `${bundle.disasterRecord.assessmentModes} [Revised on ${new Date().toISOString()}]`,
				},
			],
		});

		return {
			success: true,
			action: "updated_existing_draft",
			recordId: existingRecord.id,
			apiImportId: bundle.apiImportId,
			result: updateResult,
		};
	}

	// 3. Create parent disaster event if needed
	let disasterEventId = params.disasterEventId;
	if (!disasterEventId) {
		try {
			const eventResult = await callDeltaMcp("disaster-event_add", {
				records: [sanitizeDeltaEvent(bundle.parentEvent)],
			});
			if (eventResult && (eventResult.res?.[0]?.id || eventResult[0]?.id)) {
				disasterEventId = eventResult.res?.[0]?.id || eventResult[0].id;
			}
		} catch (e) {
			// If event creation fails or exists, continue
		}
	}

	// 4. Create new disaster record
	const recordResult = await callDeltaMcp("disaster-record_add", {
		records: [sanitizeDeltaRecord(bundle.disasterRecord, disasterEventId)],
	});

	if (recordResult && recordResult.ok === false) {
		const errorDetails = JSON.stringify(recordResult.res || recordResult.errors || recordResult);
		throw new Error(`DELTA MCP error: ${errorDetails}`);
	}

	const createdRecordId =
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

/**
 * Fetch baseline administrative divisions or historical records from DELTA
 * @param {string} entity - "division", "disaster-record", "hip-hazard", "hip-cluster", "hip-type", "sector"
 * @param {object} filter - Query parameters
 * @param {object} options - Optional mock flag
 */
async function fetchExposureFromDelta(entity = "division", filter = {}, options = {}) {
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

	const page = filter.page || 1;
	const pageSize = Math.min(filter.pageSize || filter.limit || 50, 1000);
	return callDeltaMcp("hip-hazard_list", { page, pageSize });
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
	HIP_HAZARD_MAP,
	buildRelationalRecordBundle,
	pushDraftDisasterRecord,
	fetchExposureFromDelta,
	fetchDeltaDocs,
	fetchDeltaHazards,
	fetchDeltaDimensions,
};
