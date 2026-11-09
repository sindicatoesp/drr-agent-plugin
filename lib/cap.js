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
		? vulnerability.topDamagedAssets.slice(0, 6).map(a => `
			<tr style="border-bottom: 1px solid #334155;">
				<td style="padding: 10px 12px; font-weight: 600; color: #f8fafc;">${a.name}</td>
				<td style="padding: 10px 12px; text-transform: uppercase; font-size: 11px; color: #94a3b8;"><span style="background: #1e293b; padding: 2px 8px; border-radius: 4px; border: 1px solid #334155;">${a.category}</span></td>
				<td style="padding: 10px 12px; text-align: right; color: #f8fafc;">
					<div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
						<span style="font-weight: 600;">${(a.meanDamageRatio * 100).toFixed(1)}%</span>
						<div style="width: 60px; height: 6px; background: #334155; border-radius: 3px; overflow: hidden;">
							<div style="width: ${(a.meanDamageRatio * 100).toFixed(1)}%; height: 100%; background: ${a.meanDamageRatio > 0.5 ? '#ef4444' : '#f59e0b'};"></div>
						</div>
					</div>
				</td>
				<td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #38bdf8;">$${(a.estimatedEconomicLossUsd || 0).toLocaleString()}</td>
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
			name: a.name || `Facility #${i + 1}`,
			category: a.category || "infrastructure",
			coords: [coords[0], coords[1]],
			mdr: a.meanDamageRatio || 0.35,
			lossUsd: a.estimatedEconomicLossUsd || a.valueUsd || 0
		};
	});

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Emergency Situation Report: ${eventName}</title>
	<style>
		@media print {
			body { background: #ffffff !important; color: #0f172a !important; padding: 0 !important; }
			.card { border: 1px solid #cbd5e1 !important; background: #ffffff !important; box-shadow: none !important; }
			.no-print { display: none !important; }
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
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
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
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div style="display: flex; justify-content: space-between; align-items: flex-start;">
				<div>
					<span class="header-badge">${alertLevel} ALERT</span>
					<h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #ffffff;">${eventName}</h1>
					<div style="color: #94a3b8; font-size: 13px;">
						<strong>Region:</strong> ${region} &nbsp;|&nbsp; 
						<strong>Intensity:</strong> ${intensityDisplay} &nbsp;|&nbsp; 
						<strong>Issued:</strong> ${timestamp}
					</div>
				</div>
				<button class="btn no-print" onclick="window.print()">🖨️ Print / Save PDF</button>
			</div>
		</div>

		<!-- Sendai Framework Priority Indicators -->
		<div class="grid-3">
			<div class="card" style="border-top: 4px solid #38bdf8;">
				<h4 class="card-title">Sendai Target B (Affected)</h4>
				<p class="card-value">${totalExposedPop.toLocaleString()}</p>
				<p class="card-subtext">Exposed Population | <strong>${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()}</strong> Est. Displaced</p>
			</div>
			<div class="card" style="border-top: 4px solid #fb923c;">
				<h4 class="card-title">Sendai Target C (Direct Loss)</h4>
				<p class="card-value">$${(sendai.targetC_DirectEconomicLoss?.estimatedDirectEconomicLossUsd || 0).toLocaleString()}</p>
				<p class="card-subtext">Direct Physical Loss USD | Loss Ratio: <strong>${sendai.targetC_DirectEconomicLoss?.aggregateLossRatioPercentage || 0}%</strong></p>
			</div>
			<div class="card" style="border-top: 4px solid #f87171;">
				<h4 class="card-title">Sendai Target D (Infrastructure)</h4>
				<p class="card-value">${sendai.targetD_CriticalInfrastructure?.totalDamagedFacilities || 0}</p>
				<p class="card-subtext">Damaged Essential Facilities (Hospitals, Clinics, Schools)</p>
			</div>
		</div>

		<!-- Spatial Exposure & Hazard Footprint (Interactive GIS Map) -->
		<div class="card" style="margin-bottom: 24px; padding: 16px;">
			<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
				<div style="display: flex; align-items: center; gap: 10px;">
					<h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #f8fafc;">
						🗺️ Spatial Exposure & Hazard Footprint
					</h3>
					<span id="sitrepBasemapBadge" style="font-size: 10px; font-family: monospace; padding: 2px 8px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">
						100% OFFLINE
					</span>
				</div>
				<div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
					<!-- Basemap Selector -->
					<div style="display: flex; align-items: center; gap: 6px;">
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
			<!-- Map Canvas Wrapper (Increased height to 520px with Pan & Zoom controls) -->
			<div style="position: relative; background: #080d1a; border: 1px solid #334155; border-radius: 8px; overflow: hidden; height: 520px;">
				<canvas id="sitrepMapCanvas" style="width: 100%; height: 100%; display: block; cursor: grab;"></canvas>
				
				<!-- Zoom & Pan Overlay Toolbar -->
				<div style="position: absolute; top: 12px; left: 12px; display: flex; flex-direction: column; gap: 4px; z-index: 5;">
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
				<div style="position: absolute; bottom: 8px; left: 8px; font-size: 10px; color: #64748b; font-family: monospace; pointer-events: none; background: rgba(8, 13, 26, 0.7); padding: 2px 6px; border-radius: 3px;">
					WGS84 EPSG:4326 • Drag to Pan • Wheel to Zoom • Dynamic Auto-Fit
				</div>
			</div>
		</div>

		<!-- High-Risk Critical Infrastructure Table -->
		<div class="card" style="margin-bottom: 24px;">
			<h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 700; color: #f8fafc;">Priority Structural Damage & Impact Audit</h3>
			<div style="overflow-x: auto;">
				<table>
					<thead>
						<tr>
							<th>Critical Asset</th>
							<th>Category</th>
							<th style="text-align: right;">Mean Damage Ratio (MDR)</th>
							<th style="text-align: right;">Estimated Loss (USD)</th>
						</tr>
					</thead>
					<tbody>
						${topAssetsRows}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Action Checklist for EOC Watchstanders -->
		<div class="card">
			<h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 700; color: #f8fafc;">EOC Operational Action Directives</h3>
			<ul class="checklist">
				<li>
					<span class="check-icon">1.</span>
					<div>
						<strong>Life Safety & Shelter Mobilization:</strong> Activate municipal reception shelters for an estimated <strong>${(sendai.targetB_AffectedPeople?.estimatedDisplacedPopulation || 0).toLocaleString()}</strong> displaced individuals. Preposition water purification kits and emergency medical tents.
					</div>
				</li>
				<li>
					<span class="check-icon">2.</span>
					<div>
						<strong>Critical Infrastructure Stabilization:</strong> Dispatch structural engineering survey teams and backup generator units to priority healthcare facilities with damage ratios exceeding 25%.
					</div>
				</li>
				<li>
					<span class="check-icon">3.</span>
					<div>
						<strong>OASIS CAP v1.2 Broadcast Verification:</strong> Ensure cell broadcast emergency alerts are disseminated across targeted telecom towers in <strong>${region}</strong>.
					</div>
				</li>
				<li>
					<span class="check-icon">4.</span>
					<div>
						<strong>UNDRR DELTA Reporting:</strong> Submit validated loss assessment draft to the national DELTA Resilience repository for Sendai Monitor compliance.
					</div>
				</li>
			</ul>
		</div>

		<div style="margin-top: 24px; text-align: center; color: #64748b; font-size: 11px;">
			Generated by Disaster Risk Reduction (DRR) Agent Plugin • Conforms to OASIS CAP v1.2 & UN Sendai Framework
		</div>
	</div>

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
			const tileCache = {};

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
					if (a._px != null && Math.hypot(a._px - mx, a._py - my) <= 12) hit = a;
					else if (a._bbox != null && mx >= a._bbox.x && mx <= a._bbox.x + a._bbox.w && my >= a._bbox.y && my <= a._bbox.y + a._bbox.h) hit = a;
				});

				if (hit) {
					tooltip.style.display = 'block';
					tooltipName.textContent = hit.name;
					tooltipDetails.textContent = hit.category.toUpperCase() + ' • MDR: ' + (hit.mdr * 100).toFixed(1) + '% • Est. Loss: $' + (hit.lossUsd || 0).toLocaleString();
					canvas.style.cursor = 'pointer';
				} else {
					tooltip.style.display = 'none';
					canvas.style.cursor = 'grab';
				}
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
				const rect = canvas.getBoundingClientRect();
				canvas.width = rect.width * (window.devicePixelRatio || 1);
				canvas.height = rect.height * (window.devicePixelRatio || 1);
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

				const padX = 180;
				const padY = 70;
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

				// 3. Draw Asset Markers & Collision-Free Badges
				const labelBoxes = [];
				assets.forEach((asset, idx) => {
					const pos = toCanvas(asset.coords[0], asset.coords[1]);
					asset._px = pos.x;
					asset._py = pos.y;
					const isHigh = asset.mdr >= 0.5;
					const isMod = asset.mdr >= 0.25 && asset.mdr < 0.5;
					const color = isHigh ? '#ef4444' : isMod ? '#f97316' : '#22c55e';

					// Outer pulsing halo for high-risk assets
					if (isHigh) {
						ctx.beginPath();
						ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
						ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
						ctx.fill();
					}

					// Pin body
					ctx.beginPath();
					ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
					ctx.fillStyle = color;
					ctx.fill();
					ctx.strokeStyle = '#ffffff';
					ctx.lineWidth = 1.5;
					ctx.stroke();

					// Inner dot
					ctx.beginPath();
					ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
					ctx.fillStyle = '#ffffff';
					ctx.fill();

					// Measure label dimensions
					ctx.font = 'bold 10px sans-serif';
					const nameWidth = ctx.measureText(asset.name).width;
					const badgeW = Math.max(nameWidth + 18, 140);
					const badgeH = 26;

					// Alternating initial placement (above vs below pin)
					let offX = 14;
					let offY = (idx % 2 === 0) ? -34 : 12;

					// Boundary check
					if (pos.x + offX + badgeW > w - 12) offX = -badgeW - 14;
					if (pos.y + offY < 8) offY = 8;
					if (pos.y + offY + badgeH > h - 8) offY = -badgeH - 8;

					let bx = pos.x + offX;
					let by = pos.y + offY;

					// Collision-avoidance nudge against previously placed badges
					for (let step = 0; step < 8; step++) {
						let collides = false;
						for (const box of labelBoxes) {
							if (bx < box.x + box.w + 6 && bx + badgeW + 6 > box.x &&
							    by < box.y + box.h + 6 && by + badgeH + 6 > box.y) {
								collides = true;
								by += badgeH + 6;
								if (by + badgeH > h - 10) {
									by = box.y - badgeH - 6;
								}
								break;
							}
						}
						if (!collides) break;
					}

					const bbox = { x: bx, y: by, w: badgeW, h: badgeH };
					labelBoxes.push(bbox);
					asset._bbox = bbox;

					// Leader line connecting pin to badge
					const anchorX = bx > pos.x ? bx : bx + badgeW;
					const anchorY = by + badgeH / 2;
					ctx.beginPath();
					ctx.moveTo(pos.x, pos.y);
					ctx.lineTo(anchorX, anchorY);
					ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
					ctx.lineWidth = 1;
					ctx.setLineDash([2, 2]);
					ctx.stroke();
					ctx.setLineDash([]);

					// Badge Background
					drawBadge(bx, by, badgeW, badgeH, 4);
					ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
					ctx.fill();
					ctx.strokeStyle = isHigh ? 'rgba(239, 68, 68, 0.6)' : 'rgba(71, 85, 105, 0.9)';
					ctx.lineWidth = 1;
					ctx.stroke();

					// Badge Text Line 1: Asset Name
					ctx.fillStyle = '#f8fafc';
					ctx.font = 'bold 10px sans-serif';
					ctx.textAlign = 'left';
					ctx.fillText(asset.name, bx + 7, by + 11);

					// Badge Text Line 2: Category & MDR
					ctx.fillStyle = color;
					ctx.font = 'bold 9px monospace';
					ctx.fillText((asset.category || 'ASSET').toUpperCase() + ' • MDR ' + (asset.mdr * 100).toFixed(0) + '%', bx + 7, by + 21);
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
