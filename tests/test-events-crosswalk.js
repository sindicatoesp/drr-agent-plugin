const assert = require("assert");
const { crosswalkHazard, HIP_TAXONOMY_VERSION } = require("../lib/hips");
const { matchAndDeduplicateEvents, revertEventDecision, normalizeHazardFamily } = require("../lib/events");

console.log("Testing Versioned HIP Crosswalk & Multi-Source Event Identity/Deduplication (R-09, R-10, C-08)...");

// --- R-09: Versioned HIP Crosswalk ---
const gdacsEq = crosswalkHazard("EQ", { sourceSystem: "GDACS" });
assert.strictEqual(gdacsEq.status, "resolved_exact");
assert.strictEqual(gdacsEq.autoMatched, true);
assert.strictEqual(gdacsEq.mapping.code, "GH0001");
assert.strictEqual(gdacsEq.taxonomyVersion, HIP_TAXONOMY_VERSION);

// Broad external code returns candidates requiring hydrologist review
const gdacsFl = crosswalkHazard("FL", { sourceSystem: "GDACS" });
assert.strictEqual(gdacsFl.status, "candidates_require_review");
assert.strictEqual(gdacsFl.autoMatched, false);
assert.strictEqual(gdacsFl.requiresHumanConfirmation, true);
assert(gdacsFl.candidates.length >= 2);
assert(gdacsFl.hip2025ReviewNote, "Should carry 2025 HIP subtype review note");

// Free-text query must NOT silently auto-match authoritatively
const freeText = crosswalkHazard("severe coastal storm surge and river flooding");
assert.strictEqual(freeText.status, "candidates_require_review");
assert.strictEqual(freeText.autoMatched, false);
assert.strictEqual(freeText.requiresHumanConfirmation, true);
assert(freeText.candidates.length >= 1);

// Unknown structured code must stay unresolved
const unknownCode = crosswalkHazard("ZZ9999");
assert.strictEqual(unknownCode.status, "unresolved");
assert.strictEqual(unknownCode.mapping, null);
assert.strictEqual(unknownCode.candidates.length, 0);

// --- R-10 & C-08: Multi-Source Event Identity, Revisions, Ambiguous Duplicates & Non-Causal Linkage ---
assert.strictEqual(normalizeHazardFamily({ eventType: "EQ" }), "earthquake");
assert.strictEqual(normalizeHazardFamily({ eventType: "TC" }), "cyclone");

const catalog = [
	{
		canonicalId: "cat_eq_1",
		source: "USGS",
		externalId: "us7000eq1",
		hazardType: "earthquake",
		coordinates: [141.0, 38.0],
		updatedAt: "2026-11-10T01:00:00Z",
		revision: 1,
	},
];

// 1. Exact external ID duplicate vs newer revision update
const revResult = matchAndDeduplicateEvents(
	[
		{
			source: "USGS",
			externalId: "us7000eq1",
			hazardType: "earthquake",
			coordinates: [141.0, 38.0],
			updatedAt: "2026-11-10T01:00:00Z",
		},
		{
			source: "USGS",
			externalId: "us7000eq1",
			hazardType: "earthquake",
			coordinates: [141.02, 38.01],
			updatedAt: "2026-11-10T03:00:00Z",
			revision: 2,
		},
	],
	catalog,
);
assert.strictEqual(revResult.decisions[0].classification, "exact_external_id_match");
assert.strictEqual(revResult.decisions[1].classification, "source_revision_update");
assert.strictEqual(revResult.mergeHistory.length, 1);

// Reverting the revision restores revision 1 state cleanly
const reverted = revertEventDecision(revResult, revResult.mergeHistory[0].decisionId);
assert.strictEqual(reverted.catalog[0].revision, 1);
assert.strictEqual(reverted.revertedDecisionIds.length, 1);

// 2. Cross-source similar earthquake held as possible_duplicate (never auto-merged)
const crossSource = matchAndDeduplicateEvents(
	[
		{
			source: "GDACS",
			externalId: "gdacs_eq_999",
			hazardType: "EQ",
			coordinates: [141.08, 38.05], // ~9km away, 2h later
			timestamp: "2026-11-10T03:00:00Z",
		},
	],
	catalog,
	{ spatialRadiusKm: 100, timeWindowHours: 24 },
);
assert.strictEqual(crossSource.possibleDuplicates.length, 1);
assert.strictEqual(crossSource.decisions[0].classification, "possible_duplicate");
assert.strictEqual(crossSource.decisions[0].autoMerged, false);
assert.strictEqual(crossSource.decisions[0].requiresHumanReview, true);

// 3. Different-hazard overlap (e.g. tsunami near earthquake) flagged as cascading_candidate without causal claim
const cascadeRes = matchAndDeduplicateEvents(
	[
		{
			source: "GDACS",
			externalId: "gdacs_ts_01",
			hazardType: "tsunami",
			coordinates: [141.1, 38.1],
			timestamp: "2026-11-10T01:45:00Z",
		},
	],
	catalog,
	{ spatialRadiusKm: 150, timeWindowHours: 12 },
);
assert.strictEqual(cascadeRes.decisions[0].classification, "unique_with_cascading_candidates");
assert.strictEqual(cascadeRes.cascadingCandidates.length, 1);
assert.strictEqual(cascadeRes.cascadingCandidates[0].relationType, "cascading_candidate");
assert.strictEqual(cascadeRes.cascadingCandidates[0].causalLinkVerified, false, "Space/time overlap must never infer causal trigger");

console.log("✅ Versioned HIP crosswalk & event identity/deduplication tests passed!");
