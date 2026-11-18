/**
 * Multi-Source Event Identity, Deduplication, Revision Tracking,
 * and Cascading Linkage Module (R-10, C-08)
 *
 * Enforces explicit semantic distinction between:
 * - exact_external_id_match / source_revision_update (same source + externalId)
 * - possible_duplicate (cross-source spatiotemporal similarity -> requires human review)
 * - cascading_candidate / related_event (different hazard family overlap -> NEVER infers causal trigger from overlap alone)
 * - unique_new_event
 *
 * Preserves multi-source provenance and reversible merge history.
 * Pure Node.js standard library only.
 */

const crypto = require("crypto");
const { haversineDistance } = require("./utils");

const CASCADING_HAZARD_PAIRS = new Set([
	"earthquake::tsunami",
	"earthquake::landslide",
	"earthquake::liquefaction",
	"wind::flood",
	"cyclone::flood",
	"tropical_cyclone::flood",
	"cyclone::landslide",
	"volcano::tsunami",
	"volcano::landslide",
]);

function normalizeHazardFamily(event = {}) {
	const raw = String(
		event.hazardType || event.eventType || event.eventTypeLabel || event.type || "unknown",
	)
		.toLowerCase()
		.trim();
	if (raw === "eq" || raw.includes("earth") || raw.includes("seismic")) return "earthquake";
	if (raw === "fl" || raw.includes("flood")) return "flood";
	if (raw === "tc" || raw.includes("cyclone") || raw.includes("wind") || raw.includes("typhoon") || raw.includes("hurricane")) return "cyclone";
	if (raw === "vo" || raw.includes("volcan")) return "volcano";
	if (raw.includes("tsunami")) return "tsunami";
	if (raw.includes("landslide") || raw.includes("mudslide")) return "landslide";
	if (raw === "dr" || raw.includes("drought")) return "drought";
	if (raw === "wf" || raw.includes("wildfire") || raw.includes("fire")) return "wildfire";
	return raw;
}

function extractCoordinates(event = {}) {
	if (Array.isArray(event.coordinates) && event.coordinates.length >= 2) {
		return [Number(event.coordinates[0]), Number(event.coordinates[1])];
	}
	if (event.geometry?.type === "Point" && Array.isArray(event.geometry.coordinates)) {
		return [Number(event.geometry.coordinates[0]), Number(event.geometry.coordinates[1])];
	}
	if (Number.isFinite(Number(event.longitude)) && Number.isFinite(Number(event.latitude))) {
		return [Number(event.longitude), Number(event.latitude)];
	}
	return null;
}

function extractTimestampMs(event = {}) {
	const candidate = event.updatedAt || event.timestamp || event.startDate || event.time;
	if (!candidate) return null;
	if (typeof candidate === "number") return candidate;
	const parsed = Date.parse(candidate);
	return Number.isNaN(parsed) ? null : parsed;
}

function buildCanonicalExternalKey(event = {}) {
	const source = String(event.source || "unknown").toUpperCase().trim();
	const extId = event.externalId || event.eventId || event.id || null;
	if (!extId) return null;
	// Avoid double prefix if id already starts with source prefix like usgs_
	const cleanedId = String(extId).trim();
	return {
		source,
		externalId: cleanedId,
		compositeKey: `${source}::${cleanedId}`,
	};
}

/**
 * Evaluate event identity & deduplicate/classify an incoming event list against existing catalog
 * @param {Array<object>} incomingEvents - Incoming normalized events
 * @param {Array<object>} existingCatalog - Existing event records
 * @param {object} options - { spatialRadiusKm?: number, timeWindowHours?: number, allowAutoMergeExactId?: boolean }
 * @returns {object} Deduplication, revision tracking, and linkage report with reversible history
 */
