/**
 * Security, Authorization, Publication Policy, Idempotency, Audit Logging,
 * XML Safety, and Untrusted-Feed Sanitization Layer (R-06, R-07, C-07).
 *
 * Pure Node.js standard library only.
 */

const crypto = require("crypto");
const { isBlockedWebhookHost, redactUrlSecrets } = require("./config");

const POLICY_VERSION = "2026.11-drr-policy-v1";
const SECRET_KEYS_RE = /^(?:apikey|api_key|token|access_token|secret|password|x-auth|authorization|key|private_key|hmac_secret)$/i;

// Process-scoped ephemeral HMAC secret fallback for local/test signed approvals
// Production deployments should configure DRR_APPROVAL_HMAC_SECRET
const EPHEMERAL_HMAC_KEY = crypto.randomBytes(32).toString("hex");

function getApprovalSigningSecret() {
	return process.env.DRR_APPROVAL_HMAC_SECRET || EPHEMERAL_HMAC_KEY;
}

const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_REDACT_DEPTH = 20;
const MAX_IDEMPOTENCY_RECORDS = 5000;
const MAX_XML_SAFETY_BYTES = 2 * 1024 * 1024; // 2 MB cap for CAP XML validation

/**
 * Redact secrets recursively from logs and audit events (hardened against prototype pollution & circular refs)
 */
function redactSensitiveObject(obj, _depth = 0, _seen = new WeakSet()) {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj === "string") {
		return redactUrlSecrets(obj)
			.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
			.replace(/(X-Auth["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[REDACTED]");
	}
	if (typeof obj !== "object") return obj;
	if (_depth > MAX_REDACT_DEPTH) return "[MAX_DEPTH_REDACTED]";
	if (_seen.has(obj)) return "[CIRCULAR_REDACTED]";
	_seen.add(obj);

	if (Array.isArray(obj)) {
		const arrOut = obj.map((v) => redactSensitiveObject(v, _depth + 1, _seen));
		_seen.delete(obj);
		return arrOut;
	}
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (DANGEROUS_OBJECT_KEYS.has(k)) continue;
		if (SECRET_KEYS_RE.test(k)) {
			out[k] = "[REDACTED]";
		} else {
			out[k] = redactSensitiveObject(v, _depth + 1, _seen);
		}
	}
	_seen.delete(obj);
	return out;
}

/**
 * Compute SHA-256 hash of a string or JSON payload
 */
