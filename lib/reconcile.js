/**
 * Multi-Source Impact Evidence Reconciliation & SitRep Version Diffing Engine
 *
 * Addresses a core operational DRR requirement: preserving conflicting impact reports
 * from national authorities (e.g., NDRRMC/DDPM/AFAD), sub-national LGUs, humanitarian
 * agencies (OCHA/IFRC), and modelled estimates WITHOUT silently collapsing them into
 * a single unattributed number.
 *
 * Governance & Invariants:
 * - Preserves all source records, timestamps, geographic scope, and evidenceBasis.
 * - Never coerces null/missing values to 0 (R-02).
 * - Never promotes modelled_estimate or media_unverified figures as official reporting.
 * - Explicitly flags conflicts, explains likely discrepancy drivers (reporting lag,
 *   geographic scope, evidence basis), and requires human analyst approval before release.
 * - Computes deterministic SitRep version-to-version deltas with SHA-256 provenance.
 *
 * Pure Node.js standard library only.
 */

const { computeSnapshotHash } = require("./contracts");
const { sanitizeUntrustedFeedText } = require("./security");

const RECONCILE_METHOD_ID = "sitrep.evidence_reconciliation_v1";

const AUTHORITY_TIERS = {
	national_official: {
		rank: 1,
		label: "National Official Authority",
		officialReportingEligible: true,
	},
	subnational_official: {
		rank: 2,
		label: "Sub-National / LGU Official Authority",
		officialReportingEligible: true,
	},
	humanitarian_cluster: {
		rank: 3,
		label: "Humanitarian / UN Cluster Assessment",
		officialReportingEligible: false,
	},
	modelled_estimate: {
		rank: 4,
		label: "Modelled / Screening Estimate",
		officialReportingEligible: false,
	},
	media_unverified: {
		rank: 5,
		label: "Media / Unverified Report",
		officialReportingEligible: false,
	},
};

const VALID_EVIDENCE_BASES = new Set(["confirmed", "estimated", "modelled", "unverified"]);

function normalizeAuthorityTier(raw) {
	const key = String(raw || "media_unverified").toLowerCase().trim();
	if (AUTHORITY_TIERS[key]) return key;
	if (key.includes("national") || key.includes("ndrrmc") || key.includes("ddpm") || key.includes("afad")) {
		return "national_official";
	}
	if (key.includes("lgu") || key.includes("local") || key.includes("provincial") || key.includes("municipal")) {
		return "subnational_official";
	}
	if (key.includes("ocha") || key.includes("un") || key.includes("ifrc") || key.includes("humanitarian") || key.includes("cluster")) {
		return "humanitarian_cluster";
	}
	if (key.includes("model") || key.includes("screen") || key.includes("pager") || key.includes("gdacs")) {
		return "modelled_estimate";
	}
	return "media_unverified";
}

function normalizeEvidenceBasis(raw, authorityTier) {
	const key = String(raw || "").toLowerCase().trim();
	if (VALID_EVIDENCE_BASES.has(key)) return key;
	if (authorityTier === "modelled_estimate") return "modelled";
	if (authorityTier === "media_unverified") return "unverified";
	if (authorityTier === "humanitarian_cluster") return "estimated";
	return "confirmed";
}

function parseTimestampMs(ts) {
	if (!ts) return null;
	if (typeof ts === "number" && Number.isFinite(ts)) return ts;
	const ms = Date.parse(String(ts));
	return Number.isNaN(ms) ? null : ms;
}

function sanitizeText(val) {
	if (val === null || val === undefined) return { text: null, injectionDetected: false };
	const res = sanitizeUntrustedFeedText(String(val));
	if (typeof res === "string") return { text: res, injectionDetected: false };
	return { text: res.text, injectionDetected: Boolean(res.injectionDetected) };
}

/**
 * Reconcile multi-source impact claims without silently dropping conflicting records.
 *
 * @param {Array<object>} claims - Array of impact claim objects:
 *   { source, authorityTier, evidenceBasis, metric, value, unit, reportedAt, pcode, adminArea, geographicScope, notes }
 * @param {object} options - { conflictThresholdPct?: number, eventId?: string }
 * @returns {object} Structured reconciliation report preserving all claims, conflict flags, and provenance
 */
