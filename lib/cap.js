/**
 * OASIS Common Alerting Protocol (CAP) v1.2 / ITU-T X.1303 Generator and Validator
 * Produces compliant XML alerts and synthesizes multi-agency emergency briefs.
 */

const CAP_XMLNS = "urn:oasis:names:tc:emergency:cap:1.2";

const VALID_STATUSES = ["Actual", "Exercise", "System", "Test", "Draft"];
const VALID_MSG_TYPES = ["Alert", "Update", "Cancel", "Ack", "Error"];
const VALID_SCOPES = ["Public", "Restricted", "Private"];
const VALID_CATEGORIES = [
	"Geo",
	"Met",
	"Safety",
	"Security",
	"Rescue",
	"Fire",
	"Health",
	"Env",
	"Transport",
	"Infra",
	"CBRNE",
	"Other",
];
const VALID_URGENCIES = ["Immediate", "Expected", "Future", "Past", "Unknown"];
const VALID_SEVERITIES = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"];
const VALID_CERTAINTIES = ["Observed", "Likely", "Possible", "Unlikely", "Unknown"];

/**
 * Escape XML special characters
 */
function escapeXml(unsafe) {
	if (unsafe == null) return "";
	return String(unsafe)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Convert GeoJSON coordinates or lat/lon ring to CAP polygon format: "lat,lon lat,lon ..."
 * Note: CAP specification requires latitude first, then longitude!
 * @param {Array<[number, number]>} coords - [[lon, lat], [lon, lat], ...]
 * @returns {string} CAP polygon string
 */
function geojsonToCapPolygon(coords) {
	if (!Array.isArray(coords) || coords.length === 0) return "";
	return coords.map((c) => `${c[1].toFixed(5)},${c[0].toFixed(5)}`).join(" ");
}

/**
 * Generate an OASIS CAP v1.2 XML Document
 * @param {object} params - Alert parameters
 * @returns {string} CAP XML string
 */
function generateCapXml(params = {}) {
	const identifier = params.identifier || `DELTA-CAP-${Date.now()}`;
	const sender = params.sender || "alerts@delta.preventionweb.net";
	const sent = params.sent || new Date().toISOString();
	const status = params.status || "Actual";
	const msgType = params.msgType || "Alert";
	const scope = params.scope || "Public";

	const info = params.info || {};
	const category = info.category || "Geo";
	const event = info.event || "Disaster Emergency Alert";
	const urgency = info.urgency || "Immediate";
	const severity = info.severity || "Severe";
	const certainty = info.certainty || "Observed";
	const headline = info.headline || `${severity} ${event}`;
	const description = info.description || "Disaster alert issued for affected region.";
	const instruction = info.instruction || "Follow national civil protection evacuation directives immediately.";
	const areaDesc = info.areaDesc || "Affected Geographic Region";
	const polygon = info.polygon || (info.coordinates ? geojsonToCapPolygon(info.coordinates) : "");
	const circle = info.circle || ""; // "lat,lon radius"

	let areaXml = `      <area>\n        <areaDesc>${escapeXml(areaDesc)}</areaDesc>\n`;
	if (polygon) {
		areaXml += `        <polygon>${escapeXml(polygon)}</polygon>\n`;
	}
	if (circle) {
		areaXml += `        <circle>${escapeXml(circle)}</circle>\n`;
	}
	areaXml += `      </area>`;

	return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="${CAP_XMLNS}">
  <identifier>${escapeXml(identifier)}</identifier>
  <sender>${escapeXml(sender)}</sender>
  <sent>${escapeXml(sent)}</sent>
  <status>${escapeXml(status)}</status>
  <msgType>${escapeXml(msgType)}</msgType>
  <scope>${escapeXml(scope)}</scope>
  <info>
    <category>${escapeXml(category)}</category>
    <event>${escapeXml(event)}</event>
    <urgency>${escapeXml(urgency)}</urgency>
    <severity>${escapeXml(severity)}</severity>
    <certainty>${escapeXml(certainty)}</certainty>
    <headline>${escapeXml(headline)}</headline>
    <description>${escapeXml(description)}</description>
    <instruction>${escapeXml(instruction)}</instruction>
${areaXml}
  </info>
</alert>`;
}

/**
 * Validate a CAP XML string against OASIS CAP v1.2 specification requirements
 * @param {string} xmlString 
 * @returns {object} { isValid: boolean, errors: string[], warnings: string[] }
 */
function validateCapXml(xmlString) {
	const errors = [];
	const warnings = [];

	if (!xmlString || typeof xmlString !== "string") {
		return { isValid: false, errors: ["Missing or empty XML string"], warnings };
	}

	// 1. Check Namespace
	if (!xmlString.includes(CAP_XMLNS)) {
		errors.push(`Missing mandatory CAP v1.2 xmlns declaration: '${CAP_XMLNS}'`);
	}

	// 2. Helper to extract element value
	function getTag(tag) {
		const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
		const match = xmlString.match(regex);
		return match ? match[1].trim() : null;
	}

	// Mandatory Alert-level tags
	const requiredAlertTags = ["identifier", "sender", "sent", "status", "msgType", "scope"];
	for (const tag of requiredAlertTags) {
		const val = getTag(tag);
		if (!val) {
			errors.push(`Missing mandatory element <${tag}>`);
		}
	}

	const status = getTag("status");
	if (status && !VALID_STATUSES.includes(status)) {
		errors.push(`Invalid <status>: '${status}'. Must be one of: ${VALID_STATUSES.join(", ")}`);
	}

	const msgType = getTag("msgType");
	if (msgType && !VALID_MSG_TYPES.includes(msgType)) {
		errors.push(`Invalid <msgType>: '${msgType}'. Must be one of: ${VALID_MSG_TYPES.join(", ")}`);
	}

	const scope = getTag("scope");
	if (scope && !VALID_SCOPES.includes(scope)) {
		errors.push(`Invalid <scope>: '${scope}'. Must be one of: ${VALID_SCOPES.join(", ")}`);
	}

	// If <info> is present, check mandatory info tags
	if (xmlString.includes("<info>")) {
		const requiredInfoTags = ["category", "event", "urgency", "severity", "certainty", "headline"];
		for (const tag of requiredInfoTags) {
			const val = getTag(tag);
			if (!val) errors.push(`Missing mandatory <info> child element: <${tag}>`);
		}

		const category = getTag("category");
		if (category && !VALID_CATEGORIES.includes(category)) {
			errors.push(`Invalid <category>: '${category}'. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
		}

		const urgency = getTag("urgency");
		if (urgency && !VALID_URGENCIES.includes(urgency)) {
			errors.push(`Invalid <urgency>: '${urgency}'. Must be one of: ${VALID_URGENCIES.join(", ")}`);
		}

		const severity = getTag("severity");
		if (severity && !VALID_SEVERITIES.includes(severity)) {
			errors.push(`Invalid <severity>: '${severity}'. Must be one of: ${VALID_SEVERITIES.join(", ")}`);
		}

		const certainty = getTag("certainty");
		if (certainty && !VALID_CERTAINTIES.includes(certainty)) {
			errors.push(`Invalid <certainty>: '${certainty}'. Must be one of: ${VALID_CERTAINTIES.join(", ")}`);
		}

		// Area validation
		if (!xmlString.includes("<area>") || !getTag("areaDesc")) {
			warnings.push("Notice: <info> block has no <area> with <areaDesc>; geographic targeting is advised.");
		}
	}

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Generate a comprehensive Emergency Situation Brief in Markdown
 * @param {object} context - Analysis report (hazard, spatial report, vulnerability report)
 * @returns {string} Markdown document
 */
