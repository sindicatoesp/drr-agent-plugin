/**
 * Durable Persistence, Transactional Ledger, Atomic Leases & Fencing Tokens
 * (PS-01, PS-02, PS-03, PS-04, PS-05, CC-02, CC-03)
 *
 * Implements:
 * - PS-01: Authoritative state-store interface with compare-and-swap (CAS) and atomic manifest/pointer commits,
 *          distinguishing authoritative persistence (`cas-file-store` / `memory-cas-store`) from explicitly labelled
 *          stateless scratch mode (`stateless` -> `stateless: true, crossRunDeduplicationEnabled: false`).
 * - PS-02: Versioned schemas (`1.0` / `2.0`), strict record validation, schema migration (`1.0 -> 2.0`),
 *          and backup/restore recovery procedures.
 * - PS-03: Authoritative event identity, canonical payload hashing (excluding volatile retrieval metadata),
 *          composite assessment idempotency keys (`eventRevisionKey::methodVersion::parameterSetId::exposureVersion::configHash`),
 *          revision history preservation (never silently overwriting earlier scientific results), and reviewable cross-source duplicates.
 * - PS-04: Atomic batch commit of normalized events, assessments, and per-source checkpoints, configurable overlap windows,
 *          provider-specific reconciliation, and explicit partial-batch / retryable item retention.
 * - PS-05: Secret-redacted raw snapshot hashes/references, retention policy enforcement, and fail-closed recovery on
 *          corrupt/unavailable/incompatible authoritative state.
 * - CC-02 & CC-03: Atomic lease acquisition with ownerId, scopeId, TTL expiry, renewal, and monotonically increasing
 *          fencing token validated on every state mutation so a paused old worker can NEVER commit after takeover.
 *
 * Pure Node.js standard library only.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { computeSnapshotHash } = require("./contracts");
const { redactSensitiveObject } = require("./security");

const STATE_SCHEMA_VERSION = "2.0";
const SUPPORTED_SCHEMA_VERSIONS = new Set(["1.0", "2.0"]);

const APPROVED_RETENTION_POLICIES = {
	"standard-30d": {
		policyId: "standard-30d",
		stateRetentionDays: 365,
		rawSnapshotRetentionDays: 30,
		publicSummaryRetentionDays: 90,
		storeRawPayloadInline: false,
	},
	"audit-90d": {
		policyId: "audit-90d",
		stateRetentionDays: 730,
		rawSnapshotRetentionDays: 90,
		publicSummaryRetentionDays: 180,
		storeRawPayloadInline: true,
	},
	"minimal-7d": {
		policyId: "minimal-7d",
		stateRetentionDays: 90,
		rawSnapshotRetentionDays: 7,
		publicSummaryRetentionDays: 30,
		storeRawPayloadInline: false,
	},
};

/**
 * Format epoch ms or Date or ISO string to canonical UTC ISO-8601 with explicit +00:00 offset (SR-02)
 */
function toUtcIsoWithOffset(input = Date.now()) {
	const d = input instanceof Date ? input : new Date(input);
	if (Number.isNaN(d.getTime())) {
		throw new Error(`Invalid timestamp for UTC formatting: '${input}'`);
	}
	return d.toISOString().replace(/Z$/, "+00:00");
}

/**
 * Volatile retrieval fields excluded when computing canonical event payload hash (PS-03)
 */
const VOLATILE_EVENT_FIELDS = new Set([
	"retrievedAt",
	"payloadHash",
	"canonicalPayloadHash",
	"revisionKey",
	"fetchedAt",
	"localFilePrefix",
]);

const DANGEROUS_EVENT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function stripVolatileEventFields(obj, _depth = 0) {
	if (obj === null || obj === undefined) return obj;
	if (_depth > 20) return obj;
	if (Array.isArray(obj)) return obj.map((item) => stripVolatileEventFields(item, _depth + 1));
	if (typeof obj === "object") {
		const out = {};
		for (const k of Object.keys(obj).sort()) {
			if (VOLATILE_EVENT_FIELDS.has(k) || DANGEROUS_EVENT_KEYS.has(k)) continue;
			out[k] = stripVolatileEventFields(obj[k], _depth + 1);
		}
		return out;
	}
	return obj;
}

/**
 * Compute canonical payload hash for an event excluding volatile retrieval metadata (PS-03)
 */
function computeCanonicalEventHash(event = {}) {
	const stripped = stripVolatileEventFields(event);
	return `sha256:${computeSnapshotHash(stripped)}`;
}

/**
 * Derive authoritative event identity & revision key (PS-03)
 * Distinguishes event identity (`sourceId::externalEventId`) from event revision (`sourceRevision` or `canonicalPayloadHash`).
 */
function computeEventIdentity(event = {}) {
	const sourceId = String(event.source || event.sourceId || "unknown").toLowerCase().trim();
	const externalEventId = String(
		event.externalId || event.usgsId || event.eventId || event.id || "",
	).trim();

	if (!sourceId || !externalEventId) {
		throw new Error(
			"SCHEMA_VALIDATION_ERROR: Event record requires authoritative sourceId and externalEventId.",
		);
	}

	const canonicalPayloadHash = computeCanonicalEventHash(event);
	const explicitSourceRevision =
		event.sourceRevision !== undefined && event.sourceRevision !== null
			? String(event.sourceRevision)
			: event.episodeId !== undefined && event.episodeId !== null
				? `ep_${event.episodeId}_${canonicalPayloadHash.slice(7, 19)}`
				: event.updatedAt || event.sourceIssuedAt
					? `${event.updatedAt || event.sourceIssuedAt}_${canonicalPayloadHash.slice(7, 19)}`
					: null;

	const revisionToken = explicitSourceRevision || canonicalPayloadHash;
	const eventKey = `${sourceId}::${externalEventId}`;
	const eventRevisionKey = `${eventKey}::${revisionToken}`;

	return {
		sourceId,
		externalEventId,
		eventKey,
		sourceRevision: explicitSourceRevision,
		canonicalPayloadHash,
		revisionToken,
		eventRevisionKey,
	};
}

/**
 * Derive deterministic assessment idempotency key (SR-02, PS-03)
 * Defined from event revision plus method, parameter, exposure, and configuration versions.
 */
function computeAssessmentKey(params = {}) {
	const {
		eventRevisionKey,
		methodId = "vulnerability.sendai_composite",
		methodVersion = "1.1",
		parameterVersion = "default",
		exposureVersion = "default",
		configHash = "default",
	} = params;

	if (!eventRevisionKey || typeof eventRevisionKey !== "string") {
		throw new Error(
			"SCHEMA_VALIDATION_ERROR: computeAssessmentKey requires a non-empty eventRevisionKey.",
		);
	}

	const composite = [
		eventRevisionKey,
		`method:${methodId}@${methodVersion}`,
		`params:${parameterVersion}`,
		`exposure:${exposureVersion}`,
		`config:${configHash}`,
	].join("|");

	const hash = crypto.createHash("sha256").update(composite).digest("hex").slice(0, 24);
	return {
		assessmentKey: `asmt_${hash}`,
		compositeDescriptor: composite,
	};
}

/**
 * Create empty initial ledger state for Schema v2.0
 */
