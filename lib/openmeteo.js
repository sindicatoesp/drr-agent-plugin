/**
 * Open-Meteo Weather Forecast & Anticipatory Rainfall Trigger Screening Engine
 * (R-12, C-03, C-05)
 *
 * IMPORTANT SCIENTIFIC SCOPE (C-05):
 * This module performs meteorological rainfall-threshold screening ONLY.
 * It NEVER fabricates flood inundation depths (meters) from accumulated rainfall (mm).
 * When no validated hydrological/hydraulic depth source is supplied, depth is reported
 * explicitly as null / "depth_unavailable".
 *
 * Operational trigger activation requires an approved local FbF/anticipatory-action
 * triggerPolicy (with explicit policyId and thresholds) and, when multiple runs are
 * evaluated, forecast persistence across runs.
 */

const { CONFIG, fetchJsonWithConfig } = require("./config");
const { getRegisteredMethod } = require("./registry");
const { createProvenanceManifest } = require("./contracts");

/**
 * Evaluate forecast persistence across distinct model runs / issue times
 * @param {Array<object>} runs - Array of { issueTime, modelRun, exceedance: boolean, metricValue?: number }
 * @param {object} options - { requiredConsecutiveRuns?: number, minimumAgreementFraction?: number }
 * @returns {object} Persistence assessment
 */
function checkForecastPersistence(runs = [], options = {}) {
	if (!Array.isArray(runs) || runs.length === 0) {
		return {
			evaluatedRuns: 0,
			persistent: false,
			reason: "No historical or consecutive forecast runs provided for persistence check.",
		};
	}

	const requiredConsecutive = options.requiredConsecutiveRuns || 2;
	// Deduplicate by issueTime + modelRun so identical snapshots aren't double-counted
	const seenKeys = new Set();
	const uniqueRuns = [];
	for (const r of runs) {
		const key = `${r.modelRun || "default"}::${r.issueTime || "unknown"}`;
		if (!seenKeys.has(key)) {
			seenKeys.add(key);
			uniqueRuns.push(r);
		}
	}

	// Sort chronologically by issueTime if parseable
	uniqueRuns.sort((a, b) => (Date.parse(a.issueTime || 0) || 0) - (Date.parse(b.issueTime || 0) || 0));

	let consecutiveExceedances = 0;
	let maxConsecutive = 0;
	let totalExceedances = 0;
	for (const r of uniqueRuns) {
		if (r.exceedance === true) {
			consecutiveExceedances++;
			totalExceedances++;
			if (consecutiveExceedances > maxConsecutive) maxConsecutive = consecutiveExceedances;
		} else {
			consecutiveExceedances = 0;
		}
	}

	const persistent = uniqueRuns.length >= requiredConsecutive && maxConsecutive >= requiredConsecutive;
	return {
		evaluatedRuns: uniqueRuns.length,
		distinctRunKeys: Array.from(seenKeys),
		exceedanceRuns: totalExceedances,
		maxConsecutiveExceedances: maxConsecutive,
		requiredConsecutiveRuns: requiredConsecutive,
		persistent,
		reason: persistent
			? `Forecast threshold exceeded across ${maxConsecutive} consecutive distinct model runs.`
			: `Persistence criterion not met (need ${requiredConsecutive} consecutive distinct runs with exceedance; observed ${maxConsecutive} across ${uniqueRuns.length} distinct runs).`,
	};
}

/**
 * Screen precipitation and wind forecasts for anticipatory rainfall signals.
 * Never fabricates inundation depth from rainfall totals.
 *
 * @param {object} weatherData - Open-Meteo daily forecast data
 * @param {object} options - Optional { triggerPolicy, previousRuns, validatedDepthSource, retrievedAt }
 * @returns {object} Early warning screening assessment
 */
