/**
 * End-User Goal-Oriented Workflow Planner, Operational Context & Action-Tier Governance
 *
 * Transforms natural-language DRR user goals into inspectable, dependency-ordered
 * execution plans with:
 * - Action-tier classification (read_only | reversible | consequential)
 * - Operational context resolution & staleness detection
 * - Targeted clarification questions for missing inputs (never re-asking known context)
 * - Mandatory DRR data-integrity & human-in-the-loop approval gates
 *
 * Pure Node.js standard library only.
 */

const { CONFIG } = require("./config");

const CONSEQUENTIAL_TOOLS = new Set([
	"drr_cap_publish",
	"drr_delta_push_draft_record",
]);

const REVERSIBLE_TOOLS = new Set([
	"drr_cap_alert_generate_validate",
	"drr_geometry_repair",
	"drr_monitor_check",
]);

const PRIVILEGED_ROLES = new Set(["EOC_DUTY_OFFICER", "ADMIN", "FOCAL_POINT"]);

/**
 * Classify an MCP tool by its operational impact tier.
 * @param {string} toolName
 * @returns {"read_only" | "reversible" | "consequential"}
 */
function classifyToolActionTier(toolName) {
	if (CONSEQUENTIAL_TOOLS.has(toolName)) return "consequential";
	if (REVERSIBLE_TOOLS.has(toolName)) return "reversible";
	return "read_only";
}

/**
 * Build operational context with explicit staleness & authorization checks.
 * Never silently turns outdated context into current facts.
 */
function buildOperationalContext(overrides = {}) {
	const nowMs = Number.isFinite(overrides.nowMs) ? overrides.nowMs : Date.now();
	const role = String(overrides.role || process.env.DRR_USER_ROLE || "ANALYST").trim().toUpperCase();
	const stalenessThresholdHours = Number.isFinite(Number(overrides.stalenessThresholdHours))
		? Number(overrides.stalenessThresholdHours)
		: 24;

	const contextTimestamp = overrides.contextTimestamp || new Date(nowMs).toISOString();
	const parsedTs = Date.parse(contextTimestamp);
	const ageHours = Number.isFinite(parsedTs) ? Math.max(0, (nowMs - parsedTs) / 3600000) : null;
	const stalenessWarning = ageHours !== null && ageHours > stalenessThresholdHours;

	const targetCountries = Array.isArray(overrides.targetCountries)
		? overrides.targetCountries
		: Array.isArray(CONFIG.TARGET_COUNTRIES)
			? CONFIG.TARGET_COUNTRIES
			: ["*"];

	const country =
		overrides.country ||
		CONFIG.DELTA_COUNTRY ||
		(targetCountries.length === 1 && targetCountries[0] !== "*" ? targetCountries[0] : null);

	const productionPublishEnabled = Boolean(CONFIG.ENABLE_PRODUCTION_PUBLISH);
	const canExecuteConsequential = productionPublishEnabled && PRIVILEGED_ROLES.has(role);

	return {
		role,
		country,
		targetCountries,
		municipality: overrides.municipality || null,
		coordinates: Array.isArray(overrides.coordinates) ? overrides.coordinates : null,
		bbox: overrides.bbox || null,
		timeWindow: overrides.timeWindow || null,
		offlineMode: Boolean(CONFIG.DRR_OFFLINE_MODE),
		productionPublishEnabled,
		canExecuteConsequential,
		contextTimestamp,
		stalenessThresholdHours,
		ageHours: ageHours !== null ? parseFloat(ageHours.toFixed(2)) : null,
		stalenessWarning,
	};
}