function computePayloadHash(payload) {
	const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
	return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

/**
 * Issue a signed approval record bound to payloadHash, destination, and policyVersion.
 * Represents an authorized human/policy decision outside LLM arguments.
 */
function issueApprovalToken(params = {}) {
	if (!params.actorId || !params.actorRole) {
		throw new Error("Approval issuance requires actorId and actorRole.");
	}
	if (!params.payloadHash) {
		throw new Error("Approval issuance requires payloadHash.");
	}
	if (!params.destination) {
		throw new Error("Approval issuance requires destination.");
	}
	const issuedAt = params.issuedAt || new Date().toISOString();
	const ttlSeconds = Number.isFinite(params.ttlSeconds) ? params.ttlSeconds : 3600;
	const expiresAt = params.expiresAt || new Date(Date.parse(issuedAt) + ttlSeconds * 1000).toISOString();
	const policyVersion = params.policyVersion || POLICY_VERSION;
	const approvalId = params.approvalId || `appr_${crypto.randomBytes(8).toString("hex")}`;

	const canonical = JSON.stringify({
		approvalId,
		actorId: params.actorId,
		actorRole: params.actorRole,
		payloadHash: params.payloadHash,
		destination: params.destination,
		policyVersion,
		issuedAt,
		expiresAt,
	});
	const signature = crypto
		.createHmac("sha256", params.signingSecret || getApprovalSigningSecret())
		.update(canonical)
		.digest("hex");

	return {
		approvalId,
		actorId: params.actorId,
		actorRole: params.actorRole,
		payloadHash: params.payloadHash,
		destination: params.destination,
		policyVersion,
		issuedAt,
		expiresAt,
		signature,
	};
}

/**
 * Verify an approval token against the exact payloadHash, destination, policyVersion, and expiry.
 * Blocks self-asserted LLM `{ approved: true }` objects.
 */
function verifyApprovalToken(token, expected = {}) {
	if (!token || typeof token !== "object") {
		return { valid: false, reason: "Missing approval token object." };
	}
	if (!token.signature || !token.actorId || !token.actorRole || !token.payloadHash || !token.destination) {
		return {
			valid: false,
			reason: "Unverified or self-asserted approval rejected: missing cryptographic signature or bound actor/payload fields.",
		};
	}

	const allowedRoles = expected.allowedRoles || ["eoc_duty_officer", "national_focal_point", "cap_issuer", "admin"];
	if (!allowedRoles.includes(token.actorRole)) {
		return {
			valid: false,
			reason: `Actor role '${token.actorRole}' is not authorized for this action.`,
		};
	}

	const policyVersion = token.policyVersion || POLICY_VERSION;
	if (expected.policyVersion && policyVersion !== expected.policyVersion) {
		return {
			valid: false,
			reason: `Approval policyVersion '${policyVersion}' does not match active policy '${expected.policyVersion}'.`,
		};
	}

	if (expected.payloadHash && token.payloadHash !== expected.payloadHash) {
		return {
			valid: false,
			reason: "Approval payloadHash mismatch: payload was modified after approval.",
		};
	}

	if (expected.destination && token.destination !== expected.destination) {
		return {
			valid: false,
			reason: `Approval destination '${token.destination}' does not match target destination '${expected.destination}'.`,
		};
	}

	if (token.expiresAt && Date.parse(token.expiresAt) < Date.now()) {
		return {
			valid: false,
			reason: `Approval token '${token.approvalId}' expired at ${token.expiresAt}.`,
		};
	}

	const canonical = JSON.stringify({
		approvalId: token.approvalId,
		actorId: token.actorId,
		actorRole: token.actorRole,
		payloadHash: token.payloadHash,
		destination: token.destination,
		policyVersion,
		issuedAt: token.issuedAt,
		expiresAt: token.expiresAt,
	});
	const expectedSig = crypto
		.createHmac("sha256", expected.signingSecret || getApprovalSigningSecret())
		.update(canonical)
		.digest("hex");

	const actualBuf = Buffer.from(String(token.signature), "utf8");
	const expectedBuf = Buffer.from(expectedSig, "utf8");
	if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
		return {
			valid: false,
			reason: "Approval signature verification failed.",
		};
	}

	return {
		valid: true,
		verified: true,
		approvalId: token.approvalId,
		actorId: token.actorId,
		actorRole: token.actorRole,
		policyVersion,
		payloadHash: token.payloadHash,
		destination: token.destination,
	};
}

/**
 * Validate destination against allowlist and SSRF guard
 */
function validateDestination(destination, options = {}) {
	if (!destination || typeof destination !== "string") {
		return { allowed: false, reason: "Missing destination." };
	}

	const trimmed = destination.trim();
	const channelType = options.channelType || "sandbox"; // "sandbox" | "production"

	// Sandbox/local artifact destinations
	if (trimmed.startsWith("sandbox://") || trimmed.startsWith("mock://")) {
		return { allowed: true, channelType: "sandbox", destination: trimmed };
	}

	let parsed;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { allowed: false, reason: `Invalid destination URL '${redactUrlSecrets(trimmed)}'.` };
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { allowed: false, reason: `Unsupported protocol '${parsed.protocol}' for destination.` };
	}

	if (!options.allowPrivateHosts && isBlockedWebhookHost(parsed.hostname)) {
		return {
			allowed: false,
			reason: `SSRF guard blocked private/local destination host '${parsed.hostname}'.`,
		};
	}

	const allowlistEnv = process.env.DRR_ALLOWED_DESTINATIONS
		? process.env.DRR_ALLOWED_DESTINATIONS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
		: null;
	const allowlist = Array.isArray(options.allowedDestinations)
		? options.allowedDestinations.map((s) => String(s).trim().toLowerCase())
		: allowlistEnv;

	if (allowlist && allowlist.length > 0) {
		const host = parsed.hostname.toLowerCase();
		const hostPort = parsed.host.toLowerCase();
		const matched = allowlist.some(
			(allowed) => host === allowed || hostPort === allowed || host.endsWith(`.${allowed}`),
		);
		if (!matched) {
			return {
				allowed: false,
				reason: `Destination host '${parsed.hostname}' is not in DRR_ALLOWED_DESTINATIONS allowlist.`,
			};
		}
	} else if (channelType === "production") {
		return {
			allowed: false,
			reason: "Production destination requires explicit allowlist configuration (DRR_ALLOWED_DESTINATIONS or allowedDestinations).",
		};
	}

	return { allowed: true, channelType, destination: trimmed, hostname: parsed.hostname };
}