function createEmptyLedgerState(scopeId = "global") {
	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		scopeId,
		stateVersion: 0,
		lastFencingToken: 0,
		updatedAt: toUtcIsoWithOffset(Date.now()),
		lease: null,
		runs: {},
		checkpoints: {},
		events: {}, // keyed by eventKey -> { eventKey, sourceId, externalEventId, currentRevisionKey, revisions: [] }
		assessments: {}, // keyed by assessmentKey -> assessmentRecord
		ambiguousDuplicates: [], // cross-source possible duplicates held for review (PS-03)
		retryQueue: {}, // keyed by sourceId -> array of retryable items from partial batches (PS-04)
		rawSnapshots: {}, // keyed by snapshotId -> secret-redacted metadata & hash (PS-05)
		migrationHistory: [],
	};
}

/**
 * Migrate state schema from v1.0 to v2.0 preserving all historical events, assessments, and checkpoints (PS-02)
 */
function migrateStateSchema(rawState, options = {}) {
	if (!rawState || typeof rawState !== "object") {
		throw new Error("STATE_CORRUPT: State payload must be a non-null JSON object.");
	}

	const version = String(rawState.schemaVersion || "");
	if (!SUPPORTED_SCHEMA_VERSIONS.has(version)) {
		const err = new Error(
			`UNSUPPORTED_STATE_SCHEMA_VERSION: Schema version '${version || "missing"}' is not supported (supported: ${Array.from(SUPPORTED_SCHEMA_VERSIONS).join(", ")}).`,
		);
		err.code = "UNSUPPORTED_STATE_SCHEMA_VERSION";
		throw err;
	}

	const cloned = options.inPlace === true ? rawState : JSON.parse(JSON.stringify(rawState));
	if (version === "2.0") {
		validateLedgerStateSchema(cloned);
		return {
			migrated: false,
			fromVersion: "2.0",
			toVersion: "2.0",
			state: cloned,
			backupSnapshot: null,
		};
	}

	// Migrate 1.0 -> 2.0
	const backupSnapshot = JSON.parse(JSON.stringify(rawState));
	const migrated = createEmptyLedgerState(cloned.scopeId || "global");
	migrated.stateVersion = Number(cloned.stateVersion || 1);
	migrated.lastFencingToken = Number(cloned.lastFencingToken || 0);
	migrated.updatedAt = toUtcIsoWithOffset(options.nowMs || Date.now());
	migrated.runs = cloned.runs || {};
	migrated.checkpoints = cloned.checkpoints || {};

	// Migrate v1 flat events or v2 structured events
	if (cloned.events && typeof cloned.events === "object") {
		for (const [k, ev] of Object.entries(cloned.events)) {
			if (Array.isArray(ev.revisions)) {
				migrated.events[k] = ev;
			} else {
				const revKey = ev.eventRevisionKey || `${k}::${ev.payloadHash || "v1"}`;
				migrated.events[k] = {
					eventKey: k,
					sourceId: ev.sourceId || ev.source || "unknown",
					externalEventId: ev.externalEventId || ev.id || k,
					currentRevisionKey: revKey,
					revisions: [
						{
							eventRevisionKey: revKey,
							sourceRevision: ev.sourceRevision || null,
							canonicalPayloadHash: ev.canonicalPayloadHash || ev.payloadHash || "sha256:v1",
							sourceIssuedAt: ev.sourceIssuedAt || null,
							retrievedAt: ev.retrievedAt || migrated.updatedAt,
							committedAt: ev.committedAt || migrated.updatedAt,
							provenance: ev.provenance || { migratedFromV1: true },
							normalizedPayload: ev.normalizedPayload || ev,
						},
					],
				};
			}
		}
	}

	migrated.assessments = cloned.assessments || {};
	migrated.ambiguousDuplicates = Array.isArray(cloned.ambiguousDuplicates)
		? cloned.ambiguousDuplicates
		: [];
	migrated.retryQueue = cloned.retryQueue || {};
	migrated.rawSnapshots = cloned.rawSnapshots || {};
	migrated.migrationHistory = [
		...(Array.isArray(cloned.migrationHistory) ? cloned.migrationHistory : []),
		{
			fromVersion: "1.0",
			toVersion: "2.0",
			migratedAt: migrated.updatedAt,
		},
	];

	validateLedgerStateSchema(migrated);
	return {
		migrated: true,
		fromVersion: "1.0",
		toVersion: "2.0",
		state: migrated,
		backupSnapshot,
	};
}

/**
 * Validate state ledger schema and record identities (PS-02)
 */
function validateLedgerStateSchema(state) {
	if (!state || typeof state !== "object") {
		const err = new Error("SCHEMA_VALIDATION_ERROR: Ledger state must be an object.");
		err.code = "SCHEMA_VALIDATION_ERROR";
		throw err;
	}
	if (!SUPPORTED_SCHEMA_VERSIONS.has(String(state.schemaVersion))) {
		const err = new Error(
			`UNSUPPORTED_STATE_SCHEMA_VERSION: '${state.schemaVersion}' is not supported.`,
		);
		err.code = "UNSUPPORTED_STATE_SCHEMA_VERSION";
		throw err;
	}
	if (!state.scopeId || typeof state.scopeId !== "string") {
		const err = new Error("SCHEMA_VALIDATION_ERROR: Ledger state requires non-empty scopeId.");
		err.code = "SCHEMA_VALIDATION_ERROR";
		throw err;
	}
	if (typeof state.stateVersion !== "number" || state.stateVersion < 0) {
		const err = new Error("SCHEMA_VALIDATION_ERROR: stateVersion must be a non-negative integer.");
		err.code = "SCHEMA_VALIDATION_ERROR";
		throw err;
	}
	if (typeof state.lastFencingToken !== "number" || state.lastFencingToken < 0) {
		const err = new Error(
			"SCHEMA_VALIDATION_ERROR: lastFencingToken must be a non-negative integer.",
		);
		err.code = "SCHEMA_VALIDATION_ERROR";
		throw err;
	}

	// Validate normalized event records
	if (state.events && typeof state.events === "object") {
		for (const [eventKey, entry] of Object.entries(state.events)) {
			if (!entry.sourceId || !entry.externalEventId || !Array.isArray(entry.revisions)) {
				const err = new Error(
					`SCHEMA_VALIDATION_ERROR: Event '${eventKey}' has incomplete identity or missing revisions array.`,
				);
				err.code = "SCHEMA_VALIDATION_ERROR";
				throw err;
			}
			for (const rev of entry.revisions) {
				if (!rev.eventRevisionKey || !rev.canonicalPayloadHash) {
					const err = new Error(
						`SCHEMA_VALIDATION_ERROR: Event revision in '${eventKey}' is missing eventRevisionKey or canonicalPayloadHash.`,
					);
					err.code = "SCHEMA_VALIDATION_ERROR";
					throw err;
				}
			}
		}
	}

	// Validate assessment records
	if (state.assessments && typeof state.assessments === "object") {
		for (const [asmtKey, asmt] of Object.entries(state.assessments)) {
			if (
				!asmt.assessmentKey ||
				!asmt.eventRevisionKey ||
				!asmt.methodVersion ||
				!asmt.configHash ||
				!asmt.evidenceBasis
			) {
				const err = new Error(
					`SCHEMA_VALIDATION_ERROR: Assessment '${asmtKey}' is missing required identity fields (assessmentKey, eventRevisionKey, methodVersion, configHash, evidenceBasis).`,
				);
				err.code = "SCHEMA_VALIDATION_ERROR";
				throw err;
			}
		}
	}

	return { valid: true };
}

