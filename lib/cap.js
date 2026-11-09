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
 * Generate a comprehensive Emergency Situation Brief in Markdown with visual status indicators
 * @param {object} context - Analysis report (hazard, spatial report, vulnerability report)
 * @returns {string} Markdown document
 */
function generateEmergencyBrief(context = {}) {
	const hazard = context.hazard || {};
	const vulnerability = context.vulnerability || {};
	const sendai = vulnerability.sendaiFrameworkMetrics || {};
	const spatialSummary = context.spatial?.summary || context.spatial || {};

	const totalExposedPop = spatialSummary.totalExposedPopulation 
		?? sendai.targetB_AffectedPeople?.totalExposedPopulation 
		?? 0;
	const totalExposedValue = spatialSummary.totalExposedAssetValueUsd 
		?? sendai.targetC_DirectEconomicLoss?.totalExposedAssetValueUsd 
		?? 0;

	const hazardType = hazard.hazardType || hazard.eventTypeLabel || vulnerability.hazardAssessment?.hazardType || "flood";
	const alertLevel = (hazard.alertLevel || "Orange").toUpperCase();
	const badgeColor = alertLevel.includes("RED") ? "🔴" : alertLevel.includes("ORANGE") ? "🟠" : "🟢";

	const intensity = hazard.hazardIntensity || vulnerability.hazardAssessment?.hazardIntensity || "High";
	const unit = vulnerability.hazardAssessment?.intensityUnit;
	const intensityDisplay = (typeof intensity === "number" && unit) ? `${intensity} ${unit}` : `${intensity}`;

	return `# ${badgeColor} Emergency Situation Brief: ${hazard.eventName || (hazardType.charAt(0).toUpperCase() + hazardType.slice(1) + " Event")}
**Alert Level:** \`[${alertLevel}]\` | **Issued:** ${new Date().toUTCString()}  
**Target Region:** **${hazard.country || "Affected Zone"}** | **Certainty:** Observed  

---

## 1. Executive Summary
A major **${hazard.eventTypeLabel || hazardType}** event occurred with estimated intensity of **${intensityDisplay}**. Immediate spatial analysis indicates an exposed population of **${totalExposedPop.toLocaleString()}** people across the hazard impact footprint.

| Indicator | Impact Value | Operational Severity |
| :--- | :--- | :--- |
| **Hazard Intensity** | ${intensityDisplay} | ${alertLevel} |
| **Exposed Population** | ${totalExposedPop.toLocaleString()} people | ${totalExposedPop > 10000 ? "HIGH EXPOSURE" : "MODERATE"} |
| **Est. Displaced (Sendai B)** | ${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()} persons | Immediate shelter required |
| **Direct Physical Loss (Sendai C)** | \$${(sendai.targetC_DirectEconomicLoss?.estimatedDirectEconomicLossUsd || 0).toLocaleString()} USD | Loss Ratio: ${sendai.targetC_DirectEconomicLoss?.aggregateLossRatioPercentage || 0}% |
| **Damaged Critical Infra (Sendai D)** | ${sendai.targetD_CriticalInfrastructure?.totalDamagedFacilities || 0} facilities | Healthcare / Education / Vital |

---

## 2. Priority Impact Estimates (Sendai Framework Metrics)
* **Target B (Affected Population):**
  * Total Exposed Population: **${totalExposedPop.toLocaleString()}**
  * Estimated Displaced Persons: **${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()}**
* **Target C (Direct Economic Loss):**
  * Exposed Asset Valuation: **\$${totalExposedValue.toLocaleString()} USD**
  * Estimated Direct Physical Loss: **\$${(sendai.targetC_DirectEconomicLoss?.estimatedDirectEconomicLossUsd || 0).toLocaleString()} USD**
  * Aggregate Loss Ratio: **${sendai.targetC_DirectEconomicLoss?.aggregateLossRatioPercentage || 0}%**
* **Target D (Critical Infrastructure Disruption):**
  * Damaged Healthcare / Education / Vital Facilities: **${sendai.targetD_CriticalInfrastructure?.totalDamagedFacilities || 0} facilities**

---

## 3. High-Risk Asset Breakdown
${
	vulnerability.topDamagedAssets && vulnerability.topDamagedAssets.length > 0
		? vulnerability.topDamagedAssets
				.slice(0, 5)
				.map(
					(a) =>
						`* **${a.name}** (\`${a.category}\`): Mean Damage Ratio **${(a.meanDamageRatio * 100).toFixed(1)}%**, Est. Loss: **\$${a.estimatedEconomicLossUsd.toLocaleString()} USD**`,
				)
				.join("\n")
		: "* No high-risk asset damage thresholds exceeded."
}

---