/**
 * Enforce tenant / country account isolation across read/write actions
 */
function enforceTenantIsolation(context = {}) {
	const actorTenant = context.actorTenant || process.env.DRR_TENANT_ID || process.env.DELTA_COUNTRY || null;
	const targetTenant = context.targetTenant || context.countryAccountsId || context.country || null;
	const strict = context.strictTenantIsolation !== false;

	if (!strict) return { allowed: true };
	if (!actorTenant || actorTenant === "*") return { allowed: true };
	if (!targetTenant) {
		return {
			allowed: false,
			reason: `Tenant isolation violation: target tenant/country missing while scoped to '${actorTenant}'.`,
		};
	}

	const normActor = String(actorTenant).toLowerCase().trim();
	const normTarget = String(targetTenant).toLowerCase().trim();
	if (normActor !== normTarget) {
		return {
			allowed: false,
			reason: `Cross-tenant write blocked: actor tenant '${actorTenant}' cannot write to target tenant '${targetTenant}'.`,
		};
	}

	return { allowed: true, tenant: actorTenant };
}

/**
 * In-memory idempotency ledger & audit log
 */
class ActionPolicyGuard {
	constructor() {
		this.idempotencyRecords = new Map();
		this.auditLog = [];
	}

	recordAudit(entry) {
		const record = redactSensitiveObject({
			auditId: `aud_${crypto.randomBytes(6).toString("hex")}`,
			timestamp: new Date().toISOString(),
			policyVersion: POLICY_VERSION,
			...entry,
		});
		this.auditLog.push(record);
		if (this.auditLog.length > 1000) {
			this.auditLog.shift();
		}
		return record;
	}

	getAuditLog(limit = 50) {
		return this.auditLog.slice(-limit);
	}

	checkAndRegisterIdempotency(actionType, idempotencyKey, payloadHash) {
		if (!idempotencyKey) return { duplicate: false };
		const compositeKey = `${actionType}::${idempotencyKey}`;
		const existing = this.idempotencyRecords.get(compositeKey);
		if (existing) {
			return {
				duplicate: true,
				existing,
				samePayload: existing.payloadHash === payloadHash,
			};
		}
		return { duplicate: false, compositeKey };
	}

	commitIdempotency(compositeKey, metadata) {
		if (!compositeKey) return;
		if (
			!this.idempotencyRecords.has(compositeKey) &&
			this.idempotencyRecords.size >= MAX_IDEMPOTENCY_RECORDS
		) {
			const oldestKey = this.idempotencyRecords.keys().next().value;
			if (oldestKey !== undefined) {
				this.idempotencyRecords.delete(oldestKey);
			}
		}
		this.idempotencyRecords.set(compositeKey, {
			...metadata,
			committedAt: new Date().toISOString(),
		});
	}
}

const DEFAULT_POLICY_GUARD = new ActionPolicyGuard();

/**
 * Executable Authorization & Policy Check at Terminal Action Boundary (R-06, R-07, C-07)
 */