/**
 * Validate an individual Run Record before persisting (PS-02)
 */
function validateRunRecord(runRecord) {
	const required = ["runId", "status", "scopeId", "commitSha", "configHash", "startedAt"];
	for (const f of required) {
		if (!runRecord || !runRecord[f] || String(runRecord[f]).trim() === "") {
			const err = new Error(`SCHEMA_VALIDATION_ERROR: Run record is missing required field '${f}'.`);
			err.code = "SCHEMA_VALIDATION_ERROR";
			throw err;
		}
	}
	return true;
}

const VALID_SCOPE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Base CAS State Store implementing atomic leases, fencing tokens, transactional commits,
 * retention, and backup/recovery (PS-01..PS-05, CC-02..CC-03).
 */
class AuthoritativeStateStore {
	constructor(options = {}) {
		this.backendType = options.backendType || "memory-cas-store";
		const rawScopeId = options.scopeId !== undefined ? String(options.scopeId) : "global";
		if (!VALID_SCOPE_ID_RE.test(rawScopeId)) {
			const err = new Error(
				`INVALID_SCOPE_ID: Invalid scopeId '${rawScopeId}'. Must match ${VALID_SCOPE_ID_RE.source}.`,
			);
			err.code = "INVALID_SCOPE_ID";
			throw err;
		}
		this.scopeId = rawScopeId;
		this.stateless = options.stateless === true;
		this.clockSkewAllowanceMs = Number(options.clockSkewAllowanceMs ?? 1000);
		this.retentionPolicy =
			APPROVED_RETENTION_POLICIES[options.retentionPolicy || "standard-30d"] ||
			APPROVED_RETENTION_POLICIES["standard-30d"];
	}

	/**
	 * Subclasses override _readRawAndVersion() -> { state, version }
	 * and _compareAndSwap(expectedVersion, nextState) -> { committed, version }
	 */
	async _readRawAndVersion() {
		throw new Error("_readRawAndVersion not implemented");
	}

	async _compareAndSwap(_expectedVersion, _nextState) {
		throw new Error("_compareAndSwap not implemented");
	}

	/**
	 * Load and validate authoritative state; fail closed if unavailable or corrupt (PS-05)
	 */
	async loadState(options = {}) {
		const { state: rawState, version } = await this._readRawAndVersion();
		const mig = migrateStateSchema(rawState, { ...options, inPlace: true });
		if (mig.migrated) {
			await this._compareAndSwap(version, mig.state);
		}
		return {
			state: mig.state,
			version: mig.state.stateVersion,
			stateless: this.stateless,
			crossRunDeduplicationEnabled: !this.stateless,
		};
	}

	/**
	 * Atomically acquire or contend for a scoped storage lease with monotonically increasing fencing token (CC-02, CC-03)
	 * @param {object} params - { ownerId, scopeId, ttlMs, nowMs, waitMs, pollIntervalMs, sleepFn }
	 */
	async acquireLease(params = {}) {
		const ownerId = params.ownerId;
		const scopeId = params.scopeId || this.scopeId;
		const ttlMs = Math.max(500, Number(params.ttlMs ?? 60000));
		const nowFn = typeof params.nowFn === "function" ? params.nowFn : () => Date.now();
		const waitMs = Math.max(0, Number(params.waitMs ?? 0));
		const pollIntervalMs = Math.max(20, Number(params.pollIntervalMs ?? 50));
		const sleepFn =
			typeof params.sleepFn === "function"
				? params.sleepFn
				: (ms) => new Promise((r) => setTimeout(r, ms));

		if (!ownerId) {
			throw new Error("CC-02: acquireLease requires a non-empty ownerId.");
		}

		const deadlineMs = nowFn() + waitMs;

		while (true) {
			const { state, version } = await this._readRawAndVersion();
			const mig = migrateStateSchema(state, { nowMs: nowFn() });
			const current = mig.state;

			if (current.scopeId !== scopeId) {
				current.scopeId = scopeId;
			}

			const nowMs = nowFn();
			const activeLease = current.lease;
			const leaseExpired =
				!activeLease ||
				Date.parse(activeLease.expiresAt) + this.clockSkewAllowanceMs <= nowMs;

			if (!leaseExpired && activeLease.ownerId !== ownerId) {
				if (nowFn() < deadlineMs) {
					await sleepFn(pollIntervalMs);
					continue;
				}
				return {
					acquired: false,
					reason: "lock_held",
					scopeId,
					heldBy: activeLease.ownerId,
					expiresAt: activeLease.expiresAt,
					fencingToken: activeLease.fencingToken,
				};
			}

			const nextFencingToken =
				activeLease && activeLease.ownerId === ownerId && !leaseExpired
					? activeLease.fencingToken
					: current.lastFencingToken + 1;
			const nextLeaseVersion =
				activeLease && activeLease.ownerId === ownerId && !leaseExpired
					? (activeLease.leaseVersion || 1) + 1
					: 1;

			const leaseRecord = {
				scopeId,
				ownerId,
				fencingToken: nextFencingToken,
				leaseVersion: nextLeaseVersion,
				acquiredAt:
					activeLease && activeLease.ownerId === ownerId && !leaseExpired
						? activeLease.acquiredAt
						: toUtcIsoWithOffset(nowMs),
				renewedAt: toUtcIsoWithOffset(nowMs),
				expiresAt: toUtcIsoWithOffset(nowMs + ttlMs),
				ttlMs,
			};

			current.lastFencingToken = nextFencingToken;
			current.lease = leaseRecord;
			current.stateVersion = version + 1;
			current.updatedAt = toUtcIsoWithOffset(nowMs);

			const cas = await this._compareAndSwap(version, current);
			if (cas.committed) {
				return {
					acquired: true,
					lease: { ...leaseRecord },
					stateVersion: current.stateVersion,
				};
			}
			// CAS conflict -> retry loop if within wait budget or immediate CAS retry
			if (nowFn() > deadlineMs + 500) {
				return {
					acquired: false,
					reason: "cas_conflict",
					scopeId,
				};
			}
		}
	}

	/**
	 * Renew an owned lease before expiry; fails if fencing token or owner was superseded (CC-02)
	 */
	async renewLease(params = {}) {
		const { ownerId, fencingToken, ttlMs = 60000, nowFn = () => Date.now() } = params;
		const { state, version } = await this._readRawAndVersion();
		const current = migrateStateSchema(state, { nowMs: nowFn() }).state;
		const nowMs = nowFn();

		const check = this._validateFencingAndOwnership(current, ownerId, fencingToken, nowMs);
		if (!check.valid) {
			return {
				renewed: false,
				code: check.code,
				reason: check.reason,
			};
		}

		current.lease.renewedAt = toUtcIsoWithOffset(nowMs);
		current.lease.expiresAt = toUtcIsoWithOffset(nowMs + ttlMs);
		current.lease.leaseVersion = (current.lease.leaseVersion || 1) + 1;
		current.stateVersion = version + 1;
		current.updatedAt = toUtcIsoWithOffset(nowMs);

		const cas = await this._compareAndSwap(version, current);
		if (!cas.committed) {
			return {
				renewed: false,
				code: "CAS_CONFLICT",
				reason: "Concurrent state update during lease renewal.",
			};
		}

		return {
			renewed: true,
			lease: { ...current.lease },
			stateVersion: current.stateVersion,
		};
	}