## 4. Recommended Emergency Operations Actions
1. **Evacuation & Life Safety**: Activate civil defense reception centers for approximately **${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()}** displaced individuals.
2. **Critical Infrastructure Support**: Deploy secondary generators and structural assessment teams to impacted medical and transit facilities.
3. **Public Warning**: Disseminate OASIS CAP alerts through national broadcasting and telecom networks.
`;
}

/**
 * Generate a standalone, visual HTML Emergency Situation Report (SitRep)
 * Formatted for both digital viewing and high-resolution print / PDF export.
 * @param {object} context - Analysis report
 * @returns {string} Standalone HTML document
 */
function generateVisualSitRepHtml(context = {}) {
	const hazard = context.hazard || {};
	const vulnerability = context.vulnerability || {};
	const sendai = vulnerability.sendaiFrameworkMetrics || {};
	const spatialSummary = context.spatial?.summary || context.spatial || {};

	const totalExposedPop = spatialSummary.totalExposedPopulation 
		?? sendai.targetB_AffectedPeople?.totalExposedPopulation 
		?? 0;
	const totalExposedValue = spatialSummary.totalExposedAssetValueUsd 
		?? sendai.targetC_DirectEconomicLoss?.totalExposedAssetValueUsd 
		?? 0;

	const alertLevel = (hazard.alertLevel || "Orange").toUpperCase();
	const hazardType = hazard.hazardType || hazard.eventTypeLabel || vulnerability.hazardAssessment?.hazardType || "flood";
	const eventName = hazard.eventName || `${hazardType.charAt(0).toUpperCase() + hazardType.slice(1)} Event`;
	const region = hazard.country || hazard.place || "Affected Region";
	const timestamp = new Date().toUTCString();

	const intensity = hazard.hazardIntensity || vulnerability.hazardAssessment?.hazardIntensity || "High";
	const unit = vulnerability.hazardAssessment?.intensityUnit;
	const intensityDisplay = (typeof intensity === "number" && unit) ? `${intensity} ${unit}` : `${intensity}`;

	const isRed = alertLevel.includes("RED");
	const isOrange = alertLevel.includes("ORANGE");
	const bannerBg = isRed ? "#dc2626" : isOrange ? "#ea580c" : "#16a34a";
	const tagBg = isRed ? "rgba(239, 68, 68, 0.15)" : isOrange ? "rgba(249, 115, 22, 0.15)" : "rgba(34, 197, 94, 0.15)";
	const tagColor = isRed ? "#f87171" : isOrange ? "#fb923c" : "#4ade80";

	const topAssetsRows = (vulnerability.topDamagedAssets && vulnerability.topDamagedAssets.length > 0)
		? vulnerability.topDamagedAssets.slice(0, 8).map((a, i) => `
			<tr id="asset-row-${i}" class="sitrep-asset-row" data-asset-index="${i}" style="border-bottom: 1px solid #334155;">
				<td class="asset-name" style="padding: 9px 12px; font-weight: 600; color: #f8fafc;">${a.name}</td>
				<td style="padding: 9px 12px; text-transform: uppercase; font-size: 11px;"><span class="asset-category-pill" style="background: #1e293b; padding: 2px 8px; border-radius: 4px; border: 1px solid #334155; color: #94a3b8;">${a.category}</span></td>
				<td class="mdr-cell" style="padding: 9px 12px; text-align: right; color: #f8fafc;">
					<div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
						<span class="mdr-val" style="font-weight: 600;">${(a.meanDamageRatio * 100).toFixed(1)}%</span>
						<div class="mdr-bar-bg" style="width: 55px; height: 6px; background: #334155; border-radius: 3px; overflow: hidden;">
							<div style="width: ${(a.meanDamageRatio * 100).toFixed(1)}%; height: 100%; background: ${a.meanDamageRatio > 0.5 ? '#ef4444' : '#f59e0b'};"></div>
						</div>
					</div>
				</td>
				<td class="loss-value" style="padding: 9px 12px; text-align: right; font-weight: 600; color: #38bdf8;">$${(a.estimatedEconomicLossUsd || 0).toLocaleString()}</td>
			</tr>
		`).join("")
		: `<tr><td colspan="4" style="padding: 16px; text-align: center; color: #94a3b8;">No high-risk asset damage thresholds exceeded.</td></tr>`;

	// Prepare GeoJSON asset points for embedded offline GIS Map
	const rawAssets = context.spatial?.intersectedAssets || context.spatial?.exposedAssets || vulnerability.topDamagedAssets || [];
	const mapAssets = rawAssets.slice(0, 10).map((a, i) => {
		const coords = a.coordinates || a.geometry?.coordinates || a.coords || [
			85.32 + (i * 0.015 - 0.02),
			27.71 + (i * 0.012 - 0.015)
		];
		return {
			id: a.id || `asset_${i}`,
			name: a.name || `Facility #${i + 1}`,
			category: a.category || "infrastructure",
			coords: [coords[0], coords[1]],
			mdr: a.meanDamageRatio || 0.35,
			lossUsd: a.estimatedEconomicLossUsd || a.valueUsd || 0,
			population: a.population || a.properties?.population || 0,
			facilityCode: a.properties?.facilityCode || a.properties?.facilityCodeMOPH || a.properties?.facilityCodePEA || a.properties?.bridgeCodeDOH || a.id || ""
		};
	});

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Emergency Situation Report: ${eventName}</title>
	<style>
		/* Accessibility: Screen-reader only utility */
		.sr-only {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
			border-width: 0;
		}
		.print-only {
			display: none;
		}

		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
			background-color: #0b1120;
			color: #f1f5f9;
			margin: 0;
			padding: 24px;
			line-height: 1.5;
		}
		.container {
			max-width: 960px;
			margin: 0 auto;
		}
		.header {
			background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
			border: 1px solid #334155;
			border-radius: 12px;
			padding: 24px;
			margin-bottom: 24px;
			position: relative;
			overflow: hidden;
		}
		.header-badge {
			display: inline-block;
			padding: 4px 12px;
			border-radius: 9999px;
			font-size: 12px;
			font-weight: 700;
			letter-spacing: 0.05em;
			text-transform: uppercase;
			background: ${tagBg};
			color: ${tagColor};
			border: 1px solid ${tagColor};
			margin-bottom: 12px;
		}
		.grid-3 {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 16px;
			margin-bottom: 24px;
		}
		.card {
			background: #1e293b;
			border: 1px solid #334155;
			border-radius: 10px;
			padding: 20px;
		}
		.card-title {
			font-size: 12px;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: #94a3b8;
			margin: 0 0 8px 0;
			font-weight: 600;
		}
		.card-value {
			font-size: 28px;
			font-weight: 800;
			color: #f8fafc;
			margin: 0;
		}
		.card-subtext {
			font-size: 12px;
			color: #94a3b8;
			margin-top: 6px;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			font-size: 13px;
		}
		th {
			background: #0f172a;
			color: #94a3b8;
			padding: 10px 12px;
			text-align: left;
			font-weight: 600;
			border-bottom: 2px solid #334155;
		}
		.sitrep-asset-row {
			cursor: pointer;
			transition: background-color 0.15s ease, outline 0.15s ease;
		}
		.sitrep-asset-row:hover, .sitrep-asset-row.active {
			background-color: rgba(56, 189, 248, 0.15) !important;
			outline: 1px solid rgba(56, 189, 248, 0.4);
		}
		.checklist {
			list-style: none;
			padding: 0;
			margin: 0;
		}
		.checklist li {
			padding: 10px 0;
			border-bottom: 1px solid #334155;
			display: flex;
			align-items: flex-start;
			gap: 12px;
			font-size: 13px;
		}
		.check-icon {
			color: #38bdf8;
			font-weight: bold;
		}
		.btn {
			background: #0284c7;
			color: white;
			border: none;
			padding: 8px 16px;
			border-radius: 6px;
			font-weight: 600;
			font-size: 12px;
			cursor: pointer;
		}

		/* High-Contrast Print & PDF Optimization */
		@media print {
			@page {
				size: A4 portrait;
				margin: 10mm 12mm 10mm 12mm;
			}
			*, *:before, *:after {
				-webkit-print-color-adjust: exact !important;
				print-color-adjust: exact !important;
				color-adjust: exact !important;
			}
			body {
				background: #ffffff !important;
				color: #0f172a !important;
				padding: 0 !important;
				font-size: 10.5pt !important;
				line-height: 1.35 !important;
			}
			.container {
				max-width: 100% !important;
				width: 100% !important;
				padding: 0 !important;
				margin: 0 !important;
			}
			.no-print {
				display: none !important;
			}
			.print-only {
				display: inline-block !important;
			}

			/* Header Card */
			.header {
				background: #f8fafc !important;
				border: 1.5px solid #cbd5e1 !important;
				border-radius: 8px !important;
				padding: 14px 18px !important;
				margin-bottom: 12px !important;
				page-break-inside: avoid !important;
				break-inside: avoid !important;
			}
			.header h1 {
				color: #0f172a !important;
				font-size: 20px !important;
				font-weight: 800 !important;
				margin: 0 0 6px 0 !important;
			}
			.header-badge {
				background: #fef2f2 !important;
				color: #991b1b !important;
				border: 1.5px solid #dc2626 !important;
				font-weight: 800 !important;
				font-size: 11px !important;
				padding: 2px 10px !important;
				margin-bottom: 6px !important;
			}
			.header-meta {
				color: #334155 !important;
				font-size: 11px !important;
			}
			.header-meta strong {
				color: #0f172a !important;
			}

			/* Sendai Metrics Grid - 3 cards in 1 row */
			.grid-3 {
				display: grid !important;
				grid-template-columns: repeat(3, 1fr) !important;
				gap: 10px !important;
				margin-bottom: 12px !important;
				page-break-inside: avoid !important;
				break-inside: avoid !important;
			}
			.card {
				border: 1px solid #cbd5e1 !important;
				background: #ffffff !important;
				box-shadow: none !important;
				border-radius: 8px !important;
				padding: 12px 14px !important;
				page-break-inside: avoid !important;
				break-inside: avoid !important;
			}
			.card-title {
				color: #475569 !important;
				font-size: 10.5px !important;
				font-weight: 700 !important;
				margin: 0 0 4px 0 !important;
			}
			.card-value {
				color: #0f172a !important;
				font-size: 22px !important;
				font-weight: 800 !important;
			}
			.card-subtext {
				color: #334155 !important;
				font-size: 10.5px !important;
				margin-top: 4px !important;
			}
			.card-subtext strong {
				color: #0f172a !important;
			}

			/* Map Card (Page 1) */
			.map-card {
				margin-bottom: 0 !important;
				padding: 12px !important;
				page-break-inside: avoid !important;
				break-inside: avoid !important;
			}
			.map-card h2 {
				color: #0f172a !important;
				font-size: 14px !important;
			}
			#sitrepMapWrapper {
				height: 330px !important;
				border: 1.5px solid #cbd5e1 !important;
				border-radius: 6px !important;
			}
			#sitrepMapCanvas {
				height: 330px !important;
			}
			.map-status-pill {
				background: #f1f5f9 !important;
				color: #0f172a !important;
				border: 1px solid #cbd5e1 !important;
				font-weight: 600 !important;
			}

			/* Page 2: Table & Directives */
			.page-break-section {
				page-break-before: always !important;
				break-before: page !important;
				margin-top: 0 !important;
				margin-bottom: 12px !important;
				page-break-inside: avoid !important;
				break-inside: avoid !important;
			}
			.page-break-section h2 {
				color: #0f172a !important;
				font-size: 15px !important;
				margin: 0 0 10px 0 !important;
			}
			table {
				width: 100% !important;
				font-size: 11px !important;
				border-collapse: collapse !important;
			}
			th {
				background: #f1f5f9 !important;
				color: #0f172a !important;
				font-weight: 700 !important;
				border-bottom: 2px solid #94a3b8 !important;
				padding: 7px 10px !important;
			}
			td {
				color: #0f172a !important;
				border-bottom: 1px solid #e2e8f0 !important;
				padding: 7px 10px !important;
			}
			.asset-name {
				color: #0f172a !important;
				font-weight: 700 !important;
			}
			.asset-category-pill {
				background: #f8fafc !important;
				color: #334155 !important;
				border: 1px solid #cbd5e1 !important;
				font-weight: 600 !important;
			}
			.mdr-val {
				color: #0f172a !important;
				font-weight: 700 !important;
			}
			.loss-value {
				color: #0369a1 !important;
				font-weight: 700 !important;
			}
			.mdr-bar-bg {
				background: #e2e8f0 !important;
			}
			.sitrep-asset-row.active {
				background: #f1f5f9 !important;
				outline: none !important;
			}

			/* Directives Card (Page 2) */
			.directives-card {
				page-break-inside: avoid !important;
				break-inside: avoid !important;
				padding: 12px 16px !important;
				margin-bottom: 12px !important;
			}
			.directives-card h2 {
				color: #0f172a !important;
				font-size: 15px !important;
				margin: 0 0 10px 0 !important;
			}
			.checklist li {
				border-bottom: 1px solid #e2e8f0 !important;
				color: #0f172a !important;
				padding: 6px 0 !important;
				font-size: 11px !important;
			}
			.check-icon {
				color: #0284c7 !important;
				font-weight: 800 !important;
			}
			.checklist strong {
				color: #0f172a !important;
			}

			/* Footer */
			.doc-footer {
				color: #475569 !important;
				font-size: 10px !important;
				margin-top: 10px !important;
			}
		}
	</style>