function analyzeFloodRisk(weatherData = {}, options = {}) {
	if (!weatherData || typeof weatherData !== "object" || !weatherData.daily) {
		throw new Error("INVALID_FORECAST_INPUT: weatherData.daily is required.");
	}

	const daily = weatherData.daily || {};
	const precipSums = daily.precipitation_sum || [];
	const maxWinds = daily.wind_speed_10m_max || daily.windspeed_10m_max || [];
	const dates = daily.time || [];

	let totalPrecipMm = 0;
	let peakDailyPrecipMm = 0;
	let peakPrecipDate = null;
	let peakWindKmh = 0;

	for (let i = 0; i < precipSums.length; i++) {
		const rawP = precipSums[i];
		const p = rawP === null || rawP === undefined ? 0 : parseFloat(rawP);
		if (Number.isFinite(p)) {
			totalPrecipMm += p;
			if (p > peakDailyPrecipMm) {
				peakDailyPrecipMm = p;
				peakPrecipDate = dates[i] || `Day ${i + 1}`;
			}
		}
	}

	for (const w of maxWinds) {
		const speed = parseFloat(w || 0);
		if (Number.isFinite(speed) && speed > peakWindKmh) peakWindKmh = speed;
	}

	const policy = options.triggerPolicy || weatherData.triggerPolicy || null;
	const redTotalThreshold = policy?.redTotalPrecipMm ?? 200;
	const redDailyThreshold = policy?.redDailyPrecipMm ?? 100;
	const orangeTotalThreshold = policy?.orangeTotalPrecipMm ?? 90;
	const orangeDailyThreshold = policy?.orangeDailyPrecipMm ?? 50;
	const yellowTotalThreshold = policy?.yellowTotalPrecipMm ?? 40;

	// Categorical meteorological screening signal only
	let floodRiskLevel = "Low";
	let floodAlertColor = "Green";

	if (totalPrecipMm >= redTotalThreshold || peakDailyPrecipMm >= redDailyThreshold) {
		floodRiskLevel = "High Meteorological Rainfall Screening Signal";
		floodAlertColor = "Red";
	} else if (totalPrecipMm >= orangeTotalThreshold || peakDailyPrecipMm >= orangeDailyThreshold) {
		floodRiskLevel = "Moderate Meteorological Rainfall Screening Signal";
		floodAlertColor = "Orange";
	} else if (totalPrecipMm >= yellowTotalThreshold) {
		floodRiskLevel = "Minor Meteorological Rainfall Advisory";
		floodAlertColor = "Yellow";
	}

	const screeningSignalMet = floodAlertColor === "Red" || floodAlertColor === "Orange";

	// Forecast metadata & timing provenance (R-12)
	const meta = weatherData.forecastMetadata || options.forecastMetadata || {};
	const issueTime = meta.issueTime || weatherData.generationtime_ms_timestamp || null;
	const validTimeStart = meta.validTimeStart || dates[0] || null;
	const validTimeEnd = meta.validTimeEnd || (dates.length > 0 ? dates[dates.length - 1] : null);
	let leadTimeHours = meta.leadTimeHours ?? null;
	if (leadTimeHours === null && issueTime && validTimeStart) {
		const diff = (Date.parse(validTimeStart) - Date.parse(issueTime)) / 3600000;
		if (Number.isFinite(diff)) leadTimeHours = parseFloat(diff.toFixed(1));
	}

	const forecastMetadata = {
		issueTime,
		validTimeStart,
		validTimeEnd,
		leadTimeHours,
		modelRun: meta.modelRun || weatherData.modelRun || null,
		ensembleMembers: meta.ensembleMembers || null,
		calibrationMetadata: meta.calibrationMetadata || null,
	};

	// Optional persistence check across consecutive distinct runs
	const previousRuns = Array.isArray(options.previousRuns) ? options.previousRuns : null;
	const persistenceCheck = previousRuns
		? checkForecastPersistence(
				[
					...previousRuns,
					{
						issueTime: forecastMetadata.issueTime || new Date().toISOString(),
						modelRun: forecastMetadata.modelRun || "current",
						exceedance: screeningSignalMet,
						metricValue: totalPrecipMm,
					},
				],
				{ requiredConsecutiveRuns: policy?.requiredConsecutiveRuns || 2 },
			)
		: null;

	const hasApprovedPolicy = Boolean(policy && policy.approved === true && policy.policyId);
	const persistenceSatisfied = persistenceCheck ? persistenceCheck.persistent : !policy?.requirePersistence;
	const triggerActivated = Boolean(hasApprovedPolicy && screeningSignalMet && persistenceSatisfied);

	// C-05: Never fabricate inundation depth from rainfall alone
	const validatedDepth = options.validatedDepthSource || null;
	const hasValidatedDepth = Boolean(
		validatedDepth &&
		typeof validatedDepth.depthMeters === "number" &&
		Number.isFinite(validatedDepth.depthMeters) &&
		validatedDepth.source,
	);

	const regMethod = getRegisteredMethod("screening.openmeteo.rainfall_trigger");
	const warnings = [];
	if (!hasValidatedDepth) {
		warnings.push({
			code: "INUNDATION_DEPTH_UNAVAILABLE",
			field: "estimatedInundationDepthMeters",
			message: "No validated hydraulic/hydrological depth source supplied. Rainfall totals cannot establish flood inundation depth.",
		});
	}
	if (!hasApprovedPolicy) {
		warnings.push({
			code: "SCREENING_POLICY_NOT_CONFIGURED",
			field: "triggerPolicy",
			message: "Thresholds shown are illustrative screening levels only; formal trigger activation requires an approved local FbF triggerPolicy.",
		});
	}
	if (!forecastMetadata.issueTime || !forecastMetadata.modelRun) {
		warnings.push({
			code: "INCOMPLETE_FORECAST_METADATA",
			field: "forecastMetadata",
			message: "Forecast payload lacks explicit issueTime or modelRun identifier; persistence and lead-time checks may be limited.",
		});
	}

	const provenance = createProvenanceManifest({
		sourceIds: ["open-meteo-forecast"],
		sourceIssuedAt: forecastMetadata.issueTime,
		retrievedAt: options.retrievedAt || new Date().toISOString(),
		inputsSnapshot: {
			dates,
			precipSums,
			maxWinds,
			policyId: policy?.policyId || null,
		},
		method: {
			id: regMethod.id,
			version: regMethod.version,
			parameterSetId: policy?.policyId || "illustrative_global_screening_thresholds",
			references: [regMethod.sourceUrl],
		},
		evidenceBasis: "modelled",
		verificationStatus: "unreviewed",
		approvalStatus: "draft",
		assumptions: [
			"Precipitation totals represent grid-cell NWP forecast values and not basin-calibrated runoff or hydraulic water depth.",
		],
		limitations: regMethod.limitations,
	});

	return {
		assessmentKind: "meteorological_rainfall_screening",
		totalForecastPrecipitationMm: parseFloat(totalPrecipMm.toFixed(1)),
		peakDailyPrecipitationMm: parseFloat(peakDailyPrecipMm.toFixed(1)),
		peakPrecipitationDate: peakPrecipDate,
		peakWindSpeedKmh: parseFloat(peakWindKmh.toFixed(1)),
		forecastMetadata,
		persistenceCheck,
		anticipatoryAction: {
			riskLevel: floodRiskLevel,
			alertColor: floodAlertColor,
			// Backwards-compatible flag indicating screening threshold exceedance; NOT formal trigger activation
			triggerThresholdMet: screeningSignalMet,
			triggerActivated,
			triggerStatus: triggerActivated
				? "policy_trigger_activated"
				: hasApprovedPolicy
					? "below_policy_threshold_or_not_persistent"
					: "screening_only_requires_local_policy",
			triggerPolicyId: policy?.policyId || null,
			depthStatus: hasValidatedDepth ? "validated_depth_source" : "depth_unavailable",
			estimatedInundationDepthMeters: hasValidatedDepth
				? parseFloat(validatedDepth.depthMeters.toFixed(2))
				: null,
			depthSource: hasValidatedDepth ? validatedDepth.source : null,
			depthExplanation: hasValidatedDepth
				? `Inundation depth supplied by validated external source '${validatedDepth.source}'.`
				: "Depth unavailable: rainfall-threshold screening does not model hydraulic inundation depth.",
			recommendedEarlyAction:
				floodAlertColor === "Red"
					? "Meteorological screening threshold exceeded; review basin river discharge, validated flood models, and approved national SOPs before activating pre-disaster protocols."
					: floodAlertColor === "Orange"
						? "Moderate meteorological rainfall signal; continue hydrological monitoring and inspect drainage readiness under local SOPs."
						: "Routine monitoring; no meteorological screening thresholds exceeded.",
		},
		dailyBreakdown: dates.map((date, idx) => ({
			date,
			precipitationMm: precipSums[idx] ?? null,
			maxWindKmh: maxWinds[idx] ?? null,
		})),
		provenance,
		evidenceBasis: provenance.governance.evidenceBasis,
		verificationStatus: provenance.governance.verificationStatus,
		approvalStatus: provenance.governance.approvalStatus,
		reportingEligibility: provenance.governance.reportingEligibility,
		warnings,
	};
}