	/**
	 * Release a lease ONLY if ownerId and fencingToken still match; never delete another run's lease (CC-02)
	 */
	async releaseLease(params = {}) {
		const { ownerId, fencingToken, nowFn = () => Date.now() } = params;
		const { state, version } = await this._readRawAndVersion();
		const current = migrateStateSchema(state, { nowMs: nowFn() }).state;
		const nowMs = nowFn();

		if (!current.lease) {
			return { released: false, reason: "no_active_lease" };
		}
		if (
			current.lease.ownerId !== ownerId ||
			current.lease.fencingToken !== Number(fencingToken)
		) {
			return {
				released: false,
				code: "LEASE_OWNERSHIP_MISMATCH",
				reason: `Cannot release lease: owned by '${current.lease.ownerId}' (token ${current.lease.fencingToken}), caller is '${ownerId}' (token ${fencingToken}).`,
			};
		}

		current.lease = null;
		current.stateVersion = version + 1;
		current.updatedAt = toUtcIsoWithOffset(nowMs);

		const cas = await this._compareAndSwap(version, current);
		return {
			released: cas.committed,
			reason: cas.committed ? "released" : "cas_conflict",
		};
	}

	/**
	 * Internal helper: validate fencing token and lease ownership on every storage write (CC-02)
	 * Rejects commits from paused old workers even if only checking token monotonicity!
	 */
	_validateFencingAndOwnership(state, ownerId, fencingToken, nowMs) {
		const tokenNum = Number(fencingToken);
		if (!ownerId || !Number.isInteger(tokenNum) || tokenNum <= 0) {
			return {
				valid: false,
				code: "MISSING_FENCING_TOKEN",
				reason: "Storage write rejected: valid ownerId and positive fencingToken are required.",
			};
		}
		if (tokenNum < state.lastFencingToken) {
			return {
				valid: false,
				code: "FENCING_TOKEN_SUPERSEDED",
				reason: `Fencing token ${tokenNum} is older than authoritative lastFencingToken ${state.lastFencingToken}; old worker write rejected.`,
			};
		}
		if (!state.lease) {
			return {
				valid: false,
				code: "LEASE_NOT_HELD",
				reason: "Storage write rejected: no active lease held.",
			};
		}
		if (state.lease.ownerId !== ownerId || state.lease.fencingToken !== tokenNum) {
			return {
				valid: false,
				code: "LEASE_OWNERSHIP_LOST",
				reason: `Lease ownership lost: active owner is '${state.lease.ownerId}' (token ${state.lease.fencingToken}), writer is '${ownerId}' (token ${tokenNum}).`,
			};
		}
		if (Date.parse(state.lease.expiresAt) + this.clockSkewAllowanceMs <= nowMs) {
			return {
				valid: false,
				code: "LEASE_EXPIRED",
				reason: `Lease for '${ownerId}' (token ${tokenNum}) expired at ${state.lease.expiresAt}.`,
			};
		}
		return { valid: true };
	}

	/**
	 * Record or update a Run Record under fencing protection (PS-02)
	 */
	async saveRunRecord(params = {}) {
		const { ownerId, fencingToken, runRecord, nowFn = () => Date.now() } = params;
		validateRunRecord(runRecord);

		for (let casRetry = 0; casRetry < 3; casRetry++) {
			const { state, version } = await this._readRawAndVersion();
			const current = migrateStateSchema(state, { nowMs: nowFn() }).state;
			const nowMs = nowFn();

			const fenceCheck = this._validateFencingAndOwnership(
				current,
				ownerId,
				fencingToken,
				nowMs,
			);
			if (!fenceCheck.valid) {
				const err = new Error(fenceCheck.reason);
				err.code = fenceCheck.code;
				throw err;
			}

			current.runs[runRecord.runId] = redactSensitiveObject({
				...current.runs[runRecord.runId],
				...runRecord,
				heartbeatAt: toUtcIsoWithOffset(nowMs),
			});
			current.stateVersion = version + 1;
			current.updatedAt = toUtcIsoWithOffset(nowMs);

			const cas = await this._compareAndSwap(version, current);
			if (cas.committed) {
				return {
					committed: true,
					stateVersion: current.stateVersion,
					runRecord: current.runs[runRecord.runId],
				};
			}
		}

		const err = new Error("CAS_CONFLICT: Failed to commit run record after retries.");
		err.code = "CAS_CONFLICT";
		throw err;
	}

