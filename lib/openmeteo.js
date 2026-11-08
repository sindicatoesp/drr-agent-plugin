/**
 * Open-Meteo Weather Forecast & Anticipatory Flood Risk Trigger Engine
 * Free, open API (no API key required) for global weather and multi-model ensembles.
 * https://open-meteo.com/
 */

const { CONFIG, fetchJsonWithConfig } = require("./config");

/**
 * Analyze precipitation and wind forecasts to determine early warning triggers
 * @param {object} weatherData - Open-Meteo daily forecast data
 * @returns {object} Early warning risk assessment
 */
function analyzeFloodRisk(weatherData) {
	const daily = weatherData.daily || {};
	const precipSums = daily.precipitation_sum || [];
	const maxWinds = daily.wind_speed_10m_max || daily.windspeed_10m_max || [];
	const dates = daily.time || [];

	let totalPrecipMm = 0;
	let peakDailyPrecipMm = 0;
	let peakPrecipDate = null;
	let peakWindKmh = 0;

	for (let i = 0; i < precipSums.length; i++) {
		const p = parseFloat(precipSums[i] || 0);
		totalPrecipMm += p;
		if (p > peakDailyPrecipMm) {
			peakDailyPrecipMm = p;
			peakPrecipDate = dates[i] || `Day ${i + 1}`;
		}
	}

	for (const w of maxWinds) {
		const speed = parseFloat(w || 0);
		if (speed > peakWindKmh) peakWindKmh = speed;
	}

	// Determine Anticipatory Action Early Warning Level
	let floodRiskLevel = "Low";
	let floodAlertColor = "Green";
	let estimatedInundationDepthM = 0;

	if (totalPrecipMm >= 200 || peakDailyPrecipMm >= 100) {
		floodRiskLevel = "Extreme Flash Flood & River Inundation Trigger";
		floodAlertColor = "Red";
		estimatedInundationDepthM = 1.5 + (totalPrecipMm - 200) * 0.005;
	} else if (totalPrecipMm >= 90 || peakDailyPrecipMm >= 50) {
		floodRiskLevel = "Moderate Waterlogging & Localized Inundation";
		floodAlertColor = "Orange";
		estimatedInundationDepthM = 0.4 + (totalPrecipMm - 90) * 0.008;
	} else if (totalPrecipMm >= 40) {
		floodRiskLevel = "Minor Drainage Alert";
		floodAlertColor = "Yellow";
		estimatedInundationDepthM = 0.1;
	}

	return {
		totalForecastPrecipitationMm: parseFloat(totalPrecipMm.toFixed(1)),
		peakDailyPrecipitationMm: parseFloat(peakDailyPrecipMm.toFixed(1)),
		peakPrecipitationDate: peakPrecipDate,
		peakWindSpeedKmh: parseFloat(peakWindKmh.toFixed(1)),
		anticipatoryAction: {
			riskLevel: floodRiskLevel,
			alertColor: floodAlertColor,
			triggerThresholdMet: floodAlertColor === "Red" || floodAlertColor === "Orange",
			estimatedInundationDepthMeters: parseFloat(estimatedInundationDepthM.toFixed(2)),
			recommendedEarlyAction:
				floodAlertColor === "Red"
					? "Pre-position water purification units and trigger evacuation advisories for low-lying settlements."
					: floodAlertColor === "Orange"
						? "Alert municipal drainage crews and place emergency shelters on standby."
						: "Routine monitoring; no pre-disaster protocol triggers exceeded.",
		},
		dailyBreakdown: dates.map((date, idx) => ({
			date,
			precipitationMm: precipSums[idx] || 0,
			maxWindKmh: maxWinds[idx] || 0,
		})),
	};
}

/**
 * Fetch and analyze weather forecast for a coordinate
 * @param {object} params - { latitude, longitude, days, samplePayload }
 */
async function fetchWeatherForecast(params = {}) {
	if (params.samplePayload) {
		const payload =
			typeof params.samplePayload === "string"
				? JSON.parse(params.samplePayload)
				: params.samplePayload;
		return analyzeFloodRisk(payload);
	}

	const lat = params.latitude || 23.8;
	const lon = params.longitude || 90.4;
	const days = params.days || 5;

	const url = `${CONFIG.OPENMETEO_API_URL}?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,wind_speed_10m_max&forecast_days=${days}&timezone=auto`;

	try {
		const data = await fetchJsonWithConfig(url);
		return analyzeFloodRisk(data);
	} catch (err) {
		throw new Error(`Open-Meteo query failed (${err.message}). Use samplePayload for offline operations.`);
	}
}

module.exports = {
	OPENMETEO_API_URL: CONFIG.OPENMETEO_API_URL,
	analyzeFloodRisk,
	fetchWeatherForecast,
};