const WORKFLOW_CATALOG = [
	{
		id: "flood_infra_risk_assessment",
		title: "Flood Risk to Critical Infrastructure Assessment",
		objective: "Assess flood hazard, hydrological conditions, and potentially exposed critical infrastructure for a target municipality.",
		requiredContext: ["location"],
		requiredInputs: ["latitude_longitude_or_bbox"],
		humanApprovalRequired: true,
		approvalReason: "Generating or publishing any resulting CAP advisory requires human review (Draft by default).",
		steps: [
			{ stepId: "weather_forecast", tool: "drr_openmeteo_forecast", dependsOn: [], validationRule: "Verify rainfall forecast without fabricating inundation depth (depthStatus: depth_unavailable)." },
			{ stepId: "hydro_glofas", tool: "drr_adam_fetch", dependsOn: [], validationRule: "Query collection='glofas' with compact=true; preserve null for -9999.0 sentinels." },
			{ stepId: "river_discharge", tool: "drr_river_discharge_screen", dependsOn: ["hydro_glofas"], validationRule: "Screen discharge series against catchment thresholds if daily series is available." },
			{ stepId: "critical_infra", tool: "drr_osm_critical_infra_fetch", dependsOn: [], validationRule: "Retrieve Sendai Target D critical infrastructure inside target bbox/radius (or use drr_critical_infra_overlay)." },
			{ stepId: "spatial_join", tool: "drr_spatial_exposure_join", dependsOn: ["critical_infra", "river_discharge"], validationRule: "Perform deterministic point-in-polygon / geodesic buffer exposure join." },
			{ stepId: "draft_cap", tool: "drr_cap_alert_generate_validate", dependsOn: ["spatial_join"], validationRule: "Keep status='Draft'; never auto-publish live alerts." },
		],
	},
	{
		id: "earthquake_rapid_impact",
		title: "Rapid Earthquake Impact & Sendai Screening",
		objective: "Retrieve seismic telemetry, convert ground motion (or ingest ShakeMap), evaluate structural fragility, and compute Sendai exposure.",
		requiredContext: ["location"],
		requiredInputs: ["earthquake_event_or_region"],
		humanApprovalRequired: true,
		approvalReason: "Draft CAP alerts and DELTA draft records require Duty Officer / Focal Point review.",
		steps: [
			{ stepId: "usgs_events", tool: "drr_usgs_earthquake_fetch", dependsOn: [], validationRule: "Use compact=true; flag extrapolated=true if MMI is outside [V, VIII]." },
			{ stepId: "adam_eq_buffers", tool: "drr_adam_fetch", dependsOn: [], validationRule: "Query collection='eq' with compact=true for WFP concentric buffer population estimates." },
			{ stepId: "event_dedup", tool: "drr_event_match_deduplicate", dependsOn: ["usgs_events", "adam_eq_buffers"], validationRule: "Deduplicate multi-source events without auto-merging uncertain cross-source matches." },
			{ stepId: "fragility_eval", tool: "drr_fragility_eval", dependsOn: ["event_dedup"], validationRule: "Require explicit intensity unit (g); mark illustrative_baseline curves as non-production." },
			{ stepId: "sendai_validate", tool: "drr_sendai_validate", dependsOn: ["fragility_eval"], validationRule: "Keep modelled displacement separate from Sendai B-1 directly affected." },
		],
	},
	{
		id: "cyclone_early_warning_brief",
		title: "Tropical Cyclone Early Warning & Exposure Brief",
		objective: "Ingest active cyclone wind buffers and GDACS alerts, estimate exposed population/infrastructure, and prepare a Draft CAP brief.",
		requiredContext: ["location"],
		requiredInputs: ["cyclone_event_or_region"],
		humanApprovalRequired: true,
		approvalReason: "CAP publication is consequential and gated by DRR_ENABLE_PRODUCTION_PUBLISH and signed approvalToken.",
		steps: [
			{ stepId: "gdacs_alerts", tool: "drr_gdacs_fetch", dependsOn: [], validationRule: "Pass compact=true and check untrustedFeedSecurity.injectionDetected." },
			{ stepId: "adam_ts_buffers", tool: "drr_adam_fetch", dependsOn: [], validationRule: "Query collection='ts_buffers' or 'ts' for WFP wind swath polygons and buffer population." },
			{ stepId: "spatial_exposure", tool: "drr_spatial_exposure_join", dependsOn: ["adam_ts_buffers"], validationRule: "Intersect wind buffer polygons with exposed facilities/population." },
			{ stepId: "draft_cap", tool: "drr_cap_alert_generate_validate", dependsOn: ["spatial_exposure"], validationRule: "Generate Draft OASIS CAP v1.2 XML for Duty Officer review." },
		],
	},
	{
		id: "multi_source_sitrep_reconcile",
		title: "Multi-Source Impact Reconciliation & SitRep Diff",
		objective: "Reconcile conflicting agency/cluster impact figures without silently collapsing numbers, and diff SitRep revisions.",
		requiredContext: [],
		requiredInputs: ["claims_or_sitrep_versions"],
		humanApprovalRequired: false,
		approvalReason: "Read-only analytical reconciliation; human analysts review preserved conflicts.",
		steps: [
			{ stepId: "reconcile", tool: "drr_sitrep_reconcile", dependsOn: [], validationRule: "Preserve conflicting claims with provenance rather than averaging silently." },
			{ stepId: "severity", tool: "drr_humanitarian_severity_assess", dependsOn: ["reconcile"], validationRule: "Block hazard-only severity; require exposure/vulnerability pillars." },
		],
	},
	{
		id: "anticipatory_action_trigger_check",
		title: "Anticipatory Action (FbF) Trigger Verification",
		objective: "Evaluate multi-day rainfall and GloFAS river discharge against an organization-approved FbF trigger policy.",
		requiredContext: ["location"],
		requiredInputs: ["latitude_longitude_or_bbox", "trigger_policy"],
		humanApprovalRequired: true,
		approvalReason: "Activating FbF funds or issuing advisories requires an explicitly approved triggerPolicy.",
		steps: [
			{ stepId: "forecast", tool: "drr_openmeteo_forecast", dependsOn: [], validationRule: "Require triggerPolicy.approved===true for activation; never fabricate flood depth." },
			{ stepId: "discharge", tool: "drr_river_discharge_screen", dependsOn: ["forecast"], validationRule: "Verify persistence across forecast runs when required by policy." },
			{ stepId: "provenance", tool: "drr_source_provenance_manifest", dependsOn: ["discharge"], validationRule: "Emit SHA-256 provenance manifest for auditability." },
		],
	},
];