	/**
	 * Atomically commit normalized events, assessments, source checkpoints, retryable items,
	 * and run outcome under fencing token protection (PS-02, PS-03, PS-04, PS-05, CC-02).
	 *
	 * Enforces:
	 * - Uniqueness of assessment keys in durable storage
	 * - Preservation of event revision history without overwriting earlier scientific results
	 * - Advancement of checkpoints ONLY for sources whose covered interval succeeded
	 * - Retention of retryable items for partial batches
	 */
	async commitRunTransaction(tx = {}) {
		const {
			ownerId,
			fencingToken,
			runRecord,
			normalizedEvents = [],
			assessments = [],
			checkpointUpdates = {}, // { [sourceId]: { cursor, windowStart, windowEnd, advanceAllowed: boolean } }
			retryableItemsBySource = {}, // { [sourceId]: [item, ...] }
			ambiguousDuplicates = [],
			rawSnapshots = [],
			signal = null,
			nowFn = () => Date.now(),
		} = tx;

		if (signal?.aborted) {
			const abortErr = new Error("Transaction aborted before commit due to cancellation signal.");
			abortErr.code = "ABORT_ERR";
			throw abortErr;
		}

		const { state, version } = await this._readRawAndVersion();
		const current = migrateStateSchema(state, { nowMs: nowFn() }).state;
		const nowMs = nowFn();
		const committedAtIso = toUtcIsoWithOffset(nowMs);

		const fenceCheck = this._validateFencingAndOwnership(current, ownerId, fencingToken, nowMs);
		if (!fenceCheck.valid) {
			const err = new Error(fenceCheck.reason);
			err.code = fenceCheck.code;
			throw err;
		}

		// Renew lease heartbeat as part of valid commit
		current.lease.renewedAt = committedAtIso;

		const stats = {
			newEventsInserted: 0,
			eventRevisionsAdded: 0,
			unchangedEventsSkipped: 0,
			newAssessmentsInserted: 0,
			duplicateAssessmentsSkipped: 0,
			checkpointsAdvanced: [],
			checkpointsUnchanged: [],
		};

		// 1. Upsert Normalized Events with full revision history (PS-02, PS-03)
		for (const rawEv of normalizedEvents) {
			const identity = computeEventIdentity(rawEv);
			const existingEntry = current.events[identity.eventKey];

			const revisionRecord = redactSensitiveObject({
				eventRevisionKey: identity.eventRevisionKey,
				sourceRevision: identity.sourceRevision,
				canonicalPayloadHash: identity.canonicalPayloadHash,
				sourceIssuedAt: rawEv.sourceIssuedAt
					? toUtcIsoWithOffset(rawEv.sourceIssuedAt)
					: null,
				forecastIssueTime: rawEv.forecastMetadata?.issueTime
					? toUtcIsoWithOffset(rawEv.forecastMetadata.issueTime)
					: null,
				forecastValidTimeStart: rawEv.forecastMetadata?.validTimeStart || null,
				forecastValidTimeEnd: rawEv.forecastMetadata?.validTimeEnd || null,
				retrievedAt: rawEv.retrievedAt
					? toUtcIsoWithOffset(rawEv.retrievedAt)
					: committedAtIso,
				committedAt: committedAtIso,
				runId: runRecord?.runId || null,
				provenance: rawEv.provenance || {
					sourceId: identity.sourceId,
					externalEventId: identity.externalEventId,
					payloadHash: identity.canonicalPayloadHash,
				},
				normalizedPayload: stripVolatileEventFields(rawEv),
			});

			if (!existingEntry) {
				current.events[identity.eventKey] = {
					eventKey: identity.eventKey,
					sourceId: identity.sourceId,
					externalEventId: identity.externalEventId,
					currentRevisionKey: identity.eventRevisionKey,
					revisions: [revisionRecord],
				};
				stats.newEventsInserted++;
			} else {
				const alreadyHasRevision = existingEntry.revisions.some(
					(r) =>
						r.eventRevisionKey === identity.eventRevisionKey ||
						r.canonicalPayloadHash === identity.canonicalPayloadHash,
				);
				if (!alreadyHasRevision) {
					// PS-03: Preserve revision history; append new revision without overwriting earlier revisions
					existingEntry.revisions.push(revisionRecord);
					existingEntry.currentRevisionKey = identity.eventRevisionKey;
					stats.eventRevisionsAdded++;
				} else {
					stats.unchangedEventsSkipped++;
				}
			}
		}

		// 2. Insert Assessments enforcing storage-level uniqueness by assessmentKey (PS-02, PS-03)
		for (const asmt of assessments) {
			if (!asmt.assessmentKey || !asmt.eventRevisionKey) {
				const err = new Error(
					"SCHEMA_VALIDATION_ERROR: Assessment missing assessmentKey or eventRevisionKey.",
				);
				err.code = "SCHEMA_VALIDATION_ERROR";
				throw err;
			}
			if (current.assessments[asmt.assessmentKey]) {
				// Already committed -> idempotent no-op, never duplicate
				stats.duplicateAssessmentsSkipped++;
				continue;
			}
			current.assessments[asmt.assessmentKey] = redactSensitiveObject({
				...asmt,
				assessedAt: asmt.assessedAt ? toUtcIsoWithOffset(asmt.assessedAt) : committedAtIso,
				committedAt: committedAtIso,
				runId: runRecord?.runId || asmt.runId || null,
			});
			stats.newAssessmentsInserted++;
		}

		// 3. Record ambiguous cross-source duplicates for human review without auto-merging (PS-03)
		for (const dup of ambiguousDuplicates) {
			const exists = current.ambiguousDuplicates.some(
				(d) =>
					d.incomingId === dup.incomingId &&
					d.candidateCanonicalId === (dup.candidateMatches?.[0]?.canonicalId || dup.candidateCanonicalId),
			);
			if (!exists) {
				current.ambiguousDuplicates.push(
					redactSensitiveObject({
						...dup,
						recordedAt: committedAtIso,
						runId: runRecord?.runId || null,
					}),
				);
			}
		}

		// 4. Advance Source Checkpoints ONLY where source interval was safely processed (PS-04, RT-04)
		for (const [sourceId, cpUpdate] of Object.entries(checkpointUpdates)) {
			const scopeKey = `${this.scopeId}::${sourceId}`;
			const existingCp = current.checkpoints[scopeKey] || null;

			if (cpUpdate && cpUpdate.advanceAllowed === true) {
				current.checkpoints[scopeKey] = {
					scopeId: this.scopeId,
					sourceId,
					cursor: cpUpdate.cursor,
					lastWindowStart: cpUpdate.windowStart
						? toUtcIsoWithOffset(cpUpdate.windowStart)
						: existingCp?.lastWindowStart || null,
					lastWindowEnd: cpUpdate.windowEnd
						? toUtcIsoWithOffset(cpUpdate.windowEnd)
						: committedAtIso,
					lastSourceIssuedAt: cpUpdate.lastSourceIssuedAt
						? toUtcIsoWithOffset(cpUpdate.lastSourceIssuedAt)
						: existingCp?.lastSourceIssuedAt || null,
					updatedAt: committedAtIso,
					runId: runRecord?.runId || null,
					partialBatch: false,
				};
				current.retryQueue[sourceId] = [];
				stats.checkpointsAdvanced.push(sourceId);
			} else {
				// Failed or partial source: leave cursor unchanged and retain retryable items
				if (existingCp) {
					current.checkpoints[scopeKey] = {
						...existingCp,
						partialBatch: Boolean(cpUpdate?.partialBatch),
						lastAttemptedAt: committedAtIso,
						lastFailedRunId: runRecord?.runId || null,
					};
				}
				if (Array.isArray(retryableItemsBySource[sourceId])) {
					current.retryQueue[sourceId] = redactSensitiveObject(
						retryableItemsBySource[sourceId],
					);
				}
				stats.checkpointsUnchanged.push(sourceId);
			}
		}

		// 5. Store raw snapshot hashes/references with secret redaction & retention policy (PS-05)
		for (const snap of rawSnapshots) {
			if (!snap || !snap.sourceId) continue;
			const snapHash = snap.payloadHash || `sha256:${computeSnapshotHash(snap.payload || {})}`;
			const snapId = `${snap.sourceId}_${snapHash.slice(7, 19)}`;
			current.rawSnapshots[snapId] = redactSensitiveObject({
				snapshotId: snapId,
				sourceId: snap.sourceId,
				payloadHash: snapHash,
				sourceIssuedAt: snap.sourceIssuedAt
					? toUtcIsoWithOffset(snap.sourceIssuedAt)
					: null,
				retrievedAt: snap.retrievedAt
					? toUtcIsoWithOffset(snap.retrievedAt)
					: committedAtIso,
				committedAt: committedAtIso,
				retentionPolicyId: this.retentionPolicy.policyId,
				expiresAt: toUtcIsoWithOffset(
					nowMs + this.retentionPolicy.rawSnapshotRetentionDays * 86400000,
				),
				rawPayload: this.retentionPolicy.storeRawPayloadInline
					? redactSensitiveObject(snap.payload)
					: undefined,
			});
		}

		// Prune expired raw snapshots per retention policy (PS-05)
		for (const [snapId, snapMeta] of Object.entries(current.rawSnapshots)) {
			if (snapMeta.expiresAt && Date.parse(snapMeta.expiresAt) <= nowMs) {
				delete current.rawSnapshots[snapId];
			}
		}

		// 6. Save Run Record
		if (runRecord) {
			validateRunRecord(runRecord);
			current.runs[runRecord.runId] = redactSensitiveObject({
				...current.runs[runRecord.runId],
				...runRecord,
				committedAt: committedAtIso,
				heartbeatAt: committedAtIso,
			});
		}

		current.stateVersion = version + 1;
		current.updatedAt = committedAtIso;

		validateLedgerStateSchema(current);

		if (signal?.aborted) {
			const abortErr = new Error("Transaction aborted prior to atomic CAS commit.");
			abortErr.code = "ABORT_ERR";
			throw abortErr;
		}

		const cas = await this._compareAndSwap(version, current);
		if (!cas.committed) {
			const err = new Error(
				"CAS_CONFLICT: State version changed concurrently during commitRunTransaction.",
			);
			err.code = "CAS_CONFLICT";
			throw err;
		}

		return {
			committed: true,
			stateVersion: current.stateVersion,
			fencingToken: Number(fencingToken),
			committedAt: committedAtIso,
			stats,
		};
	}
}