function generateEmergencyBrief(context = {}) {
	const hazard = context.hazard || {};
	const spatial = context.spatial?.summary || {};
	const vulnerability = context.vulnerability || {};
	const sendai = vulnerability.sendaiFrameworkMetrics || {};

	return `# Emergency Situation Brief: ${hazard.eventName || hazard.hazardType || "Disaster Event"}
**Alert Level:** ${hazard.alertLevel || "Orange / Severe"} | **Issued:** ${new Date().toUTCString()}  
**Target Region:** ${hazard.country || "Affected Zone"} | **Certainty:** Observed  

---

## 1. Executive Summary
A major **${hazard.eventTypeLabel || hazard.hazardType || "hazardous"}** event occurred with estimated intensity of **${hazard.hazardIntensity || "High"}**. Immediate spatial analysis indicates an exposed population of **${(spatial.totalExposedPopulation || 0).toLocaleString()}** people across the hazard impact footprint.

## 2. Priority Impact Estimates (Sendai Framework Metrics)
* **Target B (Affected Population):**
  * Total Exposed Population: **${(spatial.totalExposedPopulation || 0).toLocaleString()}**
  * Estimated Displaced Persons: **${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()}**
* **Target C (Direct Economic Loss):**
  * Exposed Asset Valuation: **\$${(spatial.totalExposedAssetValueUsd || 0).toLocaleString()} USD**
  * Estimated Direct Physical Loss: **\$${(sendai.targetC_DirectEconomicLoss?.estimatedDirectEconomicLossUsd || 0).toLocaleString()} USD**
  * Aggregate Loss Ratio: **${sendai.targetC_DirectEconomicLoss?.aggregateLossRatioPercentage || 0}%**
* **Target D (Critical Infrastructure Disruption):**
  * Damaged Healthcare / Education / Vital Facilities: **${sendai.targetD_CriticalInfrastructure?.totalDamagedFacilities || 0} facilities**

## 3. High-Risk Asset Breakdown
${
	vulnerability.topDamagedAssets && vulnerability.topDamagedAssets.length > 0
		? vulnerability.topDamagedAssets
				.slice(0, 5)
				.map(
					(a) =>
						`* **${a.name}** (${a.category}): Mean Damage Ratio **${(a.meanDamageRatio * 100).toFixed(1)}%**, Est. Loss: \$${a.estimatedEconomicLossUsd.toLocaleString()} USD`,
				)
				.join("\n")
		: "* No high-risk asset damage thresholds exceeded."
}

## 4. Recommended Emergency Operations Actions
1. **Evacuation & Life Safety**: Activate civil defense reception centers for approximately **${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()}** displaced individuals.
2. **Critical Infrastructure Support**: Deploy secondary generators and structural assessment teams to impacted medical and transit facilities.
3. **Public Warning**: Disseminate OASIS CAP alerts through national broadcasting and telecom networks.
`;
}

module.exports = {
	CAP_XMLNS,
	VALID_STATUSES,
	VALID_MSG_TYPES,
	VALID_SCOPES,
	VALID_CATEGORIES,
	VALID_URGENCIES,
	VALID_SEVERITIES,
	VALID_CERTAINTIES,
	geojsonToCapPolygon,
	generateCapXml,
	validateCapXml,
	generateEmergencyBrief,
};