function evaluateActionPolicy(request = {}, guard = DEFAULT_POLICY_GUARD) {
	const {
		action = "read", // "read" | "draft_write" | "publish_cap" | "webhook_dispatch" | "delta_production_write"
		permissionScope = "read_only", // "read_only" | "draft_write" | "publish_cap" | "admin"
		channelType = "sandbox", // "sandbox" | "production"
		destination = "sandbox://local",
		payload = null,
		capStatus = null,
		approvalToken = null,
		idempotencyKey = null,
		tenantContext = null,
		allowedDestinations = null,
		allowPrivateHosts = false,
		signingSecret = null,
		commitOnAllow = false,
	} = request;

	const payloadHash = computePayloadHash(payload);

	// 1. Read vs Write privilege separation
	const scopePermissions = {
		read_only: new Set(["read"]),
		draft_write: new Set(["read", "draft_write"]),
		publish_cap: new Set(["read", "draft_write", "publish_cap", "webhook_dispatch"]),
		admin: new Set(["read", "draft_write", "publish_cap", "webhook_dispatch", "delta_production_write"]),
	};
	const allowedActions = scopePermissions[permissionScope] || scopePermissions.read_only;
	if (!allowedActions.has(action)) {
		const audit = guard.recordAudit({
			action,
			decision: "DENY",
			reason: `Least-privilege violation: scope '${permissionScope}' is not permitted to perform '${action}'.`,
			destination: redactUrlSecrets(destination),
			payloadHash,
		});
		return { allowed: false, decision: "DENY", code: "INSUFFICIENT_SCOPE", reason: audit.reason, audit };
	}

	// 2. Tenant isolation check for writes
	if (action !== "read" && tenantContext) {
		const tenantCheck = enforceTenantIsolation(tenantContext);
		if (!tenantCheck.allowed) {
			const audit = guard.recordAudit({
				action,
				decision: "DENY",
				reason: tenantCheck.reason,
				destination: redactUrlSecrets(destination),
				payloadHash,
			});
			return { allowed: false, decision: "DENY", code: "TENANT_ISOLATION_VIOLATION", reason: tenantCheck.reason, audit };
		}
	}

	// 3. Draft/Test/Exercise messages cannot use production channels (R-07)
	if (channelType === "production" && capStatus && ["Draft", "Test", "Exercise"].includes(capStatus)) {
		const reason = `CAP safety violation: message with status '${capStatus}' cannot be published to a production channel.`;
		const audit = guard.recordAudit({ action, decision: "DENY", reason, destination, payloadHash });
		return { allowed: false, decision: "DENY", code: "NON_ACTUAL_CAP_ON_PRODUCTION", reason, audit };
	}

	// 4. Destination allowlist + SSRF
	if (action === "publish_cap" || action === "webhook_dispatch" || action === "delta_production_write") {
		const destCheck = validateDestination(destination, {
			channelType,
			allowedDestinations,
			allowPrivateHosts,
		});
		if (!destCheck.allowed) {
			const audit = guard.recordAudit({
				action,
				decision: "DENY",
				reason: destCheck.reason,
				destination: redactUrlSecrets(destination),
				payloadHash,
			});
			return { allowed: false, decision: "DENY", code: "DESTINATION_BLOCKED", reason: destCheck.reason, audit };
		}
	}

	// 5. Production publication disabled by default & requires verified approval token bound to payloadHash & destination
	const isConsequentialProduction =
		channelType === "production" &&
		(action === "publish_cap" || action === "delta_production_write" || action === "webhook_dispatch");

	let verifiedApproval = null;
	if (isConsequentialProduction) {
		const prodEnabled = process.env.DRR_ENABLE_PRODUCTION_PUBLISH === "true" || request.productionEnabledOverride === true;
		if (!prodEnabled) {
			const reason = "Production publication is disabled by policy (DRR_ENABLE_PRODUCTION_PUBLISH !== 'true'). Use sandbox mode or complete authorized deployment gate.";
			const audit = guard.recordAudit({ action, decision: "DENY", reason, destination, payloadHash });
			return { allowed: false, decision: "DENY", code: "PRODUCTION_DISABLED", reason, audit };
		}

		const tokenCheck = verifyApprovalToken(approvalToken, {
			payloadHash,
			destination,
			policyVersion: POLICY_VERSION,
			signingSecret,
		});
		if (!tokenCheck.valid) {
			const audit = guard.recordAudit({
				action,
				decision: "DENY",
				reason: tokenCheck.reason,
				destination: redactUrlSecrets(destination),
				payloadHash,
			});
			return { allowed: false, decision: "DENY", code: "APPROVAL_REQUIRED", reason: tokenCheck.reason, audit };
		}
		verifiedApproval = tokenCheck;
	}

	// 6. Idempotency check
	if (idempotencyKey) {
		const idemCheck = guard.checkAndRegisterIdempotency(action, idempotencyKey, payloadHash);
		if (idemCheck.duplicate) {
			const reason = `Duplicate action blocked by idempotency guard for key '${idempotencyKey}'.`;
			const audit = guard.recordAudit({
				action,
				decision: "DENY_DUPLICATE",
				reason,
				idempotencyKey,
				payloadHash,
			});
			return {
				allowed: false,
				duplicate: true,
				decision: "DENY_DUPLICATE",
				code: "DUPLICATE_ACTION",
				reason,
				existingRecord: idemCheck.existing,
				audit,
			};
		}
		if (commitOnAllow) {
			guard.commitIdempotency(idemCheck.compositeKey, { payloadHash, destination });
		}
	}

	const audit = guard.recordAudit({
		action,
		decision: "ALLOW",
		channelType,
		destination: redactUrlSecrets(destination),
		payloadHash,
		approvalId: verifiedApproval?.approvalId || null,
		actorId: verifiedApproval?.actorId || null,
	});

	return {
		allowed: true,
		decision: "ALLOW",
		payloadHash,
		policyVersion: POLICY_VERSION,
		verifiedApproval,
		audit,
	};
}