/**
 * In-Memory CAS State Store (for deterministic unit/fault-injection testing or stateless scratch mode)
 */
class InMemoryCasStateStore extends AuthoritativeStateStore {
	constructor(options = {}) {
		super({ ...options, backendType: options.stateless ? "stateless-memory" : "memory-cas-store" });
		this.unavailable = options.unavailable === true;
		this.corrupt = options.corrupt === true;
		this._state = options.initialState
			? JSON.parse(JSON.stringify(options.initialState))
			: createEmptyLedgerState(this.scopeId);
	}

	async _readRawAndVersion() {
		if (this.unavailable) {
			const err = new Error(
				"STATE_BACKEND_UNAVAILABLE: Authoritative state backend is unreachable (failing closed).",
			);
			err.code = "STATE_BACKEND_UNAVAILABLE";
			throw err;
		}
		if (this.corrupt) {
			const err = new Error("STATE_CORRUPT: Authoritative state snapshot failed integrity check.");
			err.code = "STATE_CORRUPT";
			throw err;
		}
		const clone = JSON.parse(JSON.stringify(this._state));
		return { state: clone, version: Number(clone.stateVersion || 0) };
	}

	async _compareAndSwap(expectedVersion, nextState) {
		if (this.unavailable) {
			const err = new Error(
				"STATE_BACKEND_UNAVAILABLE: Authoritative state backend is unreachable during commit.",
			);
			err.code = "STATE_BACKEND_UNAVAILABLE";
			throw err;
		}
		const currentVer = Number(this._state.stateVersion || 0);
		if (currentVer !== Number(expectedVersion)) {
			return { committed: false, version: currentVer };
		}
		this._state = JSON.parse(JSON.stringify(nextState));
		return { committed: true, version: Number(this._state.stateVersion) };
	}

	createBackupSnapshot() {
		return JSON.parse(JSON.stringify(this._state));
	}

	restoreFromBackup(snapshot) {
		const mig = migrateStateSchema(snapshot);
		this._state = JSON.parse(JSON.stringify(mig.state));
		this.corrupt = false;
		return { restored: true, stateVersion: this._state.stateVersion };
	}
}

/**
 * Transactional File/Object CAS State Store using Manifest + Immutable Versioned Snapshots
 * and Atomic Pointer Rename Protocol (PS-01, PS-04, PS-05).
 *
 * Protocol:
 * 1. Each state revision is written to an immutable object `objects/state-v<N>-<hash>.json` + sha256 digest.
 * 2. A commit manifest `pointer.json` (`{ stateVersion, objectFile, sha256, updatedAt }`) is written to
 *    a temp file and atomically renamed into place, guarded by an exclusive lockfile CAS check.
 * 3. Previous committed pointer is retained as `pointer.backup.json` for automatic/verified recovery.
 */
class FileCasStateStore extends AuthoritativeStateStore {
	constructor(options = {}) {
		super({ ...options, backendType: "cas-file-store" });
		if (!options.storageDir) {
			throw new Error("FileCasStateStore requires options.storageDir.");
		}
		this.storageDir = path.resolve(options.storageDir);
		this.objectsDir = path.join(this.storageDir, "objects");
		this.pointerPath = path.join(this.storageDir, `pointer-${this.scopeId}.json`);
		this.backupPointerPath = path.join(this.storageDir, `pointer-${this.scopeId}.backup.json`);
		this.lockFilePath = path.join(this.storageDir, `cas-${this.scopeId}.lock`);
		this.requireExistingLedger = options.requireExistingLedger === true;
		this.unavailable = options.unavailable === true;
	}

	_ensureDirectories() {
		if (this.unavailable) {
			const err = new Error(
				`STATE_BACKEND_UNAVAILABLE: Storage directory '${this.storageDir}' is marked unavailable.`,
			);
			err.code = "STATE_BACKEND_UNAVAILABLE";
			throw err;
		}
		try {
			if (!fs.existsSync(this.objectsDir)) {
				fs.mkdirSync(this.objectsDir, { recursive: true });
			}
		} catch (e) {
			const err = new Error(
				`STATE_BACKEND_UNAVAILABLE: Cannot initialize storage directory '${this.storageDir}': ${e.message}`,
			);
			err.code = "STATE_BACKEND_UNAVAILABLE";
			throw err;
		}
	}

	async _readRawAndVersion() {
		this._ensureDirectories();

		if (!fs.existsSync(this.pointerPath)) {
			if (this.requireExistingLedger) {
				const err = new Error(
					`STATE_BACKEND_UNAVAILABLE: Authoritative ledger pointer not found at '${this.pointerPath}' and requireExistingLedger=true (failing closed rather than starting fresh ledger).`,
				);
				err.code = "STATE_BACKEND_UNAVAILABLE";
				throw err;
			}
			const initial = createEmptyLedgerState(this.scopeId);
			return { state: initial, version: 0 };
		}

		let pointer;
		try {
			pointer = JSON.parse(fs.readFileSync(this.pointerPath, "utf8"));
		} catch (e) {
			const err = new Error(
				`STATE_CORRUPT: Failed to parse state pointer '${this.pointerPath}': ${e.message}`,
			);
			err.code = "STATE_CORRUPT";
			throw err;
		}

		const objPath = path.join(this.objectsDir, path.basename(String(pointer.objectFile || "")));
		if (!pointer.objectFile || !fs.existsSync(objPath)) {
			const err = new Error(
				`STATE_CORRUPT: State object '${pointer.objectFile}' referenced by pointer is missing.`,
			);
			err.code = "STATE_CORRUPT";
			throw err;
		}

		let rawBytes;
		let parsedState;
		try {
			rawBytes = fs.readFileSync(objPath, "utf8");
			const actualSha = crypto.createHash("sha256").update(rawBytes).digest("hex");
			if (pointer.sha256 && pointer.sha256 !== actualSha) {
				throw new Error(
					`SHA-256 digest mismatch (expected ${pointer.sha256}, got ${actualSha})`,
				);
			}
			parsedState = JSON.parse(rawBytes);
		} catch (e) {
			const err = new Error(
				`STATE_CORRUPT: State snapshot '${objPath}' failed integrity check: ${e.message}`,
			);
			err.code = "STATE_CORRUPT";
			throw err;
		}

		return {
			state: parsedState,
			version: Number(parsedState.stateVersion || 0),
		};
	}

