const assert = require("assert");
const {
	validateInputContract,
	normalizeHazardIntensity,
	validateCoordinatePair,
	validateTemporalInterval,
	createProvenanceManifest,
	transitionGovernanceState,
	computeSnapshotHash,
	createAssessmentEnvelope,
} = require("../lib/contracts");
const {
	MODEL_REGISTRY,
	getRegisteredMethod,
	listRegisteredMethods,
	checkDomainApplicability,
} = require("../lib/registry");
const { estimatePgaFromMmiDetailed } = require("../lib/usgs");
const {
	evaluateSeismicFragility,
	evaluateFloodDamage,
	evaluateWindDamage,
} = require("../lib/fragility");

console.log("Testing Contracts, Units, Missing-Data, Provenance & Model Registry (R-02, R-03, R-04)...");

// --- R-02: Intensity Normalization, Unit Conversions, Mismatches ---
const eqMs2 = normalizeHazardIntensity("earthquake", 9.80665, "m/s2");
assert.strictEqual(eqMs2.valid, true);
assert(Math.abs(eqMs2.intensity - 1.0) < 1e-4, "9.80665 m/s2 must equal 1.0 g");

const flFt = normalizeHazardIntensity("flood", 10, "ft");
assert.strictEqual(flFt.valid, true);
assert(Math.abs(flFt.intensity - 3.048) < 1e-4, "10 ft must convert to 3.048 m");

const wKt = normalizeHazardIntensity("wind", 100, "kt");
assert.strictEqual(wKt.valid, true);
assert(Math.abs(wKt.intensity - 185.2) < 1e-3, "100 kt must convert to 185.2 km/h");

// Reject mm rainfall passed as flood inundation depth
const badFloodUnit = normalizeHazardIntensity("flood", 250, "mm");
assert.strictEqual(badFloodUnit.valid, false);
assert.strictEqual(badFloodUnit.error.code, "UNIT_MISMATCH");

// Missing intensity must fail with MISSING_REQUIRED_INPUT (no silent defaults)
const missingInt = normalizeHazardIntensity("earthquake", null, "g");
assert.strictEqual(missingInt.valid, false);
assert.strictEqual(missingInt.error.code, "MISSING_REQUIRED_INPUT");

// Coordinate order swap detection [lat, lon] where lat is > 90 in second slot
const swapped = validateCoordinatePair([35.6, 139.7], "epicenter");
assert.strictEqual(swapped.valid, false);
assert.strictEqual(swapped.error.code, "INVALID_COORDINATE_ORDER");

// Temporal interval validation
const invTemp = validateTemporalInterval("2026-11-10T00:00:00Z", "2026-11-05T00:00:00Z");
assert.strictEqual(invTemp.valid, false);
assert.strictEqual(invTemp.errors[0].code, "INVALID_TEMPORAL_INTERVAL");

// Missing data semantics: preserve null/unknown as incomplete rather than zero
const missingContract = validateInputContract(
	{
		hazardType: "flood",
		intensity: 1.8,
		intensityUnit: "m",
		currency: "USD",
		valuationYear: 2026,
		assets: [
			{ id: "a1", properties: { name: "Unknown Clinic", population: null, valueUsd: null } },
		],
	},
	{ strictMissingData: true },
);
assert.strictEqual(missingContract.valid, false);
assert.strictEqual(missingContract.status, "incomplete");
assert.strictEqual(missingContract.missingDataSummary.unknownPopulationAssets, 1);
assert.strictEqual(missingContract.missingDataSummary.unknownValueAssets, 1);

// --- R-03 & C-03: Provenance Manifest, Secret Redaction & Immutable Evidence Basis ---
const dirtyInput = {
	eventId: "ev_100",
	apiKey: "super-secret-delta-key",
	password: "do-not-leak-password",
	email: "officer@example.org",
	nestedUrl: "https://hooks.example.com/ingest?token=secret123&mode=test",
};
const hash1 = computeSnapshotHash(dirtyInput);
const hash2 = computeSnapshotHash({
	eventId: "ev_100",
	apiKey: "different-secret",
	password: "other-password",
	email: "other@example.org",
	nestedUrl: "https://hooks.example.com/ingest?token=another999&mode=test",
});
assert.strictEqual(hash1, hash2, "Snapshot hashes must ignore stripped secrets/PII and produce identical structural hashes");