function reconcileImpactClaims(claims = [], options = {}) {
	if (!Array.isArray(claims)) {
		throw new Error("INVALID_INPUT: claims must be an array of impact claim records.");
	}

	const conflictThresholdPct = Number.isFinite(Number(options.conflictThresholdPct))
		? Number(options.conflictThresholdPct)
		: 10;

	const normalizedClaims = claims.map((c, idx) => {
		const authorityTier = normalizeAuthorityTier(c.authorityTier || c.sourceType);
		const evidenceBasis = normalizeEvidenceBasis(c.evidenceBasis, authorityTier);
		const rawVal = c.value;
		const numericValue =
			rawVal === null || rawVal === undefined || rawVal === ""
				? null
				: Number.isFinite(Number(rawVal))
					? Number(rawVal)
					: null;
		const metric = String(c.metric || "unspecified_metric").trim();
		const pcode = c.pcode ? String(c.pcode).trim() : null;
		const sourceSan = sanitizeText(c.source || `unknown_source_${idx + 1}`);
		const areaSan = sanitizeText(c.adminArea || null);
		const scopeSan = sanitizeText(c.geographicScope || null);
		const notesSan = sanitizeText(c.notes || null);
		const adminArea = areaSan.text;
		const geographicScope = scopeSan.text || pcode || adminArea || "event_wide";
		const scopeKey = pcode || adminArea || "event_wide";
		const reportedAt = c.reportedAt || c.timestamp || null;
		const promptInjectionFlagged = Boolean(
			sourceSan.injectionDetected || areaSan.injectionDetected || scopeSan.injectionDetected || notesSan.injectionDetected,
		);

		return {
			claimId: c.claimId || `claim_${idx + 1}`,
			source: sourceSan.text,
			authorityTier,
			authorityRank: AUTHORITY_TIERS[authorityTier].rank,
			officialReportingEligible: AUTHORITY_TIERS[authorityTier].officialReportingEligible,
			evidenceBasis,
			metric,
			value: numericValue,
			unit: c.unit ? String(c.unit).trim() : "count",
			reportedAt,
			reportedAtMs: parseTimestampMs(reportedAt),
			pcode,
			adminArea,
			geographicScope,
			scopeKey,
			notes: notesSan.text,
			promptInjectionFlagged,
		};
	});

	// Group by metric + scopeKey
	const groupMap = new Map();
	for (const claim of normalizedClaims) {
		const key = `${claim.metric}::${claim.scopeKey}`;
		if (!groupMap.has(key)) groupMap.set(key, []);
		groupMap.get(key).push(claim);
	}

	const reconciledMetrics = [];
	let conflictCount = 0;
	let missingOfficialCount = 0;

	for (const [, records] of groupMap.entries()) {
		// Sort by authority rank (1 = highest), then newest timestamp
		const sorted = records.slice().sort((a, b) => {
			if (a.authorityRank !== b.authorityRank) return a.authorityRank - b.authorityRank;
			return (b.reportedAtMs ?? -Infinity) - (a.reportedAtMs ?? -Infinity);
		});

		const numericRecords = sorted.filter((r) => r.value !== null);
		const nullRecordsCount = sorted.length - numericRecords.length;

		let minValue = null;
		let maxValue = null;
		let spreadAbsolute = null;
		let spreadPercent = null;

		if (numericRecords.length > 0) {
			const values = numericRecords.map((r) => r.value);
			minValue = Math.min(...values);
			maxValue = Math.max(...values);
			spreadAbsolute = parseFloat((maxValue - minValue).toFixed(4));
			spreadPercent =
				minValue > 0
					? parseFloat((((maxValue - minValue) / minValue) * 100).toFixed(2))
					: maxValue > 0
						? 100
						: 0;
		}

		const officialNumericRecords = numericRecords.filter(
			(r) => r.officialReportingEligible && (r.evidenceBasis === "confirmed" || r.evidenceBasis === "estimated"),
		);

		let officialDisagreement = false;
		if (officialNumericRecords.length >= 2) {
			const offVals = officialNumericRecords.map((r) => r.value);
			officialDisagreement = Math.max(...offVals) !== Math.min(...offVals);
		}

		const conflictDetected = Boolean(
			(spreadPercent !== null && spreadPercent > conflictThresholdPct && numericRecords.length >= 2) ||
				officialDisagreement,
		);
		if (conflictDetected) conflictCount += 1;

		// Identify likely discrepancy drivers
		const discrepancyDrivers = [];
		if (numericRecords.length >= 2 && spreadAbsolute > 0) {
			const bases = new Set(numericRecords.map((r) => r.evidenceBasis));
			if (bases.size > 1) {
				discrepancyDrivers.push(
					`Mixed evidence bases present (${Array.from(bases).join(", ")}): modelled or estimated figures are not interchangeable with confirmed counts.`,
				);
			}
			const scopes = new Set(numericRecords.map((r) => r.geographicScope));
			if (scopes.size > 1) {
				discrepancyDrivers.push(
					`Geographic scope differences across reports (${Array.from(scopes).join(" vs. ")}).`,
				);
			}
			const times = numericRecords.map((r) => r.reportedAtMs).filter((t) => t !== null);
			if (times.length >= 2) {
				const lagHours = parseFloat(((Math.max(...times) - Math.min(...times)) / 3600000).toFixed(2));
				if (lagHours >= 1) {
					discrepancyDrivers.push(
						`Reporting timestamp lag of ${lagHours} hours between earliest and latest source update.`,
					);
				}
			}
			if (officialDisagreement) {
				discrepancyDrivers.push(
					"Official authorities report different figures (e.g., LGU field tally ahead of national consolidation).",
				);
			}
		}

		const recommendedOfficialReference =
			officialNumericRecords.length > 0
				? {
						claimId: officialNumericRecords[0].claimId,
						source: officialNumericRecords[0].source,
						authorityTier: officialNumericRecords[0].authorityTier,
						evidenceBasis: officialNumericRecords[0].evidenceBasis,
						value: officialNumericRecords[0].value,
						unit: officialNumericRecords[0].unit,
						reportedAt: officialNumericRecords[0].reportedAt,
					}
				: null;

		const officialReportingStatus = recommendedOfficialReference
			? conflictDetected
				? "official_candidate_with_conflict"
				: "official_candidate_available"
			: "no_official_figure_available";

		if (!recommendedOfficialReference) missingOfficialCount += 1;

		reconciledMetrics.push({
			metric: sorted[0].metric,
			scopeKey: sorted[0].scopeKey,
			pcode: sorted[0].pcode,
			adminArea: sorted[0].adminArea,
			unit: sorted[0].unit,
			claimCount: sorted.length,
			nullClaimsPreserved: nullRecordsCount,
			range: {
				minValue,
				maxValue,
				spreadAbsolute,
				spreadPercent,
			},
			conflictDetected,
			officialDisagreement,
			discrepancyDrivers,
			officialReportingStatus,
			recommendedOfficialReference,
			requiresHumanReconciliation: conflictDetected || !recommendedOfficialReference,
			preservedRecords: sorted.map(({ reportedAtMs, ...rest }) => rest),
		});
	}

	const summary = {
		totalClaimsIngested: normalizedClaims.length,
		metricsEvaluated: reconciledMetrics.length,
		conflictCount,
		missingOfficialCount,
		allRecordsPreserved: true,
		requiresHumanApproval: true,
	};

	const snapshotHash = computeSnapshotHash({
		eventId: options.eventId || null,
		summary,
		reconciledMetrics: reconciledMetrics.map((m) => ({
			metric: m.metric,
			scopeKey: m.scopeKey,
			range: m.range,
			conflictDetected: m.conflictDetected,
			officialReportingStatus: m.officialReportingStatus,
		})),
	});

	return {
		method: { id: RECONCILE_METHOD_ID, version: "1.0.0" },
		eventId: options.eventId || null,
		conflictThresholdPct,
		summary,
		reconciledMetrics,
		governance: {
			approvalStatus: "draft",
			verificationStatus: "requires_analyst_review",
			reportingEligibility: conflictCount > 0 || missingOfficialCount > 0 ? "screening_only" : "official_review_ready",
			nonSilentSelectionEnforced: true,
		},
		provenance: {
			reconciledAt: new Date().toISOString(),
			snapshotHash,
			evidenceBasis: "multi_source_reconciled",
		},
	};
}