	async _compareAndSwap(expectedVersion, nextState) {
		this._ensureDirectories();

		let lockFd = null;
		try {
			lockFd = fs.openSync(this.lockFilePath, "wx");
		} catch (e) {
			if (e.code === "EEXIST") {
				try {
					const stat = fs.statSync(this.lockFilePath);
					const staleThresholdMs = Number(this.staleLockTimeoutMs ?? 30000);
					if (Date.now() - stat.mtimeMs > staleThresholdMs) {
						fs.unlinkSync(this.lockFilePath);
						lockFd = fs.openSync(this.lockFilePath, "wx");
					} else {
						return { committed: false, reason: "lock_contention" };
					}
				} catch (_) {
					return { committed: false, reason: "lock_contention" };
				}
			} else {
				const err = new Error(`STATE_BACKEND_UNAVAILABLE: Failed to acquire CAS lock: ${e.message}`);
				err.code = "STATE_BACKEND_UNAVAILABLE";
				throw err;
			}
		}

		try {
			let currentVer = 0;
			if (fs.existsSync(this.pointerPath)) {
				const ptr = JSON.parse(fs.readFileSync(this.pointerPath, "utf8"));
				currentVer = Number(ptr.stateVersion || 0);
			}
			if (currentVer !== Number(expectedVersion)) {
				return { committed: false, version: currentVer };
			}

			const serialized = JSON.stringify(nextState, null, 2);
			const sha256 = crypto.createHash("sha256").update(serialized).digest("hex");
			const nextVer = Number(nextState.stateVersion);
			const objectFile = `state-v${nextVer}-${sha256.slice(0, 12)}.json`;
			const objectPath = path.join(this.objectsDir, objectFile);
			const tmpObjectPath = `${objectPath}.tmp.${process.pid}.${Date.now()}`;

			fs.writeFileSync(tmpObjectPath, serialized, "utf8");
			fs.renameSync(tmpObjectPath, objectPath);

			// Preserve backup pointer before updating active pointer
			if (fs.existsSync(this.pointerPath)) {
				fs.copyFileSync(this.pointerPath, this.backupPointerPath);
			}

			const pointerPayload = JSON.stringify(
				{
					schemaVersion: STATE_SCHEMA_VERSION,
					scopeId: this.scopeId,
					stateVersion: nextVer,
					objectFile,
					sha256,
					updatedAt: nextState.updatedAt || toUtcIsoWithOffset(Date.now()),
				},
				null,
				2,
			);
			const tmpPointerPath = `${this.pointerPath}.tmp.${process.pid}.${Date.now()}`;
			fs.writeFileSync(tmpPointerPath, pointerPayload, "utf8");
			fs.renameSync(tmpPointerPath, this.pointerPath);

			return { committed: true, version: nextVer, objectFile, sha256 };
		} finally {
			if (lockFd !== null) {
				try {
					fs.closeSync(lockFd);
				} catch (_) {}
			}
			try {
				if (fs.existsSync(this.lockFilePath)) {
					fs.unlinkSync(this.lockFilePath);
				}
			} catch (_) {}
		}
	}

	/**
	 * Restore authoritative pointer from backup pointer or explicit snapshot object (PS-05)
	 */
	async restoreFromBackup() {
		this._ensureDirectories();
		if (!fs.existsSync(this.backupPointerPath)) {
			const err = new Error(
				`BACKUP_NOT_FOUND: No backup pointer found at '${this.backupPointerPath}'.`,
			);
			err.code = "BACKUP_NOT_FOUND";
			throw err;
		}
		fs.copyFileSync(this.backupPointerPath, this.pointerPath);
		const loaded = await this.loadState();
		return {
			restored: true,
			stateVersion: loaded.version,
			state: loaded.state,
		};
	}
}

/**
 * Factory to instantiate configured state store backend (PS-01)
 */
function createStateStore(config = {}) {
	const backend = String(config.stateBackend || "stateless").toLowerCase();
	const scopeId = config.scopeId || "global";
	const retentionPolicy = config.retentionPolicy || "standard-30d";

	if (backend === "stateless" || backend === "local-scratch") {
		return new InMemoryCasStateStore({
			scopeId,
			stateless: true,
			retentionPolicy,
		});
	}
	if (backend === "memory" || backend === "memory-cas-store") {
		return new InMemoryCasStateStore({
			scopeId,
			stateless: false,
			retentionPolicy,
			initialState: config.initialState,
			unavailable: config.backendUnavailable === true,
			corrupt: config.backendCorrupt === true,
		});
	}
	if (backend === "cas-file-store" || backend === "file") {
		return new FileCasStateStore({
			scopeId,
			stateless: false,
			retentionPolicy,
			storageDir: config.stateStorageDir || path.join(process.cwd(), ".drr-state"),
			requireExistingLedger: config.requireExistingLedger === true,
			unavailable: config.backendUnavailable === true,
		});
	}

	const err = new Error(
		`INVALID_CONFIG: Unsupported stateBackend '${config.stateBackend}'. Allowed: 'cas-file-store', 'memory-cas-store', 'stateless'.`,
	);
	err.code = "INVALID_CONFIG";
	throw err;
}

/**
 * Escape a value per RFC 4180 for CSV export
 */