</head>
<body>
	<main class="container">
		<header class="header">
			<div style="display: flex; justify-content: space-between; align-items: flex-start;">
				<div>
					<span class="header-badge" role="status">${alertLevel} ALERT</span>
					<h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #ffffff;">${eventName}</h1>
					<div class="header-meta" style="color: #94a3b8; font-size: 13px;">
						<strong>Region:</strong> ${region} &nbsp;|&nbsp; 
						<strong>Intensity:</strong> ${intensityDisplay} &nbsp;|&nbsp; 
						<strong>Issued:</strong> ${timestamp}
					</div>
				</div>
				<button class="btn no-print" onclick="window.print()" aria-label="Print or Save Situation Report as PDF">🖨️ Print / Save PDF</button>
			</div>
		</header>

		<!-- Sendai Framework Priority Indicators -->
		<section aria-label="Sendai Framework Priority Metrics">
			<div class="grid-3">
				<div class="card" style="border-top: 4px solid #38bdf8;">
					<h3 class="card-title">Sendai Target B (Affected)</h3>
					<p class="card-value">${totalExposedPop.toLocaleString()}</p>
					<p class="card-subtext">Exposed Population | <strong>${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()}</strong> Est. Displaced</p>
				</div>
				<div class="card" style="border-top: 4px solid #fb923c;">
					<h3 class="card-title">Sendai Target C (Direct Loss)</h3>
					<p class="card-value">$${(sendai.targetC_DirectEconomicLoss?.estimatedDirectEconomicLossUsd || 0).toLocaleString()}</p>
					<p class="card-subtext">Direct Physical Loss USD | Loss Ratio: <strong>${sendai.targetC_DirectEconomicLoss?.aggregateLossRatioPercentage || 0}%</strong></p>
				</div>
				<div class="card" style="border-top: 4px solid #f87171;">
					<h3 class="card-title">Sendai Target D (Infrastructure)</h3>
					<p class="card-value">${sendai.targetD_CriticalInfrastructure?.totalDamagedFacilities || 0}</p>
					<p class="card-subtext">Damaged Essential Facilities (Hospitals, Substations, Transit)</p>
				</div>
			</div>
		</section>

		<!-- Spatial Exposure & Hazard Footprint (Interactive GIS Map) -->
		<section class="card map-card" aria-label="Spatial Exposure and Hazard Footprint Map">
			<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
				<div style="display: flex; align-items: center; gap: 10px;">
					<h2 style="margin: 0; font-size: 15px; font-weight: 700; color: #f8fafc;">
						🗺️ Spatial Exposure & Hazard Footprint
					</h2>
					<span id="sitrepBasemapBadge" class="map-status-pill" style="font-size: 10px; font-family: monospace; padding: 2px 8px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">
						100% OFFLINE
					</span>
				</div>
				<div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
					<!-- Basemap Selector -->
					<div class="no-print" style="display: flex; align-items: center; gap: 6px;">
						<label for="sitrepBasemapSelect" style="font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase;">Basemap:</label>
						<select id="sitrepBasemapSelect" style="background: #0f172a; border: 1px solid #475569; color: #f8fafc; font-size: 11px; padding: 4px 8px; border-radius: 6px; cursor: pointer; outline: none;">
							<option value="tactical-dark" selected>⬛ Tactical Dark Radar (100% Offline)</option>
							<option value="esri-street">🗺️ Esri World Street Map (Online)</option>
							<option value="esri-satellite">🛰️ Esri World Imagery (Satellite)</option>
							<option value="osm-voyager">🌍 OpenStreetMap (Voyager)</option>
						</select>
					</div>
					<!-- Damage Legend -->
					<div style="display: flex; gap: 10px; font-size: 11px;">
						<span style="display: flex; align-items: center; gap: 4px; color: #f87171;">
							<span style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%; display: inline-block;"></span> High (&ge;50%)
						</span>
						<span style="display: flex; align-items: center; gap: 4px; color: #fb923c;">
							<span style="width: 8px; height: 8px; background: #f97316; border-radius: 50%; display: inline-block;"></span> Moderate (25-50%)
						</span>
						<span style="display: flex; align-items: center; gap: 4px; color: #4ade80;">
							<span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; display: inline-block;"></span> Low (&lt;25%)
						</span>
					</div>
				</div>
			</div>
			<!-- Map Canvas Wrapper (Screen: 520px, Print: 330px with Pan & Zoom controls) -->
			<div id="sitrepMapWrapper" style="position: relative; background: #080d1a; border: 1px solid #334155; border-radius: 8px; overflow: hidden; height: 520px;">
				<canvas id="sitrepMapCanvas" role="img" aria-label="Geospatial impact map displaying exposed facilities and inundation footprint in Southern Thailand" style="width: 100%; height: 100%; display: block; cursor: grab;"></canvas>
				
				<!-- Zoom & Pan Overlay Toolbar -->
				<div class="no-print" style="position: absolute; top: 12px; left: 12px; display: flex; flex-direction: column; gap: 4px; z-index: 5;">
					<button id="btnZoomIn" title="Zoom In" style="width: 28px; height: 28px; background: rgba(15, 23, 42, 0.9); border: 1px solid #475569; color: #f8fafc; font-weight: bold; font-size: 14px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;">+</button>
					<button id="btnZoomOut" title="Zoom Out" style="width: 28px; height: 28px; background: rgba(15, 23, 42, 0.9); border: 1px solid #475569; color: #f8fafc; font-weight: bold; font-size: 14px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;">&minus;</button>
					<button id="btnResetView" title="Reset View" style="width: 28px; height: 28px; background: rgba(15, 23, 42, 0.9); border: 1px solid #475569; color: #94a3b8; font-size: 11px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;">↺</button>
				</div>

				<!-- Tooltip -->
				<div id="sitrepMapTooltip" style="display: none; position: absolute; top: 10px; right: 10px; background: rgba(15, 23, 42, 0.95); border: 1px solid #475569; border-radius: 6px; padding: 8px 12px; font-size: 11px; color: #f8fafc; pointer-events: none; z-index: 10; max-width: 260px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
					<div id="tooltipName" style="font-weight: 700; color: #38bdf8;">Facility</div>
					<div id="tooltipDetails" style="color: #cbd5e1; font-size: 11px; margin-top: 3px; line-height: 1.4;">Details</div>
				</div>
				
				<!-- Map Subtitle Coordinates & Mode Info -->
				<div class="no-print" style="position: absolute; bottom: 8px; left: 8px; font-size: 10px; color: #64748b; font-family: monospace; pointer-events: none; background: rgba(8, 13, 26, 0.7); padding: 2px 6px; border-radius: 3px;">
					WGS84 EPSG:4326 • Drag to Pan • Wheel to Zoom • Dynamic Auto-Fit
				</div>
				<div class="print-only" style="display: none; position: absolute; bottom: 8px; left: 8px; font-size: 9px; color: #cbd5e1; font-family: monospace; background: rgba(15, 23, 42, 0.85); padding: 2px 6px; border-radius: 3px;">
					WGS84 EPSG:4326 • Spatial Exposure & Hazard Verification Footprint
				</div>
			</div>
		</section>

		<!-- High-Risk Critical Infrastructure Table (Page 2) -->
		<section class="card page-break-section" aria-label="Critical Infrastructure Damage Audit">
			<h2 style="margin: 0 0 14px 0; font-size: 16px; font-weight: 700; color: #f8fafc;">
				Priority Structural Damage & Impact Audit
			</h2>
			<div style="overflow-x: auto;">
				<table>
					<caption class="sr-only">Detailed Structural Damage and Economic Losses by Critical Facility</caption>
					<thead>
						<tr>
							<th scope="col">Critical Asset</th>
							<th scope="col">Category</th>
							<th scope="col" style="text-align: right;">Mean Damage Ratio (MDR)</th>
							<th scope="col" style="text-align: right;">Estimated Loss (USD)</th>
						</tr>
					</thead>
					<tbody>
						${topAssetsRows}
					</tbody>
				</table>
			</div>
		</section>

		<!-- Action Checklist for EOC Watchstanders (Page 2) -->
		<section class="card directives-card" aria-label="EOC Operational Action Directives">
			<h2 style="margin: 0 0 14px 0; font-size: 16px; font-weight: 700; color: #f8fafc;">
				EOC Operational Action Directives
			</h2>
			<ul class="checklist">
				<li>
					<span class="check-icon" aria-hidden="true">1.</span>
					<div>
						<strong>Life Safety & Shelter Mobilization:</strong> Activate municipal reception shelters for an estimated <strong>${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()}</strong> displaced individuals. Preposition water purification kits and emergency medical tents.
					</div>
				</li>
				<li>
					<span class="check-icon" aria-hidden="true">2.</span>
					<div>
						<strong>Critical Infrastructure Stabilization:</strong> Dispatch structural engineering survey teams and backup generator units to priority healthcare facilities with damage ratios exceeding 25%.
					</div>
				</li>
				<li>
					<span class="check-icon" aria-hidden="true">3.</span>
					<div>
						<strong>OASIS CAP v1.2 Broadcast Verification:</strong> Ensure cell broadcast emergency alerts are disseminated across targeted telecom towers in <strong>${region}</strong>.
					</div>
				</li>
				<li>
					<span class="check-icon" aria-hidden="true">4.</span>
					<div>
						<strong>UNDRR DELTA Reporting:</strong> Submit validated loss assessment draft to the national DELTA Resilience repository for Sendai Monitor compliance.
					</div>
				</li>
			</ul>
		</section>

		<footer class="doc-footer" style="margin-top: 24px; text-align: center; color: #64748b; font-size: 11px;">
			Generated by Disaster Risk Reduction (DRR) Agent Plugin • Conforms to OASIS CAP v1.2 & UN Sendai Framework
		</footer>
	</main>

	<script>
		(function() {
			const canvas = document.getElementById('sitrepMapCanvas');
			if (!canvas) return;
			const ctx = canvas.getContext('2d');
			const tooltip = document.getElementById('sitrepMapTooltip');
			const tooltipName = document.getElementById('tooltipName');
			const tooltipDetails = document.getElementById('tooltipDetails');
			const basemapSelect = document.getElementById('sitrepBasemapSelect');
			const basemapBadge = document.getElementById('sitrepBasemapBadge');
			const btnZoomIn = document.getElementById('btnZoomIn');
			const btnZoomOut = document.getElementById('btnZoomOut');
			const btnResetView = document.getElementById('btnResetView');
			const assets = ${JSON.stringify(mapAssets)};

			let currentBasemap = "tactical-dark";
			let userZoom = 1.0;
			let panOffset = { x: 0, y: 0 };
			let isDragging = false;
			let dragStart = { x: 0, y: 0 };
			let hoveredAsset = null;
			const tileCache = {};

			function cleanLabelName(fullName) {
				if (!fullName) return "Asset";
				var parenIdx = fullName.indexOf('(');
				var brackIdx = fullName.indexOf('[');
				var cutIdx = -1;
				if (parenIdx !== -1 && brackIdx !== -1) cutIdx = Math.min(parenIdx, brackIdx);
				else if (parenIdx !== -1) cutIdx = parenIdx;
				else if (brackIdx !== -1) cutIdx = brackIdx;

				var clean = (cutIdx !== -1 ? fullName.substring(0, cutIdx) : fullName).trim();
				clean = clean
					.replace(/^Highway\\s+/i, 'Hwy ')
					.replace(/High-Voltage\\s+Electrical\\s+Substation/i, 'Substation')
					.replace(/Municipal\\s+Evacuation\\s+&\\s+Relief\\s+Center/i, 'Evacuation Center')
					.replace(/Ratchanakharin\\s+Hospital/i, 'Hospital')
					.replace(/&\\s+SRT\\s+Southern\\s+Line\\s+Depot/i, '')
					.replace(/Mueang\\s+Yala\\s+/i, '');
				if (clean.length > 25) clean = clean.substring(0, 23) + '…';
				return clean;
			}

			if (basemapSelect) {
				basemapSelect.addEventListener('change', function(e) {
					currentBasemap = e.target.value;
					if (currentBasemap === "tactical-dark") {
						basemapBadge.textContent = "100% OFFLINE";
						basemapBadge.style.color = "#34d399";
						basemapBadge.style.background = "rgba(16, 185, 129, 0.15)";
						basemapBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
					} else {
						basemapBadge.textContent = "ONLINE TILES";
						basemapBadge.style.color = "#38bdf8";
						basemapBadge.style.background = "rgba(56, 189, 248, 0.15)";
						basemapBadge.style.borderColor = "rgba(56, 189, 248, 0.3)";
					}
					draw();
				});
			}

			if (btnZoomIn) {
				btnZoomIn.addEventListener('click', function() {
					userZoom = Math.min(5.0, userZoom * 1.25);
					draw();
				});
			}
			if (btnZoomOut) {
				btnZoomOut.addEventListener('click', function() {
					userZoom = Math.max(0.5, userZoom * 0.8);
					draw();
				});
			}
			if (btnResetView) {
				btnResetView.addEventListener('click', function() {
					userZoom = 1.0;
					panOffset = { x: 0, y: 0 };
					draw();
				});
			}

			canvas.addEventListener('wheel', function(e) {
				e.preventDefault();
				const factor = e.deltaY < 0 ? 1.15 : 0.87;
				userZoom = Math.max(0.4, Math.min(6.0, userZoom * factor));
				draw();
			}, { passive: false });

			canvas.addEventListener('mousedown', function(e) {
				if (e.button === 0) {
					isDragging = true;
					dragStart = { x: e.clientX, y: e.clientY };
					canvas.style.cursor = 'grabbing';
				}
			});

			window.addEventListener('mouseup', function() {
				if (isDragging) {
					isDragging = false;
					canvas.style.cursor = 'grab';
				}
			});

			canvas.addEventListener('mousemove', function(e) {
				const rect = canvas.getBoundingClientRect();
				const mx = e.clientX - rect.left;
				const my = e.clientY - rect.top;

				if (isDragging) {
					panOffset.x += (e.clientX - dragStart.x);
					panOffset.y += (e.clientY - dragStart.y);
					dragStart = { x: e.clientX, y: e.clientY };
					draw();
					return;
				}

				let hit = null;
				assets.forEach(a => {
					const px = a._visX != null ? a._visX : a._px;
					const py = a._visY != null ? a._visY : a._py;
					if (px != null && Math.hypot(px - mx, py - my) <= 14) hit = a;
					else if (a._bbox != null && mx >= a._bbox.x && mx <= a._bbox.x + a._bbox.w && my >= a._bbox.y && my <= a._bbox.y + a._bbox.h) hit = a;
				});

				if (hit !== hoveredAsset) {
					hoveredAsset = hit;
					document.querySelectorAll('.sitrep-asset-row').forEach(r => r.classList.remove('active'));
					if (hoveredAsset) {
						const row = document.getElementById('asset-row-' + hoveredAsset._idx);
						if (row) row.classList.add('active');
						tooltip.style.display = 'block';
						tooltipName.textContent = hoveredAsset.name;
						tooltipDetails.innerHTML = '<strong>' + (hoveredAsset.category || 'ASSET').toUpperCase() + '</strong> • MDR: <strong>' + (hoveredAsset.mdr * 100).toFixed(1) + '%</strong> • Est. Loss: <strong>$' + (hoveredAsset.lossUsd || 0).toLocaleString() + '</strong>' +
							(hoveredAsset.population ? '<br>Exposed Population: ' + hoveredAsset.population.toLocaleString() : '') +
							(hoveredAsset.facilityCode ? '<br>Facility Code: ' + hoveredAsset.facilityCode : '');
						canvas.style.cursor = 'pointer';
					} else {
						tooltip.style.display = 'none';
						canvas.style.cursor = 'grab';
					}
					draw();
				}
			});

			canvas.addEventListener('mouseleave', function() {
				if (hoveredAsset !== null) {
					hoveredAsset = null;
					document.querySelectorAll('.sitrep-asset-row').forEach(r => r.classList.remove('active'));
					tooltip.style.display = 'none';
					draw();
				}
			});

			// Bidirectional Table Row Hover Synchronization
			document.querySelectorAll('.sitrep-asset-row').forEach(function(row) {
				const idx = parseInt(row.getAttribute('data-asset-index'), 10);
				row.addEventListener('mouseenter', function() {
					if (assets[idx]) {
						hoveredAsset = assets[idx];
						row.classList.add('active');
						tooltip.style.display = 'block';
						tooltipName.textContent = hoveredAsset.name;
						tooltipDetails.innerHTML = '<strong>' + (hoveredAsset.category || 'ASSET').toUpperCase() + '</strong> • MDR: <strong>' + (hoveredAsset.mdr * 100).toFixed(1) + '%</strong> • Est. Loss: <strong>$' + (hoveredAsset.lossUsd || 0).toLocaleString() + '</strong>' +
							(hoveredAsset.population ? '<br>Exposed Population: ' + hoveredAsset.population.toLocaleString() : '') +
							(hoveredAsset.facilityCode ? '<br>Facility Code: ' + hoveredAsset.facilityCode : '');
						draw();
					}
				});
				row.addEventListener('mouseleave', function() {
					hoveredAsset = null;
					row.classList.remove('active');
					tooltip.style.display = 'none';
					draw();
				});
			});

			function getTileUrl(provider, x, y, z) {
				if (provider === "esri-street") {
					return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/" + z + "/" + y + "/" + x;
				}
				if (provider === "esri-satellite") {
					return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/" + z + "/" + y + "/" + x;
				}
				if (provider === "osm-voyager") {
					return "https://basemaps.cartocdn.com/rastertiles/voyager/" + z + "/" + x + "/" + y + ".png";
				}
				return null;
			}

			function lonToTileX(lon, z) {
				return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
			}

			function latToTileY(lat, z) {
				const latRad = (lat * Math.PI) / 180;
				return Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
			}

			function tileXToLon(tx, z) {
				return (tx / Math.pow(2, z)) * 360 - 180;
			}

			function tileYToLat(ty, z) {
				const n = Math.PI - (2 * Math.PI * ty) / Math.pow(2, z);
				return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
			}

			function resize() {
				const isPrinting = (window.matchMedia && window.matchMedia('print').matches);
				const rect = canvas.getBoundingClientRect();
				const w = rect.width || (canvas.parentElement ? canvas.parentElement.clientWidth : 800);
				const h = isPrinting ? 330 : (rect.height || (canvas.parentElement ? canvas.parentElement.clientHeight : 520));
				canvas.width = w * (window.devicePixelRatio || 1);
				canvas.height = h * (window.devicePixelRatio || 1);
				ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
				draw();
			}

			function draw() {
				const w = canvas.width / (window.devicePixelRatio || 1);
				const h = canvas.height / (window.devicePixelRatio || 1);
				ctx.clearRect(0, 0, w, h);

				// Tactical Dark background
				ctx.fillStyle = '#080d1a';
				ctx.fillRect(0, 0, w, h);

				if (!assets || assets.length === 0) return;

				// Dynamic Bounding Box & Scale Fitting
				let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
				assets.forEach(a => {
					if (a.coords && a.coords.length >= 2) {
						minLon = Math.min(minLon, a.coords[0]);
						maxLon = Math.max(maxLon, a.coords[0]);
						minLat = Math.min(minLat, a.coords[1]);
						maxLat = Math.max(maxLat, a.coords[1]);
					}
				});

				if (!isFinite(minLon)) { minLon = 85.30; maxLon = 85.35; minLat = 27.69; maxLat = 27.73; }

				const centerLon = (minLon + maxLon) / 2;
				const centerLat = (minLat + maxLat) / 2;
				const spanLon = Math.max(maxLon - minLon, 0.025);
				const spanLat = Math.max(maxLat - minLat, 0.02);

				const isPrinting = (window.matchMedia && window.matchMedia('print').matches);
				const padX = isPrinting ? 110 : 130;
				const padY = isPrinting ? 40 : 55;
				const cosLat = Math.cos(centerLat * Math.PI / 180);
				const centerLatRad = (centerLat * Math.PI) / 180;
				const centerMercY = Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2));

				const scaleX = (w - padX * 2) / (spanLon * (Math.PI / 180) * cosLat);
				const scaleY = (h - padY * 2) / (spanLat * (Math.PI / 180));
				const baseScale = Math.min(scaleX, scaleY);
				const effectiveScale = baseScale * userZoom;

				function toCanvas(lon, lat) {
					const latRad = (lat * Math.PI) / 180;
					const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
					const cx = w / 2 + panOffset.x + (lon - centerLon) * (Math.PI / 180) * cosLat * effectiveScale;
					const cy = h / 2 + panOffset.y - (mercY - centerMercY) * effectiveScale;
					return { x: cx, y: cy };
				}

				function toGeo(px, py) {
					const mercY = centerMercY - (py - h / 2 - panOffset.y) / effectiveScale;
					const latRad = 2 * Math.atan(Math.exp(mercY)) - Math.PI / 2;
					const lon = centerLon + ((px - w / 2 - panOffset.x) / (effectiveScale * (Math.PI / 180) * cosLat));
					return { lon: lon, lat: (latRad * 180) / Math.PI };
				}

				// 1. Basemap Rendering
				if (currentBasemap !== "tactical-dark") {
					const zFloat = Math.log2((2 * Math.PI * effectiveScale * cosLat) / 256);
					const z = Math.max(1, Math.min(18, Math.round(zFloat)));

					const minGeo = toGeo(0, h);
					const maxGeo = toGeo(w, 0);
					const minTx = Math.max(0, lonToTileX(Math.min(minGeo.lon, maxGeo.lon), z) - 1);
					const maxTx = Math.min(Math.pow(2, z) - 1, lonToTileX(Math.max(minGeo.lon, maxGeo.lon), z) + 1);
					const minTy = Math.max(0, latToTileY(Math.max(minGeo.lat, maxGeo.lat), z) - 1);
					const maxTy = Math.min(Math.pow(2, z) - 1, latToTileY(Math.min(minGeo.lat, maxGeo.lat), z) + 1);

					for (let tx = minTx; tx <= maxTx; tx++) {
						for (let ty = minTy; ty <= maxTy; ty++) {
							const tileKey = currentBasemap + "_" + z + "_" + tx + "_" + ty;
							const url = getTileUrl(currentBasemap, tx, ty, z);
							const lonL = tileXToLon(tx, z);
							const lonR = tileXToLon(tx + 1, z);
							const latT = tileYToLat(ty, z);
							const latB = tileYToLat(ty + 1, z);
							const p1 = toCanvas(lonL, latT);
							const p2 = toCanvas(lonR, latB);

							if (tileCache[tileKey]) {
								if (tileCache[tileKey].complete && tileCache[tileKey].naturalWidth > 0) {
									ctx.drawImage(tileCache[tileKey], p1.x, p1.y, p2.x - p1.x + 0.5, p2.y - p1.y + 0.5);
								}
							} else {
								const img = new Image();
								img.crossOrigin = "anonymous";
								img.src = url;
								img.onload = () => draw();
								img.onerror = () => { /* gracefully handle offline or network block */ };
								tileCache[tileKey] = img;
							}
						}
					}

					// High-contrast translucent overlay so badges and hazard graphics remain legible
					ctx.fillStyle = (currentBasemap === "esri-satellite") ? "rgba(10, 15, 30, 0.35)" : "rgba(10, 15, 30, 0.55)";
					ctx.fillRect(0, 0, w, h);
				} else {
					// Offline Graticule Grid
					ctx.strokeStyle = '#152033';
					ctx.lineWidth = 1;
					for (let x = 40; x < w; x += 55) {
						ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
					}
					for (let y = 30; y < h; y += 40) {
						ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
					}

					// Regional offline vector landmass contour
					ctx.fillStyle = '#101a2b';
					ctx.strokeStyle = '#273852';
					ctx.lineWidth = 1.5;
					ctx.beginPath();
					const rx = spanLon * 1.5;
					const ry = spanLat * 1.5;
					const landPts = [
						toCanvas(centerLon - rx, centerLat - ry),
						toCanvas(centerLon + rx * 0.9, centerLat - ry * 0.8),
						toCanvas(centerLon + rx * 1.1, centerLat + ry * 0.9),
						toCanvas(centerLon - rx * 0.8, centerLat + ry)
					];
					landPts.forEach((p, idx) => idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
					ctx.closePath();
					ctx.fill();
					ctx.stroke();

					// River waterway corridor
					ctx.save();
					ctx.shadowColor = 'rgba(56, 189, 248, 0.5)';
					ctx.shadowBlur = 5;
					ctx.strokeStyle = '#0284c7';
					ctx.lineWidth = 2.5;
					ctx.beginPath();
					const rivPts = [
						toCanvas(centerLon + rx * 0.7, centerLat + ry * 0.8),
						toCanvas(centerLon + rx * 0.1, centerLat + ry * 0.1),
						toCanvas(centerLon - rx * 0.6, centerLat - ry * 0.7)
					];
					rivPts.forEach((p, idx) => idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
					ctx.stroke();
					ctx.restore();
				}

				// 2. Hazard Impact Buffer Zone
				const centerPos = toCanvas(centerLon, centerLat);
				const bufferRadiusPx = Math.max(90, Math.hypot(scaleX * (spanLon * Math.PI / 180 * cosLat), scaleY * (spanLat * Math.PI / 180)) * 0.75 * userZoom);
				ctx.beginPath();
				ctx.arc(centerPos.x, centerPos.y, bufferRadiusPx, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
				ctx.fill();
				ctx.strokeStyle = '#ef4444';
				ctx.lineWidth = 1.5;
				ctx.setLineDash([5, 5]);
				ctx.stroke();
				ctx.setLineDash([]);

				// Helper for rounded rectangle badges
				function drawBadge(bx, by, bw, bh, radius) {
					ctx.beginPath();
					ctx.moveTo(bx + radius, by);
					ctx.lineTo(bx + bw - radius, by);
					ctx.arcTo(bx + bw, by, bx + bw, by + radius, radius);
					ctx.lineTo(bx + bw, by + bh - radius);
					ctx.arcTo(bx + bw, by + bh, bx + bw - radius, by + bh, radius);
					ctx.lineTo(bx + radius, by + bh);
					ctx.arcTo(bx, by + bh, bx, by + bh - radius, radius);
					ctx.lineTo(bx, by + radius);
					ctx.arcTo(bx, by, bx + radius, by, radius);
					ctx.closePath();
				}

				// 3. Compute Coordinates, Clusters & Collision-Free Label Layout
				assets.forEach(function(asset, idx) {
					asset._idx = idx;
					const pos = toCanvas(asset.coords[0], asset.coords[1]);
					asset._px = pos.x;
					asset._py = pos.y;
					asset._displayName = cleanLabelName(asset.name);
				});

				// Cluster Detection (Pairwise distance < 26px)
				const clusters = [];
				const visited = new Set();
				const clusterRadius = 26;

				for (let i = 0; i < assets.length; i++) {
					if (visited.has(i)) continue;
					const cluster = [i];
					visited.add(i);
					for (let j = i + 1; j < assets.length; j++) {
						if (!visited.has(j)) {
							const d = Math.hypot(assets[i]._px - assets[j]._px, assets[i]._py - assets[j]._py);
							if (d < clusterRadius) {
								cluster.push(j);
								visited.add(j);
							}
						}
					}
					clusters.push(cluster);
				}

				// Spiderfy Pin Distribution for Clustered Assets
				clusters.forEach(function(cl) {
					if (cl.length > 1) {
						let cx = 0, cy = 0;
						cl.forEach(function(idx) { cx += assets[idx]._px; cy += assets[idx]._py; });
						cx /= cl.length;
						cy /= cl.length;
						const r = Math.min(20, 9 + cl.length * 2.5);
						cl.forEach(function(idx, k) {
							const angle = (2 * Math.PI * k / cl.length) - (Math.PI / 4);
							assets[idx]._visX = cx + Math.cos(angle) * r;
							assets[idx]._visY = cy + Math.sin(angle) * r;
							assets[idx]._clusterCenter = { x: cx, y: cy };
							assets[idx]._clusterAngle = angle;
						});
					} else {
						assets[cl[0]]._visX = assets[cl[0]]._px;
						assets[cl[0]]._visY = assets[cl[0]]._py;
						assets[cl[0]]._clusterCenter = null;
						assets[cl[0]]._clusterAngle = null;
					}
				});

				// Multi-Candidate Smart Placement (Imhof Algorithm)
				const placedBoxes = [];
				const badgeH = 26;

				assets.forEach(function(asset) {
					const px = asset._visX;
					const py = asset._visY;
					ctx.font = 'bold 9.5px sans-serif';
					const nameW = ctx.measureText(asset._displayName).width;
					const badgeW = Math.min(160, Math.max(115, nameW + 18));

					const distances = [22, 38, 56, 76];
					const candidateDirs = [];

					if (asset._clusterCenter) {
						const ca = asset._clusterAngle;
						const cos = Math.cos(ca);
						const sin = Math.sin(ca);
						candidateDirs.push({ dx: cos >= 0 ? 1 : -1, dy: sin >= 0 ? 1 : -1, bias: 0 });
						candidateDirs.push({ dx: cos >= 0 ? 1 : -1, dy: sin >= 0 ? -1 : 1, bias: 200 });
						candidateDirs.push({ dx: cos >= 0 ? -1 : 1, dy: sin >= 0 ? 1 : -1, bias: 400 });
						candidateDirs.push({ dx: cos >= 0 ? -1 : 1, dy: sin >= 0 ? -1 : 1, bias: 600 });
					} else {
						candidateDirs.push({ dx: 1, dy: -1, bias: 0 });
						candidateDirs.push({ dx: 1, dy: 1, bias: 50 });
						candidateDirs.push({ dx: -1, dy: -1, bias: 50 });
						candidateDirs.push({ dx: -1, dy: 1, bias: 100 });
						candidateDirs.push({ dx: 1, dy: 0, bias: 150 });
						candidateDirs.push({ dx: -1, dy: 0, bias: 150 });
						candidateDirs.push({ dx: 0, dy: -1, bias: 200 });
						candidateDirs.push({ dx: 0, dy: 1, bias: 200 });
					}

					let bestBox = null;
					let minPenalty = Infinity;

					for (let di = 0; di < distances.length; di++) {
						const dist = distances[di];
						for (let ci = 0; ci < candidateDirs.length; ci++) {
							const dir = candidateDirs[ci];
							let bx, by;
							if (dir.dx > 0 && dir.dy < 0) {
								bx = px + dist;
								by = py - dist - badgeH / 2;
							} else if (dir.dx > 0 && dir.dy > 0) {
								bx = px + dist;
								by = py + dist - badgeH / 2;
							} else if (dir.dx < 0 && dir.dy < 0) {
								bx = px - dist - badgeW;
								by = py - dist - badgeH / 2;
							} else if (dir.dx < 0 && dir.dy > 0) {
								bx = px - dist - badgeW;
								by = py + dist - badgeH / 2;
							} else if (dir.dx > 0 && dir.dy === 0) {
								bx = px + dist + 6;
								by = py - badgeH / 2;
							} else if (dir.dx < 0 && dir.dy === 0) {
								bx = px - dist - badgeW - 6;
								by = py - badgeH / 2;
							} else if (dir.dx === 0 && dir.dy < 0) {
								bx = px - badgeW / 2;
								by = py - dist - badgeH;
							} else {
								bx = px - badgeW / 2;
								by = py + dist;
							}

							let penalty = dir.bias + dist * 0.4;
							const pad = 8;
							if (bx < pad || bx + badgeW > w - pad || by < pad || by + badgeH > h - pad) {
								penalty += 50000;
							}

							for (let pi = 0; pi < placedBoxes.length; pi++) {
								const pb = placedBoxes[pi];
								const overlapW = Math.max(0, Math.min(bx + badgeW, pb.x + pb.w) - Math.max(bx, pb.x));
								const overlapH = Math.max(0, Math.min(by + badgeH, pb.y + pb.h) - Math.max(by, pb.y));
								if (overlapW > 0 && overlapH > 0) {
									penalty += 10000 + (overlapW * overlapH) * 50;
								}
							}

							for (let oi = 0; oi < assets.length; oi++) {
								const other = assets[oi];
								const opx = other._visX || other._px;
								const opy = other._visY || other._py;
								if (opx >= bx - 3 && opx <= bx + badgeW + 3 && opy >= by - 3 && opy <= by + badgeH + 3) {
									penalty += 8000;
								}
							}

							if (penalty < minPenalty) {
								minPenalty = penalty;
								bestBox = { x: bx, y: by, w: badgeW, h: badgeH, penalty: penalty };
							}
						}
						if (minPenalty < 1000) break;
					}

					asset._bbox = bestBox;
					placedBoxes.push(bestBox);
				});

				// 4. Render Cluster Hubs & Spokes
				clusters.forEach(function(cl) {
					if (cl.length > 1) {
						const center = assets[cl[0]]._clusterCenter;
						if (center) {
							ctx.beginPath();
							ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
							ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
							ctx.fill();
							ctx.strokeStyle = '#38bdf8';
							ctx.lineWidth = 1;
							ctx.stroke();

							cl.forEach(function(idx) {
								const a = assets[idx];
								ctx.beginPath();
								ctx.moveTo(center.x, center.y);
								ctx.lineTo(a._visX, a._visY);
								ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
								ctx.lineWidth = 1;
								ctx.setLineDash([2, 2]);
								ctx.stroke();
								ctx.setLineDash([]);
							});
						}
					}
				});

				// 5. Render Leader Lines
				assets.forEach(function(asset) {
					const b = asset._bbox;
					if (!b) return;
					const px = asset._visX;
					const py = asset._visY;
					const isHovered = (hoveredAsset === asset);

					const ax = (b.x + b.w < px) ? b.x + b.w : (b.x > px ? b.x : b.x + b.w / 2);
					const ay = (b.y + b.h < py) ? b.y + b.h : (b.y > py ? b.y : b.y + b.h / 2);

					ctx.beginPath();
					ctx.moveTo(px, py);
					ctx.lineTo(ax, ay);
					ctx.strokeStyle = isHovered ? '#38bdf8' : (isPrinting ? '#64748b' : 'rgba(148, 163, 184, 0.7)');
					ctx.lineWidth = isHovered ? 2 : 1;
					ctx.setLineDash(isHovered ? [] : [3, 3]);
					ctx.stroke();
					ctx.setLineDash([]);

					ctx.beginPath();
					ctx.arc(ax, ay, isHovered ? 2.5 : 1.5, 0, Math.PI * 2);
					ctx.fillStyle = isHovered ? '#38bdf8' : '#94a3b8';
					ctx.fill();
				});

				// 6. Render Marker Pins
				assets.forEach(function(asset) {
					const px = asset._visX;
					const py = asset._visY;
					const isHovered = (hoveredAsset === asset);
					const isHigh = asset.mdr >= 0.5;
					const isMod = asset.mdr >= 0.25 && asset.mdr < 0.5;
					const color = isHigh ? '#ef4444' : isMod ? '#f97316' : '#22c55e';

					if (isHovered || isHigh) {
						ctx.beginPath();
						ctx.arc(px, py, isHovered ? 14 : 11, 0, Math.PI * 2);
						ctx.fillStyle = isHovered ? 'rgba(56, 189, 248, 0.35)' : 'rgba(239, 68, 68, 0.25)';
						ctx.fill();
					}

					ctx.beginPath();
					ctx.arc(px, py, isHovered ? 7 : 5.5, 0, Math.PI * 2);
					ctx.fillStyle = color;
					ctx.fill();
					ctx.strokeStyle = isHovered ? '#38bdf8' : '#ffffff';
					ctx.lineWidth = isHovered ? 2 : 1.5;
					ctx.stroke();

					ctx.beginPath();
					ctx.arc(px, py, 2, 0, Math.PI * 2);
					ctx.fillStyle = '#ffffff';
					ctx.fill();
				});

				// 7. Render Tactical Label Badges
				const renderBadgeOrder = assets.slice().sort(function(a, b) {
					if (a === hoveredAsset) return 1;
					if (b === hoveredAsset) return -1;
					return 0;
				});

				renderBadgeOrder.forEach(function(asset) {
					const b = asset._bbox;
					if (!b) return;
					const isHovered = (hoveredAsset === asset);
					const isHigh = asset.mdr >= 0.5;
					const isMod = asset.mdr >= 0.25 && asset.mdr < 0.5;
					const color = isHigh ? '#ef4444' : isMod ? '#f97316' : '#22c55e';

					drawBadge(b.x, b.y, b.w, b.h, 4);
					ctx.fillStyle = isPrinting ? '#ffffff' : (isHovered ? 'rgba(15, 23, 42, 0.98)' : 'rgba(15, 23, 42, 0.92)');
					ctx.fill();
					ctx.strokeStyle = isHovered ? '#38bdf8' : (isPrinting ? (isHigh ? '#dc2626' : '#64748b') : (isHigh ? 'rgba(239, 68, 68, 0.8)' : 'rgba(71, 85, 105, 0.85)'));
					ctx.lineWidth = isHovered ? 2 : 1;
					ctx.stroke();

					ctx.fillStyle = isPrinting ? '#0f172a' : (isHovered ? '#38bdf8' : '#f8fafc');
					ctx.font = 'bold 9.5px sans-serif';
					ctx.textAlign = 'left';
					ctx.fillText(asset._displayName, b.x + 7, b.y + 11);

					ctx.fillStyle = color;
					ctx.font = 'bold 8.5px monospace';
					ctx.fillText((asset.category || 'ASSET').toUpperCase() + ' • MDR ' + (asset.mdr * 100).toFixed(0) + '%', b.x + 7, b.y + 21);
				});

				// 4. Tactical Compass Rose (North Arrow)
				const compassX = w - 24;
				const compassY = 24;
				ctx.beginPath();
				ctx.arc(compassX, compassY, 11, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
				ctx.fill();
				ctx.strokeStyle = '#334155';
				ctx.lineWidth = 1;
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(compassX, compassY - 8);
				ctx.lineTo(compassX + 3, compassY);
				ctx.lineTo(compassX - 3, compassY);
				ctx.closePath();
				ctx.fillStyle = '#ef4444';
				ctx.fill();
				ctx.beginPath();
				ctx.moveTo(compassX, compassY + 8);
				ctx.lineTo(compassX + 3, compassY);
				ctx.lineTo(compassX - 3, compassY);
				ctx.closePath();
				ctx.fillStyle = '#94a3b8';
				ctx.fill();
				ctx.fillStyle = '#ffffff';
				ctx.font = 'bold 7px sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText('N', compassX, compassY - 10);
			}

			window.addEventListener('resize', resize);
			window.addEventListener('beforeprint', resize);
			window.addEventListener('afterprint', resize);
			if (window.matchMedia) {
				const mq = window.matchMedia('print');
				try {
					mq.addEventListener('change', resize);
				} catch (_) {
					try { mq.addListener(resize); } catch (__) {}
				}
			}
			setTimeout(resize, 50);
		})();
	</script>
</body>
</html>`;
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
	generateVisualSitRepHtml,
};