/**
 * Compute a deterministic version-to-version SitRep diff.
 *
 * @param {object} previousSitRep - { sitrepId, version, issuedAt, metrics: { key: number|null }, affectedAreas?: string[], conflicts?: number }
 * @param {object} currentSitRep - Same schema for the newer SitRep
 * @returns {object} Structured delta report with human-readable changeSummary and provenance hash
 */
function diffSituationReports(previousSitRep = {}, currentSitRep = {}) {
	if (!previousSitRep || typeof previousSitRep !== "object" || !currentSitRep || typeof currentSitRep !== "object") {
		throw new Error("INVALID_INPUT: both previousSitRep and currentSitRep objects are required.");
	}

	const prevTimeMs = parseTimestampMs(previousSitRep.issuedAt || previousSitRep.generatedAt);
	const currTimeMs = parseTimestampMs(currentSitRep.issuedAt || currentSitRep.generatedAt);
	const elapsedHours =
		prevTimeMs !== null && currTimeMs !== null
			? parseFloat(((currTimeMs - prevTimeMs) / 3600000).toFixed(2))
			: null;

	const prevMetrics = previousSitRep.metrics || {};
	const currMetrics = currentSitRep.metrics || {};
	const allKeys = Array.from(new Set([...Object.keys(prevMetrics), ...Object.keys(currMetrics)])).sort();

	const metricDeltas = [];
	const changeSummary = [];

	for (const key of allKeys) {
		const rawPrev = prevMetrics[key];
		const rawCurr = currMetrics[key];
		const prevVal = rawPrev === null || rawPrev === undefined ? null : Number(rawPrev);
		const currVal = rawCurr === null || rawCurr === undefined ? null : Number(rawCurr);

		let absoluteDelta = null;
		let percentChange = null;
		let direction = "unchanged";

		if (prevVal === null && currVal !== null) {
			direction = "newly_reported";
			changeSummary.push(`${key}: newly reported at ${currVal} (previously unreported/null).`);
		} else if (prevVal !== null && currVal === null) {
			direction = "missing_in_current";
			changeSummary.push(`${key}: missing/null in current SitRep (previously ${prevVal}).`);
		} else if (prevVal === null && currVal === null) {
			direction = "both_missing";
		} else {
			absoluteDelta = parseFloat((currVal - prevVal).toFixed(4));
			percentChange =
				prevVal !== 0 ? parseFloat((((currVal - prevVal) / Math.abs(prevVal)) * 100).toFixed(2)) : currVal === 0 ? 0 : null;
			if (absoluteDelta > 0) {
				direction = "increased";
				changeSummary.push(
					`${key}: increased from ${prevVal} to ${currVal} (+${absoluteDelta}${percentChange !== null ? `, +${percentChange}%` : ""}).`,
				);
			} else if (absoluteDelta < 0) {
				direction = "decreased";
				changeSummary.push(
					`${key}: decreased from ${prevVal} to ${currVal} (${absoluteDelta}${percentChange !== null ? `, ${percentChange}%` : ""}).`,
				);
			} else {
				direction = "unchanged";
			}
		}

		metricDeltas.push({
			metric: key,
			previousValue: prevVal,
			currentValue: currVal,
			absoluteDelta,
			percentChange,
			direction,
		});
	}

	const prevAreas = new Set((previousSitRep.affectedAreas || []).map((a) => String(a)));
	const currAreas = new Set((currentSitRep.affectedAreas || []).map((a) => String(a)));
	const addedAreas = Array.from(currAreas).filter((a) => !prevAreas.has(a)).sort();
	const removedAreas = Array.from(prevAreas).filter((a) => !currAreas.has(a)).sort();

	if (addedAreas.length > 0) {
		changeSummary.push(`Affected areas added: ${addedAreas.join(", ")}.`);
	}
	if (removedAreas.length > 0) {
		changeSummary.push(`Affected areas removed/cleared: ${removedAreas.join(", ")}.`);
	}

	const resultBody = {
		versionTransition: {
			previousVersion: previousSitRep.version || previousSitRep.sitrepId || "previous",
			currentVersion: currentSitRep.version || currentSitRep.sitrepId || "current",
			previousIssuedAt: previousSitRep.issuedAt || previousSitRep.generatedAt || null,
			currentIssuedAt: currentSitRep.issuedAt || currentSitRep.generatedAt || null,
			elapsedHours,
		},
		metricDeltas,
		areaChanges: {
			addedAreas,
			removedAreas,
			unchangedCount: Array.from(currAreas).filter((a) => prevAreas.has(a)).length,
		},
		changeCount: metricDeltas.filter((d) => d.direction !== "unchanged" && d.direction !== "both_missing").length +
			addedAreas.length +
			removedAreas.length,
		changeSummary,
	};

	return {
		method: { id: "sitrep.version_diff_v1", version: "1.0.0" },
		...resultBody,
		provenance: {
			comparedAt: new Date().toISOString(),
			snapshotHash: computeSnapshotHash(resultBody),
			evidenceBasis: "derived_comparison",
		},
	};
}