function escapeCsvCell(val) {
	if (val === null || val === undefined) return "";
	const str = typeof val === "object" ? JSON.stringify(val) : String(val);
	if (/[",\r\n]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

/**
 * Extract non-PII operational ledger state in non-proprietary open formats (DPG Indicator 6).
 * Always applies secret redaction and incidental PII redaction prior to export.
 * @param {object} state - Ledger state object (from store.readState() or JSON file)
 * @param {object} options - { format?: "json"|"geojson"|"csv", scopeId?: string }
 * @returns {{ format: string, mimeType: string, content: string, summary: object }}
 */
function exportLedgerState(state = {}, options = {}) {
	const { detectAndRedactPii } = require("./security");
	const format = String(options.format || "json").toLowerCase();
	if (!["json", "geojson", "csv"].includes(format)) {
		throw new Error(`UNSUPPORTED_EXPORT_FORMAT: '${format}'. Supported non-proprietary formats: json, geojson, csv.`);
	}

	const secretSafe = redactSensitiveObject(state || {});
	const piiSafe = detectAndRedactPii(secretSafe);
	const cleanState = piiSafe.sanitized;

	const eventsObj = cleanState.events && typeof cleanState.events === "object" ? cleanState.events : {};
	const assessmentsObj = cleanState.assessments && typeof cleanState.assessments === "object" ? cleanState.assessments : {};
	const runsObj = cleanState.runs && typeof cleanState.runs === "object" ? cleanState.runs : {};
	const checkpointsObj = cleanState.checkpoints && typeof cleanState.checkpoints === "object" ? cleanState.checkpoints : {};

	const exportedAt = toUtcIsoWithOffset(Date.now());
	const summary = {
		schemaVersion: cleanState.schemaVersion || STATE_SCHEMA_VERSION,
		scopeId: cleanState.scopeId || options.scopeId || "global",
		exportedAt,
		format,
		piiExcluded: true,
		piiRedactedCount: piiSafe.piiDetectedCount,
		counts: {
			events: Object.keys(eventsObj).length,
			assessments: Object.keys(assessmentsObj).length,
			runs: Object.keys(runsObj).length,
			checkpoints: Object.keys(checkpointsObj).length,
		},
	};

	if (format === "json") {
		const payload = {
			dpgExportManifest: {
				...summary,
				standard: "DPG Standard Indicator 6 — Non-Proprietary Data Extraction",
				license: "CC-BY-4.0 / Apache-2.0",
			},
			data: {
				events: eventsObj,
				assessments: assessmentsObj,
				checkpoints: checkpointsObj,
				runs: runsObj,
			},
		};
		return {
			format: "json",
			mimeType: "application/json",
			content: JSON.stringify(payload, null, 2),
			summary,
		};
	}

	if (format === "geojson") {
		const features = [];
		for (const [eventKey, ev] of Object.entries(eventsObj)) {
			const lat = Number(ev.lat ?? ev.latitude ?? ev.coordinates?.[1]);
			const lon = Number(ev.lon ?? ev.lng ?? ev.longitude ?? ev.coordinates?.[0]);
			const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
			features.push({
				type: "Feature",
				id: eventKey,
				geometry: hasCoords ? { type: "Point", coordinates: [lon, lat] } : null,
				properties: {
					eventKey,
					sourceId: ev.sourceId || ev.source || null,
					externalEventId: ev.externalEventId || ev.externalId || null,
					hazardType: ev.hazardType || null,
					alertLevel: ev.alertLevel || null,
					magnitude: ev.magnitude ?? null,
					country: ev.country || null,
					updatedAt: ev.updatedAt || ev.lastSeenAt || null,
				},
			});
		}
		const fc = {
			type: "FeatureCollection",
			metadata: summary,
			features,
		};
		return {
			format: "geojson",
			mimeType: "application/geo+json",
			content: JSON.stringify(fc, null, 2),
			summary,
		};
	}

	// CSV export (RFC 4180) of normalized events
	const headers = [
		"eventKey",
		"sourceId",
		"externalEventId",
		"hazardType",
		"alertLevel",
		"magnitude",
		"country",
		"lat",
		"lon",
		"updatedAt",
	];
	const rows = [headers.join(",")];
	for (const [eventKey, ev] of Object.entries(eventsObj)) {
		const lat = ev.lat ?? ev.latitude ?? ev.coordinates?.[1] ?? "";
		const lon = ev.lon ?? ev.lng ?? ev.longitude ?? ev.coordinates?.[0] ?? "";
		rows.push(
			[
				eventKey,
				ev.sourceId || ev.source || "",
				ev.externalEventId || ev.externalId || "",
				ev.hazardType || "",
				ev.alertLevel || "",
				ev.magnitude ?? "",
				ev.country || "",
				lat,
				lon,
				ev.updatedAt || ev.lastSeenAt || "",
			]
				.map(escapeCsvCell)
				.join(","),
		);
	}
	return {
		format: "csv",
		mimeType: "text/csv",
		content: rows.join("\n") + "\n",
		summary,
	};
}

/**
 * Deterministic privacy-by-design data retention & erasure mechanism (DPG Indicators 7 & 9A).
 * Supports pruning expired raw snapshots (`mode: "expired"`) or full local state erasure (`mode: "all", confirm: true`).
 * @param {string} storageDir - Directory holding FileCasStateStore ledger files
 * @param {object} options - { mode?: "expired"|"all", scopeId?: string, confirm?: boolean, nowMs?: number }
 * @returns {object} Auditable purge receipt
 */
function purgeLedgerState(storageDir, options = {}) {
	if (!storageDir || typeof storageDir !== "string") {
		throw new Error("MISSING_STORAGE_DIR: storageDir is required for purgeLedgerState.");
	}
	const mode = String(options.mode || "expired").toLowerCase();
	const scopeId = String(options.scopeId || "global").replace(/[^a-zA-Z0-9._-]/g, "_");
	const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();

	if (!["expired", "all"].includes(mode)) {
		throw new Error(`INVALID_PURGE_MODE: '${mode}'. Allowed: 'expired', 'all'.`);
	}

	if (!fs.existsSync(storageDir)) {
		return {
			purged: true,
			mode,
			scopeId,
			storageDir,
			removedFiles: [],
			prunedSnapshots: 0,
			purgedAt: toUtcIsoWithOffset(nowMs),
			note: "Storage directory does not exist; no data retained.",
		};
	}

	if (mode === "all") {
		if (options.confirm !== true) {
			throw new Error("CONFIRMATION_REQUIRED: Full state erasure (mode: 'all') requires confirm: true.");
		}
		const removedFiles = [];
		const entries = fs.readdirSync(storageDir);
		for (const entry of entries) {
			const isScopeFile =
				entry.includes(`-${scopeId}.`) ||
				entry.startsWith(`ledger-${scopeId}-`) ||
				entry === `pointer-${scopeId}.json` ||
				entry === `pointer-${scopeId}.backup.json` ||
				entry === `lease-${scopeId}.json`;
			if (isScopeFile) {
				const fullPath = path.join(storageDir, entry);
				if (fs.statSync(fullPath).isFile()) {
					fs.unlinkSync(fullPath);
					removedFiles.push(entry);
				}
			}
		}
		return {
			purged: true,
			mode: "all",
			scopeId,
			storageDir,
			removedFiles,
			prunedSnapshots: 0,
			purgedAt: toUtcIsoWithOffset(nowMs),
		};
	}

	// mode === "expired": prune expired rawSnapshots in active pointer ledger
	const pointerPath = path.join(storageDir, `pointer-${scopeId}.json`);
	if (!fs.existsSync(pointerPath)) {
		return {
			purged: true,
			mode: "expired",
			scopeId,
			storageDir,
			removedFiles: [],
			prunedSnapshots: 0,
			purgedAt: toUtcIsoWithOffset(nowMs),
			note: "No active pointer file for scope; nothing to prune.",
		};
	}

	const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
	const ledgerPath = pointer.ledgerFile ? path.join(storageDir, path.basename(pointer.ledgerFile)) : null;
	if (!ledgerPath || !fs.existsSync(ledgerPath)) {
		return {
			purged: true,
			mode: "expired",
			scopeId,
			storageDir,
			removedFiles: [],
			prunedSnapshots: 0,
			purgedAt: toUtcIsoWithOffset(nowMs),
			note: "Referenced ledger file missing; nothing pruned.",
		};
	}

	const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
	let prunedSnapshots = 0;
	if (ledger.rawSnapshots && typeof ledger.rawSnapshots === "object") {
		for (const [snapId, snap] of Object.entries(ledger.rawSnapshots)) {
			const expMs = snap && snap.expiresAt ? Date.parse(snap.expiresAt) : NaN;
			if (Number.isFinite(expMs) && expMs <= nowMs) {
				delete ledger.rawSnapshots[snapId];
				prunedSnapshots++;
			}
		}
	}
	if (prunedSnapshots > 0) {
		const tmpPath = `${ledgerPath}.purge.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(ledger, null, 2), "utf8");
		fs.renameSync(tmpPath, ledgerPath);
	}

	return {
		purged: true,
		mode: "expired",
		scopeId,
		storageDir,
		removedFiles: [],
		prunedSnapshots,
		purgedAt: toUtcIsoWithOffset(nowMs),
	};
}

module.exports = {
	STATE_SCHEMA_VERSION,
	SUPPORTED_SCHEMA_VERSIONS,
	APPROVED_RETENTION_POLICIES,
	toUtcIsoWithOffset,
	stripVolatileEventFields,
	computeCanonicalEventHash,
	computeEventIdentity,
	computeAssessmentKey,
	createEmptyLedgerState,
	migrateStateSchema,
	validateLedgerStateSchema,
	validateRunRecord,
	AuthoritativeStateStore,
	InMemoryCasStateStore,
	FileCasStateStore,
	createStateStore,
	exportLedgerState,
	purgeLedgerState,
};