function matchAndDeduplicateEvents(incomingEvents = [], existingCatalog = [], options = {}) {
	const spatialRadiusKm = options.spatialRadiusKm ?? 100;
	const timeWindowHours = options.timeWindowHours ?? 24;
	const allowAutoMergeExactId = options.allowAutoMergeExactId !== false;

	const catalog = existingCatalog.map((e, idx) => ({
		canonicalId: e.canonicalId || e.id || `cat_${idx + 1}`,
		externalKeys: Array.isArray(e.externalKeys)
			? [...e.externalKeys]
			: buildCanonicalExternalKey(e)
				? [buildCanonicalExternalKey(e).compositeKey]
				: [],
		sources: Array.isArray(e.sources) ? [...e.sources] : [e.source || "unknown"],
		hazardFamily: normalizeHazardFamily(e),
		coordinates: extractCoordinates(e),
		timestampMs: extractTimestampMs(e),
		revision: e.revision || 1,
		event: e,
	}));

	const decisions = [];
	const mergeHistory = [];
	const possibleDuplicates = [];
	const cascadingCandidates = [];

	for (let i = 0; i < incomingEvents.length; i++) {
		const inc = incomingEvents[i] || {};
		const extInfo = buildCanonicalExternalKey(inc);
		const incFamily = normalizeHazardFamily(inc);
		const incCoords = extractCoordinates(inc);
		const incTimeMs = extractTimestampMs(inc);

		// 1. Exact source + externalId match -> revision update or exact duplicate
		let exactMatch = null;
		if (extInfo) {
			exactMatch = catalog.find((c) => c.externalKeys.includes(extInfo.compositeKey));
		}

		if (exactMatch) {
			const isNewerRevision =
				(incTimeMs !== null && exactMatch.timestampMs !== null && incTimeMs > exactMatch.timestampMs) ||
				(inc.revision && inc.revision > exactMatch.revision);

			const decisionId = `dec_${crypto.randomBytes(5).toString("hex")}`;
			if (isNewerRevision && allowAutoMergeExactId) {
				const prevSnapshot = JSON.parse(JSON.stringify(exactMatch));
				exactMatch.revision = (exactMatch.revision || 1) + 1;
				exactMatch.timestampMs = incTimeMs || exactMatch.timestampMs;
				exactMatch.event = { ...exactMatch.event, ...inc, revision: exactMatch.revision };
				mergeHistory.push({
					decisionId,
					classification: "source_revision_update",
					reversible: true,
					targetCanonicalId: exactMatch.canonicalId,
					previousState: prevSnapshot,
					appliedEvent: inc,
					timestamp: new Date().toISOString(),
				});
			}

			decisions.push({
				decisionId,
				incomingIndex: i,
				incomingId: extInfo?.externalId || inc.id || null,
				classification: isNewerRevision ? "source_revision_update" : "exact_external_id_match",
				matchedCanonicalId: exactMatch.canonicalId,
				autoMerged: allowAutoMergeExactId,
				requiresHumanReview: false,
				causalLinkVerified: false,
				rationale: isNewerRevision
					? `Matched exact external identifier ${extInfo.compositeKey} with newer timestamp/revision (updated revision ${exactMatch.revision}).`
					: `Matched exact external identifier ${extInfo.compositeKey}; already recorded without duplication.`,
			});
			continue;
		}

		// 2. Spatiotemporal comparison across catalog for possible duplicates OR cascading candidates
		const dupCandidates = [];
		const cascadeMatches = [];

		for (const existing of catalog) {
			let distanceKm = null;
			if (incCoords && existing.coordinates) {
				distanceKm = parseFloat(
					haversineDistance(
						incCoords[1],
						incCoords[0],
						existing.coordinates[1],
						existing.coordinates[0],
					).toFixed(2),
				);
			}
			let timeDiffHours = null;
			if (incTimeMs !== null && existing.timestampMs !== null) {
				timeDiffHours = parseFloat((Math.abs(incTimeMs - existing.timestampMs) / 3600000).toFixed(2));
			}

			const withinSpace = distanceKm !== null && distanceKm <= spatialRadiusKm;
			const withinTime = timeDiffHours !== null && timeDiffHours <= timeWindowHours;

			if (withinSpace && withinTime) {
				if (incFamily === existing.hazardFamily) {
					dupCandidates.push({
						canonicalId: existing.canonicalId,
						sources: existing.sources,
						distanceKm,
						timeDiffHours,
						similarityBasis: "spatiotemporal_same_hazard_family",
					});
				} else {
					const pairForward = `${existing.hazardFamily}::${incFamily}`;
					const pairReverse = `${incFamily}::${existing.hazardFamily}`;
					const knownPhysicalSequence =
						CASCADING_HAZARD_PAIRS.has(pairForward) || CASCADING_HAZARD_PAIRS.has(pairReverse);

					const explicitCausalEvidence = Boolean(
						inc.triggeringEventId &&
						(inc.triggeringEventId === existing.canonicalId || existing.externalKeys.includes(inc.triggeringEventId)),
					);

					cascadeMatches.push({
						relatedCanonicalId: existing.canonicalId,
						relatedHazardFamily: existing.hazardFamily,
						incomingHazardFamily: incFamily,
						distanceKm,
						timeDiffHours,
						knownPhysicalSequence,
						// C-08: Never infer causal triggering solely from space/time overlap!
						relationType: explicitCausalEvidence ? "documented_causal_trigger" : "cascading_candidate",
						causalLinkVerified: explicitCausalEvidence,
						note: explicitCausalEvidence
							? "Explicitly linked via documented triggeringEventId."
							: "Spatiotemporal overlap across different hazard families does NOT prove causal triggering; verify geophysical linkage manually.",
					});
				}
			}
		}

		if (dupCandidates.length > 0) {
			const decisionId = `dec_${crypto.randomBytes(5).toString("hex")}`;
			const entry = {
				decisionId,
				incomingIndex: i,
				incomingId: extInfo?.externalId || inc.id || null,
				incomingSource: inc.source || "unknown",
				classification: "possible_duplicate",
				autoMerged: false,
				requiresHumanReview: true,
				candidateMatches: dupCandidates,
				relatedEvents: cascadeMatches,
				rationale:
					"Cross-source spatiotemporal similarity detected; held for human confirmation rather than auto-merged to avoid conflating separate events or aftershocks.",
			};
			decisions.push(entry);
			possibleDuplicates.push(entry);
			if (cascadeMatches.length > 0) cascadingCandidates.push(...cascadeMatches);
			continue;
		}

		// 3. Unique new event (optionally carrying cascading_candidate links)
		const newCanonicalId = extInfo ? `evt_${extInfo.source.toLowerCase()}_${extInfo.externalId}` : `evt_${i}_${Date.now()}`;
		const newCatalogEntry = {
			canonicalId: newCanonicalId,
			externalKeys: extInfo ? [extInfo.compositeKey] : [],
			sources: [inc.source || "unknown"],
			hazardFamily: incFamily,
			coordinates: incCoords,
			timestampMs: incTimeMs,
			revision: 1,
			event: { ...inc, canonicalId: newCanonicalId },
		};
		catalog.push(newCatalogEntry);

		if (cascadeMatches.length > 0) {
			cascadingCandidates.push(...cascadeMatches);
		}

		decisions.push({
			decisionId: `dec_${crypto.randomBytes(5).toString("hex")}`,
			incomingIndex: i,
			incomingId: extInfo?.externalId || inc.id || null,
			classification: cascadeMatches.length > 0 ? "unique_with_cascading_candidates" : "unique_new_event",
			canonicalId: newCanonicalId,
			autoMerged: false,
			requiresHumanReview: cascadeMatches.length > 0,
			relatedEvents: cascadeMatches,
			causalLinkVerified: cascadeMatches.some((c) => c.causalLinkVerified),
			rationale:
				cascadeMatches.length > 0
					? "Registered distinct event and flagged nearby distinct-hazard event(s) as unverified cascading candidates."
					: "Registered unique new event in canonical event ledger.",
		});
	}

	return {
		totalIncoming: incomingEvents.length,
		catalogSize: catalog.length,
		decisions,
		possibleDuplicates,
		cascadingCandidates,
		mergeHistory,
		catalog,
	};
}

/**
 * Revert a recorded merge/revision decision in the ledger cleanly (R-10 reversibility)
 */
function revertEventDecision(ledger, decisionId) {
	if (!ledger || !Array.isArray(ledger.mergeHistory)) {
		throw new Error("Invalid event ledger: missing mergeHistory.");
	}
	const idx = ledger.mergeHistory.findIndex((m) => m.decisionId === decisionId);
	if (idx === -1) {
		throw new Error(`Merge decision '${decisionId}' not found in ledger mergeHistory.`);
	}
	const record = ledger.mergeHistory[idx];
	if (!record.reversible) {
		throw new Error(`Decision '${decisionId}' is marked irreversible.`);
	}
	const updatedCatalog = ledger.catalog.map((c) =>
		c.canonicalId === record.targetCanonicalId ? record.previousState : c,
	);
	return {
		...ledger,
		catalog: updatedCatalog,
		revertedDecisionIds: [...(ledger.revertedDecisionIds || []), decisionId],
		mergeHistory: ledger.mergeHistory.filter((_, i) => i !== idx),
	};
}

module.exports = {
	CASCADING_HAZARD_PAIRS,
	normalizeHazardFamily,
	matchAndDeduplicateEvents,
	revertEventDecision,
};