/**
 * Harden XML parsing against XXE, external entity expansion, DTDs, and Billion Laughs (R-06)
 */
function validateXmlSafety(xmlString) {
	const errors = [];
	if (typeof xmlString !== "string" || !xmlString.trim()) {
		return { safe: false, errors: ["Empty or non-string XML input."] };
	}
	if (Buffer.byteLength(xmlString, "utf8") > MAX_XML_SAFETY_BYTES) {
		return {
			safe: false,
			errors: [`XML security violation: input exceeds maximum allowed size (${MAX_XML_SAFETY_BYTES} bytes).`],
		};
	}
	if (/<!DOCTYPE\b/i.test(xmlString)) {
		errors.push("XML security violation: <!DOCTYPE declarations are forbidden (XXE/DTD defense).");
	}
	if (/<!ENTITY\b/i.test(xmlString)) {
		errors.push("XML security violation: <!ENTITY declarations are forbidden (XXE/billion-laughs defense).");
	}
	if (/<!ELEMENT\b|<!ATTLIST\b|<!NOTATION\b/i.test(xmlString)) {
		errors.push("XML security violation: DTD subset declarations are forbidden.");
	}
	if (/\b(?:SYSTEM|PUBLIC)\s+["']/i.test(xmlString)) {
		errors.push("XML security violation: external SYSTEM/PUBLIC resource references are forbidden.");
	}
	if (/<\?xml-stylesheet\b/i.test(xmlString)) {
		errors.push("XML security violation: xml-stylesheet processing instructions are forbidden.");
	}
	// Check for unescaped custom entity expansions (allow only XML predefined 5 + numeric char refs)
	const entityRefs = xmlString.match(/&[A-Za-z_][A-Za-z0-9._-]*;/g) || [];
	const allowedEntities = new Set(["&amp;", "&lt;", "&gt;", "&quot;", "&apos;"]);
	for (const ref of entityRefs) {
		if (!allowedEntities.has(ref)) {
			errors.push(`XML security violation: custom entity reference '${ref}' is forbidden.`);
			break;
		}
	}

	return {
		safe: errors.length === 0,
		errors,
	};
}

const PROMPT_INJECTION_PATTERNS = [
	/ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i,
	/system\s*prompt/i,
	/disregard\s+(?:the\s+)?(?:rules|constraints|policy)/i,
	/override\s+(?:authorization|approval|security)/i,
	/execute\s+(?:tool|command|shell|bash|drr_delta_push|drr_cap_publish)/i,
	/\bapproved\s*:\s*true\b/i,
	/<\s*script\b/i,
];

/**
 * Detect prompt-injection patterns in external feed descriptions and treat feed text strictly as untrusted data (R-06)
 */
function sanitizeUntrustedFeedText(text, maxLength = 2000) {
	if (text === null || text === undefined) {
		return { text: "", untrustedData: true, injectionDetected: false, matchedPatterns: [] };
	}
	let cleaned = String(text).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
	if (cleaned.length > maxLength) {
		cleaned = cleaned.slice(0, maxLength) + "...";
	}
	const matchedPatterns = [];
	for (const re of PROMPT_INJECTION_PATTERNS) {
		if (re.test(cleaned)) {
			matchedPatterns.push(re.source);
		}
	}
	return {
		text: cleaned,
		untrustedData: true,
		injectionDetected: matchedPatterns.length > 0,
		matchedPatterns,
	};
}

module.exports = {
	POLICY_VERSION,
	ActionPolicyGuard,
	DEFAULT_POLICY_GUARD,
	redactSensitiveObject,
	computePayloadHash,
	issueApprovalToken,
	verifyApprovalToken,
	validateDestination,
	enforceTenantIsolation,
	evaluateActionPolicy,
	validateXmlSafety,
	sanitizeUntrustedFeedText,
};