/**
 * Fetch and analyze weather forecast for a coordinate
 * @param {object} params - { latitude, longitude, days, samplePayload, triggerPolicy, previousRuns }
 */
async function fetchWeatherForecast(params = {}) {
	const retrievedAt = new Date().toISOString();
	if (params.samplePayload) {
		const payload =
			typeof params.samplePayload === "string"
				? JSON.parse(params.samplePayload)
				: params.samplePayload;
		return analyzeFloodRisk(payload, {
			triggerPolicy: params.triggerPolicy,
			previousRuns: params.previousRuns,
			validatedDepthSource: params.validatedDepthSource,
			retrievedAt,
		});
	}

	const lat = params.latitude;
	const lon = params.longitude;
	if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
		throw new Error("MISSING_REQUIRED_INPUT: latitude and longitude are required when samplePayload is omitted.");
	}
	const days = params.days || 5;

	const url = `${CONFIG.OPENMETEO_API_URL}?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,wind_speed_10m_max&forecast_days=${days}&timezone=auto`;

	try {
		const data = await fetchJsonWithConfig(url);
		return analyzeFloodRisk(data, {
			triggerPolicy: params.triggerPolicy,
			previousRuns: params.previousRuns,
			validatedDepthSource: params.validatedDepthSource,
			retrievedAt,
		});
	} catch (err) {
		throw new Error(`Open-Meteo query failed (${err.message}). Use samplePayload for offline operations.`);
	}
}

module.exports = {
	OPENMETEO_API_URL: CONFIG.OPENMETEO_API_URL,
	checkForecastPersistence,
	analyzeFloodRisk,
	fetchWeatherForecast,
};