function inferWorkflowId(goal = "") {
	const text = String(goal || "").toLowerCase();
	if (text.includes("reconcil") || text.includes("conflict") || text.includes("sitrep diff")) {
		return "multi_source_sitrep_reconcile";
	}
	if (text.includes("anticipatory") || text.includes("fbf") || text.includes("trigger")) {
		return "anticipatory_action_trigger_check";
	}
	if (text.includes("cyclone") || text.includes("typhoon") || text.includes("hurricane") || text.includes("storm")) {
		return "cyclone_early_warning_brief";
	}
	if (text.includes("earthquake") || text.includes("seismic") || text.includes("shakemap") || text.includes("pga")) {
		return "earthquake_rapid_impact";
	}
	return "flood_infra_risk_assessment";
}

/**
 * Plan a goal-oriented DRR workflow with clarification questions and action-tier gates.
 */
function planGoalWorkflow({ goal = "", workflowId = null, context = {}, availableInputs = {}, nowMs = undefined } = {}) {
	const resolvedId = workflowId || inferWorkflowId(goal);
	const wf = WORKFLOW_CATALOG.find((w) => w.id === resolvedId);
	if (!wf) {
		throw new Error(`Unknown workflowId "${resolvedId}". Valid workflows: ${WORKFLOW_CATALOG.map((w) => w.id).join(", ")}`);
	}

	const operationalContext = buildOperationalContext({ ...context, nowMs });
	const hasLocation = Boolean(
		operationalContext.municipality ||
		operationalContext.coordinates ||
		operationalContext.bbox ||
		availableInputs.latitude !== undefined ||
		availableInputs.bbox ||
		availableInputs.municipality ||
		availableInputs.hazardGeoJSON,
	);
	const hasCountry = Boolean(operationalContext.country || availableInputs.country || availableInputs.iso3);

	const missingInputs = [];
	const clarificationQuestions = [];

	if (wf.requiredContext.includes("location") && !hasLocation) {
		missingInputs.push("municipality_or_coordinates_or_bbox");
		clarificationQuestions.push({
			field: "location",
			question: hasCountry
				? `Which municipality, coordinates (lat/lon), or bounding box in ${operationalContext.country} should be assessed?`
				: "Which municipality, country, coordinates (lat/lon), or bounding box should be assessed?",
			reason: "Spatial and meteorological/hydrological tools require a target geography.",
		});
	}

	if (wf.requiredInputs.includes("trigger_policy") && !availableInputs.triggerPolicy) {
		missingInputs.push("triggerPolicy");
		clarificationQuestions.push({
			field: "triggerPolicy",
			question: "Please provide the organization-approved FbF triggerPolicy ({ policyId, approved, thresholds }) or confirm screening-only mode.",
			reason: "Anticipatory action trigger activation cannot proceed without an approved trigger policy.",
		});
	}

	if (wf.requiredInputs.includes("claims_or_sitrep_versions") && !availableInputs.claims && !availableInputs.currentSitRep) {
		missingInputs.push("claims_or_sitrep_versions");
		clarificationQuestions.push({
			field: "claims_or_sitrep_versions",
			question: "Please supply the conflicting impact claims[] or previousSitRep/currentSitRep payloads to reconcile.",
			reason: "Reconciliation requires at least one multi-source claim set or two SitRep versions.",
		});
	}

	const steps = wf.steps.map((s) => {
		const actionTier = classifyToolActionTier(s.tool);
		const needsLocation =
			["drr_openmeteo_forecast", "drr_osm_critical_infra_fetch", "drr_spatial_exposure_join"].includes(s.tool) &&
			!hasLocation;
		let status = "ready";
		if (actionTier === "consequential" && !operationalContext.canExecuteConsequential) {
			status = "requires_approval";
		} else if (needsLocation || missingInputs.includes("claims_or_sitrep_versions")) {
			status = "needs_input";
		}
		return {
			...s,
			actionTier,
			status,
		};
	});

	return {
		workflowId: wf.id,
		title: wf.title,
		objective: wf.objective,
		requestedGoal: goal || wf.objective,
		operationalContext,
		missingInputs,
		clarificationNeeded: clarificationQuestions.length > 0,
		clarificationQuestions,
		humanApprovalRequired: wf.humanApprovalRequired,
		approvalReason: wf.approvalReason,
		steps,
		dataIntegrityRules: [
			"Preserve original source, timestamps, and SHA-256 payloadHash.",
			"Distinguish observed, reported, estimated, and modelled values.",
			"Keep missing numeric values as null (never substitute 0).",
			"Never fabricate flood inundation depth from rainfall totals alone.",
		],
		presentationTemplate: {
			sections: [
				"Observed & Reported Facts (with sources & timestamps)",
				"Deterministic Analytical Results (with methodId & units)",
				"Data Gaps, Staleness & Uncertainty",
				"Interpretation & Recommended Next Steps",
			],
		},
	};
}

module.exports = {
	WORKFLOW_CATALOG,
	classifyToolActionTier,
	buildOperationalContext,
	inferWorkflowId,
	planGoalWorkflow,
};