const manifest = createProvenanceManifest({
	sourceIds: ["usgs:us7000"],
	method: { id: "fragility.seismic.gem_hazus_baseline", version: "GEM-v2.0/HAZUS-MH-2.1" },
	inputsSnapshot: { intensity: 0.4 },
	evidenceBasis: "modelled",
	verificationStatus: "unreviewed",
	// Self-asserted "approved" without verified reference must downgrade to draft!
	approvalStatus: "approved",
});
assert.strictEqual(manifest.governance.approvalStatus, "draft", "Self-asserted approval without verified ref must remain draft");
assert.strictEqual(manifest.governance.reportingEligibility, "pending");

// Unverified approval transition must throw
assert.throws(
	() => transitionGovernanceState(manifest, { approvalStatus: "approved" }),
	/Security policy violation/,
);

// Verified transition preserves evidenceBasis as "modelled"
const approvedManifest = transitionGovernanceState(manifest, {
	verificationStatus: "peer_reviewed",
	approvalStatus: "approved",
	methodologyEligible: true,
	approvalReference: {
		verified: true,
		actorId: "focal_point_01",
		policyVersion: "2026.11-drr-policy-v1",
		payloadHash: "sha256:abc123",
		snapshotHash: manifest.inputs.snapshotHash,
	},
});
assert.strictEqual(approvedManifest.governance.evidenceBasis, "modelled", "C-03: approval must NEVER mutate evidenceBasis to observed");
assert.strictEqual(approvedManifest.governance.approvalStatus, "approved");
assert.strictEqual(approvedManifest.governance.reportingEligibility, "eligible");

// Result contract envelope
const envelope = createAssessmentEnvelope({ provenance: approvedManifest, result: { totalLoss: 1000 } });
assert.strictEqual(envelope.schemaVersion, "1.0");
assert.strictEqual(envelope.evidenceBasis, "modelled");
assert.strictEqual(envelope.reportingEligibility, "eligible");

// --- R-04, C-04 & C-06: Model Registry, GMICE vs GMPE, Distinct Occupancies & Production Block ---
assert(Object.keys(MODEL_REGISTRY).length >= 7, "Model registry must contain core models");
const waldReg = getRegisteredMethod("gmice.wald1999");
assert.strictEqual(waldReg.classification, "GMICE");
assert(listRegisteredMethods().some((m) => m.id === "fragility.seismic.gem_hazus_baseline"));

// Wald99 empirical bounds & extrapolation check
const gmiceIn = estimatePgaFromMmiDetailed(6.5);
assert.strictEqual(gmiceIn.valid, true);
assert.strictEqual(gmiceIn.classification, "GMICE");
assert.strictEqual(gmiceIn.extrapolated, false);

const gmiceExtrapolated = estimatePgaFromMmiDetailed(9.2);
assert.strictEqual(gmiceExtrapolated.valid, true);
assert.strictEqual(gmiceExtrapolated.extrapolated, true);
assert(gmiceExtrapolated.warnings.some((w) => w.code === "GMICE_EXTRAPOLATED"));
assert.strictEqual(estimatePgaFromMmiDetailed(9.2, { rejectOutOfRange: true }).valid, false);

// Production mode blocks illustrative baseline fragility curves (C-06 / R-04)
assert.throws(
	() => evaluateSeismicFragility("URM", 0.35, { mode: "production" }),
	/ILLUSTRATIVE_METHOD_BLOCKED_IN_PRODUCTION/,
);
assert.throws(
	() => evaluateFloodDamage(1.5, "residential_1story", { mode: "production" }),
	/ILLUSTRATIVE_METHOD_BLOCKED_IN_PRODUCTION/,
);
assert.throws(
	() => evaluateWindDamage(150, { mode: "production" }),
	/ILLUSTRATIVE_METHOD_BLOCKED_IN_PRODUCTION/,
);

// Distinct residential_2story vs commercial flood curves & unknown class rejection
const flRes2 = evaluateFloodDamage(1.5, "residential_2story");
const flComm = evaluateFloodDamage(1.5, "commercial");
assert.notStrictEqual(flRes2.structuralDamageRatio, flComm.structuralDamageRatio, "residential_2story and commercial curves must be distinct");

assert.throws(() => evaluateSeismicFragility("UNKNOWN_CLASS", 0.3), /UNREGISTERED_ASSET_CLASS/);
assert.throws(() => evaluateFloodDamage(1.5, "space_station"), /UNREGISTERED_ASSET_CLASS/);

// Strict out-of-domain rejection check
const oodCheck = checkDomainApplicability("fragility.seismic.gem_hazus_baseline", { value: 4.5, assetClass: "URM" }, { outOfDomainPolicy: "reject" });
assert.strictEqual(oodCheck.applicable, false);
assert.strictEqual(oodCheck.errors[0].code, "OUT_OF_DOMAIN_INPUT");

console.log("✅ Contracts, provenance, GMICE bounds & model registry tests passed!");