/**
 * Unified SitRep reconciliation & version-diff entry point for MCP/CLI.
 */
function reconcileAndDiffSitRep(input = {}) {
	const hasClaims = Array.isArray(input.claims) && input.claims.length > 0;
	const hasDiff = Boolean(input.previousSitRep && input.currentSitRep);
	if (!hasClaims && !hasDiff) {
		throw new Error("MISSING_REQUIRED_INPUT: Provide 'claims' array and/or both 'previousSitRep' and 'currentSitRep'.");
	}

	const reconciliation = hasClaims ? reconcileImpactClaims(input.claims, input.options || {}) : null;
	const sitrepDiff = hasDiff ? diffSituationReports(input.previousSitRep, input.currentSitRep) : null;

	return {
		mode: hasClaims && hasDiff ? "reconcile_and_diff" : hasClaims ? "reconcile_only" : "diff_only",
		reconciliation,
		sitrepDiff,
		provenance: {
			generatedAt: new Date().toISOString(),
			snapshotHash: computeSnapshotHash({
				reconciliationHash: reconciliation ? reconciliation.provenance.snapshotHash : null,
				diffHash: sitrepDiff ? sitrepDiff.provenance.snapshotHash : null,
			}),
			evidenceBasis: "multi_source_reconciled",
		},
	};
}

module.exports = {
	RECONCILE_METHOD_ID,
	AUTHORITY_TIERS,
	reconcileImpactClaims,
	diffSituationReports,
	reconcileAndDiffSitRep,
};
