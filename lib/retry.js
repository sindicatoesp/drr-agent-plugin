/**
 * Bounded Transient Retry, Rate-Limit, Failure Classification & Source Freshness Engine
 * (RT-01, RT-02, RT-03, RT-04)
 *
 * Implements:
 * - RT-01: Failure classification (retryable transient errors vs. permanent auth/config/schema errors, endpoint-aware 404).
 * - RT-02: Exponential backoff with deterministic/injectable jitter, cap, Retry-After parsing, provider delay budget enforcement, and overall deadline enforcement.
 * - RT-03: Single-layer retry ownership, per-provider concurrency limiting, aggregate request budget, and per-source backpressure/degradation.
 * - RT-04: Source-issue-time freshness evaluation with provider/product-specific thresholds and explicit stale/synthetic/cached labelling.
 *
 * Pure Node.js standard library only.
 */

const { redactUrlSecrets } = require("./config");
const { redactSensitiveObject } = require("./security");

const RETRY_SCHEMA_VERSION = "1.0";

const TRANSIENT_NETWORK_CODES = new Set([
	"ETIMEDOUT",
	"ECONNRESET",
	"ECONNREFUSED",
	"EAI_AGAIN",
	"ENOTFOUND",
	"EPIPE",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_SOCKET",
]);

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const PERMANENT_HTTP_STATUS = new Set([400, 401, 403, 405, 406, 410, 422]);

/**
 * Provider-informed default freshness thresholds (milliseconds) based on source issue time (RT-04).
 * Evaluated against sourceIssuedAt, never merely retrieval time.
 */
const DEFAULT_FRESHNESS_THRESHOLDS_MS = {
	usgs: 24 * 60 * 60 * 1000, // 24h window for seismic event feed freshness
	gdacs: 48 * 60 * 60 * 1000, // 48h window for active global alert bulleting updates
	openmeteo: 18 * 60 * 60 * 1000, // 18h NWP model cycle freshness (6h/12h synoptic runs + dissemination)
};

/**
 * Parse HTTP Retry-After header (seconds integer or HTTP-date string) into delay in milliseconds (RT-02)
 * @param {string|number|null|undefined} headerValue
 * @param {number} nowMs - Current epoch timestamp in ms
 * @returns {number|null} Minimum delay in ms or null if not present/valid
 */
function parseRetryAfterMs(headerValue, nowMs = Date.now()) {
	if (headerValue === null || headerValue === undefined || headerValue === "") {
		return null;
	}
	const raw = String(headerValue).trim();
	if (/^\d+$/.test(raw)) {
		const seconds = parseInt(raw, 10);
		return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
	}
	const parsedDateMs = Date.parse(raw);
	if (!Number.isNaN(parsedDateMs)) {
		return Math.max(0, parsedDateMs - nowMs);
	}
	return null;
}

/**
 * Classify an operational or transport error into structured retryable vs permanent categories (RT-01)
 * @param {Error|object} err
 * @param {object} context - { provider, endpointType, notFoundRetryable }
 * @returns {object} { category, code, statusCode, retryable, retryAfterMs, message }
 */
function classifyError(err, context = {}) {
	if (!err) {
		return {
			category: "unknown_error",
			code: "UNKNOWN_ERROR",
			statusCode: null,
			retryable: false,
			retryAfterMs: null,
			message: "Unknown error",
		};
	}

	const rawMsg = redactSensitiveObject(String(err.message || err));
	const statusCode =
		typeof err.statusCode === "number"
			? err.statusCode
			: (() => {
					const m = rawMsg.match(/\bHTTP\s+(\d{3})\b/i);
					return m ? parseInt(m[1], 10) : null;
				})();

	const nowMs = typeof context.nowMs === "number" ? context.nowMs : Date.now();
	const retryAfterMs =
		typeof err.retryAfterMs === "number"
			? err.retryAfterMs
			: parseRetryAfterMs(err.retryAfter || err.headers?.["retry-after"], nowMs);

	// Cancellation / Deadline
	if (
		err.name === "AbortError" ||
		err.code === "ABORT_ERR" ||
		err.code === "RUN_DEADLINE_EXCEEDED" ||
		/aborted|cancelled|run deadline/i.test(rawMsg)
	) {
		return {
			category: "cancelled_or_deadline",
			code: err.code || "CANCELLED",
			statusCode,
			retryable: false,
			retryAfterMs: null,
			message: rawMsg,
		};
	}

	// Non-retryable configuration / contract / schema / model domain errors
	if (
		err.code === "INVALID_CONFIG" ||
		err.code === "SCHEMA_MISMATCH" ||
		err.code === "UNSUPPORTED_MODEL_INPUT" ||
		err.code === "MISSING_REQUIRED_INPUT" ||
		err.code === "OUT_OF_DOMAIN_INPUT" ||
		err.code === "UNIT_MISMATCH" ||
		/DRR_OFFLINE_MODE|Invalid URL|Unsupported protocol|Failed to parse JSON|missing features array|INVALID_FORECAST_INPUT/i.test(
			rawMsg,
		)
	) {
		return {
			category: /Failed to parse JSON|missing features array|INVALID_FORECAST_INPUT/i.test(rawMsg)
				? "schema_mismatch"
				: "invalid_configuration_or_input",
			code: err.code || "NON_RETRYABLE_CONTRACT_ERROR",
			statusCode,
			retryable: false,
			retryAfterMs: null,
			message: rawMsg,
		};
	}

	// HTTP Status Classification
	if (statusCode !== null) {
		if (statusCode === 401 || statusCode === 403) {
			return {
				category: statusCode === 401 ? "authentication_failure" : "authorization_failure",
				code: `HTTP_${statusCode}`,
				statusCode,
				retryable: false,
				retryAfterMs: null,
				message: rawMsg,
			};
		}
		if (statusCode === 404) {
			// RT-01: Classify 404 according to endpoint contract, not a universal rule
			const retryable404 = context.notFoundRetryable === true || context.endpointType === "ephemeral_artifact";
			return {
				category: "not_found",
				code: "HTTP_404",
				statusCode: 404,
				retryable: retryable404,
				retryAfterMs: null,
				message: rawMsg,
			};
		}
		if (statusCode === 429) {
			return {
				category: "rate_limited",
				code: "HTTP_429",
				statusCode: 429,
				retryable: true,
				retryAfterMs,
				message: rawMsg,
			};
		}
		if (RETRYABLE_HTTP_STATUS.has(statusCode)) {
			return {
				category: statusCode === 408 ? "request_timeout" : "server_error",
				code: `HTTP_${statusCode}`,
				statusCode,
				retryable: true,
				retryAfterMs,
				message: rawMsg,
			};
		}
		if (PERMANENT_HTTP_STATUS.has(statusCode) || (statusCode >= 400 && statusCode < 500)) {
			return {
				category: "client_error",
				code: `HTTP_${statusCode}`,
				statusCode,
				retryable: false,
				retryAfterMs: null,
				message: rawMsg,
			};
		}
	}

	// Network / Timeout errors
	if (
		TRANSIENT_NETWORK_CODES.has(err.code) ||
		/timed out|timeout|socket hang up|ECONNRESET|ECONNREFUSED|EAI_AGAIN|Network error querying/i.test(rawMsg)
	) {
		return {
			category: /timed out|timeout/i.test(rawMsg) ? "request_timeout" : "connection_interruption",
			code: err.code || "TRANSIENT_NETWORK_ERROR",
			statusCode: null,
			retryable: true,
			retryAfterMs,
			message: rawMsg,
		};
	}

	return {
		category: "unclassified_error",
		code: err.code || "UNCLASSIFIED_ERROR",
		statusCode,
		retryable: false,
		retryAfterMs: null,
		message: rawMsg,
	};
}

/**
 * Compute exponential backoff with jitter and cap (RT-02)
 * @param {number} attemptIndex - 1-based retry index (1 for first retry after initial attempt)
 * @param {object} options - { backoffBaseMs, backoffCapMs, randomFn, retryAfterMs, minProviderDelayMs }
 * @returns {number} Computed delay in milliseconds
 */
function computeBackoffDelayMs(attemptIndex, options = {}) {
	const baseMs = Math.max(1, Number(options.backoffBaseMs ?? 200));
	const capMs = Math.max(baseMs, Number(options.backoffCapMs ?? 5000));
	const randomFn = typeof options.randomFn === "function" ? options.randomFn : Math.random;

	const exp = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attemptIndex - 1)));
	// Full/equal jitter between [0.5 * exp, 1.0 * exp] for predictable bounded spread
	const jitterFactor = 0.5 + 0.5 * Math.max(0, Math.min(1, Number(randomFn())));
	let delayMs = Math.round(exp * jitterFactor);
	delayMs = Math.min(capMs, Math.max(baseMs, delayMs));

	const minProviderDelay = Math.max(
		Number(options.retryAfterMs || 0),
		Number(options.minProviderDelayMs || 0),
	);
	if (minProviderDelay > delayMs) {
		delayMs = minProviderDelay;
	}
	return delayMs;
}

/**
 * Default cancellable sleep implementation supporting injected clock/sleep
 */
function defaultSleep(ms, signal = null) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			const abortErr = new Error("Sleep aborted by cancellation signal");
			abortErr.code = "ABORT_ERR";
			return reject(abortErr);
		}
		let timer = null;
		const onAbort = () => {
			if (timer) clearTimeout(timer);
			const abortErr = new Error("Sleep aborted by cancellation signal");
			abortErr.code = "ABORT_ERR";
			reject(abortErr);
		};
		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
		}
		timer = setTimeout(() => {
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
			resolve();
		}, ms);
		if (timer && typeof timer.unref === "function") {
			// Do not hold event loop open if caller exits
		}
	});
}

/**
 * Per-provider request budget & concurrency limiter (RT-02, RT-03)
 */
class ProviderBudgetTracker {
	constructor(options = {}) {
		this.maxRequestsPerProvider = options.maxRequestsPerProvider ?? 6;
		this.maxConcurrentPerProvider = options.maxConcurrentPerProvider ?? 2;
		this.stats = new Map();
	}

	_getEntry(provider) {
		const key = String(provider || "default").toLowerCase();
		if (!this.stats.has(key)) {
			this.stats.set(key, {
				provider: key,
				totalRequests: 0,
				inFlight: 0,
				retries: 0,
				deferredCount: 0,
				degraded: false,
				terminalCategory: null,
			});
		}
		return this.stats.get(key);
	}

	canAcquire(provider) {
		const entry = this._getEntry(provider);
		if (entry.totalRequests >= this.maxRequestsPerProvider) {
			return {
				allowed: false,
				reason: "provider_request_budget_exhausted",
				message: `Provider '${entry.provider}' reached aggregate request budget (${entry.totalRequests}/${this.maxRequestsPerProvider}).`,
			};
		}
		if (entry.inFlight >= this.maxConcurrentPerProvider) {
			return {
				allowed: false,
				reason: "provider_concurrency_limit_reached",
				message: `Provider '${entry.provider}' reached parallel request limit (${entry.inFlight}/${this.maxConcurrentPerProvider}).`,
			};
		}
		return { allowed: true };
	}

	acquire(provider, isRetry = false) {
		const entry = this._getEntry(provider);
		entry.totalRequests++;
		entry.inFlight++;
		if (isRetry) entry.retries++;
	}

	release(provider) {
		const entry = this._getEntry(provider);
		entry.inFlight = Math.max(0, entry.inFlight - 1);
	}

	markDegraded(provider, category) {
		const entry = this._getEntry(provider);
		entry.degraded = true;
		entry.terminalCategory = category;
	}

	markDeferred(provider) {
		const entry = this._getEntry(provider);
		entry.deferredCount++;
		entry.degraded = true;
		entry.terminalCategory = "deferred_rate_limit_exceeds_budget";
	}

	getSummary() {
		const out = {};
		for (const [k, v] of this.stats.entries()) {
			out[k] = { ...v };
		}
		return out;
	}
}

/**
 * Execute a bounded operation with retry policy, backoff, Retry-After support, and deadline enforcement (RT-01, RT-02, RT-03)
 * @param {Function} operationFn - async ({ attempt, timeoutMs, signal }) => result
 * @param {object} options
 * @returns {Promise<object>} { ok, value, attempts, attemptLog, terminalError, deferred }
 */
async function executeWithRetry(operationFn, options = {}) {
	const provider = String(options.provider || "default").toLowerCase();
	const maxAttempts = Math.max(1, Math.min(10, Number(options.maxAttempts ?? 3)));
	const backoffBaseMs = Math.max(1, Number(options.backoffBaseMs ?? 200));
	const backoffCapMs = Math.max(backoffBaseMs, Number(options.backoffCapMs ?? 5000));
	const maxRetryElapsedMs = Number(options.maxRetryElapsedMs ?? 15000);
	const requestTimeoutMs = Math.max(50, Number(options.requestTimeoutMs ?? 5000));
	const minProviderDelayMs = Number(options.minProviderDelayMs ?? 0);
	const runDeadlineEpochMs = options.runDeadlineEpochMs || null;
	const reserveCleanupMs = Number(options.reserveCleanupMs ?? 250);
	const nowFn = typeof options.nowFn === "function" ? options.nowFn : () => Date.now();
	const sleepFn = typeof options.sleepFn === "function" ? options.sleepFn : defaultSleep;
	const randomFn = typeof options.randomFn === "function" ? options.randomFn : Math.random;
	const signal = options.signal || null;
	const budgetTracker = options.budgetTracker || new ProviderBudgetTracker();
	const isWriteOperation = options.isWriteOperation === true;
	const writeIdempotentVerified = options.writeIdempotentVerified === true;

	// RT-03: Never retry writes unless idempotency is verified
	const effectiveMaxAttempts = isWriteOperation && !writeIdempotentVerified ? 1 : maxAttempts;

	const startEpochMs = nowFn();
	const attemptLog = [];

	for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
		if (signal?.aborted) {
			const abortClassification = {
				category: "cancelled_or_deadline",
				code: "ABORT_ERR",
				statusCode: null,
				retryable: false,
				message: "Operation cancelled by signal before attempt.",
			};
			budgetTracker.markDegraded(provider, abortClassification.category);
			return {
				ok: false,
				value: null,
				attempts: attempt - 1,
				attemptLog,
				terminalError: abortClassification,
				deferred: false,
			};
		}

		const nowMs = nowFn();
		if (runDeadlineEpochMs !== null) {
			const remainingMs = runDeadlineEpochMs - nowMs - reserveCleanupMs;
			if (remainingMs <= 0) {
				const deadlineErr = {
					category: "cancelled_or_deadline",
					code: "RUN_DEADLINE_EXCEEDED",
					statusCode: null,
					retryable: false,
					message: `Run deadline reached before attempt ${attempt} for provider '${provider}'.`,
				};
				budgetTracker.markDegraded(provider, deadlineErr.category);
				return {
					ok: false,
					value: null,
					attempts: attempt - 1,
					attemptLog,
					terminalError: deadlineErr,
					deferred: false,
				};
			}
		}

		const budgetCheck = budgetTracker.canAcquire(provider);
		if (!budgetCheck.allowed) {
			const budgetErr = {
				category: "budget_or_concurrency_exhausted",
				code: budgetCheck.reason.toUpperCase(),
				statusCode: null,
				retryable: false,
				message: budgetCheck.message,
			};
			budgetTracker.markDegraded(provider, budgetErr.category);
			return {
				ok: false,
				value: null,
				attempts: attempt - 1,
				attemptLog,
				terminalError: budgetErr,
				deferred: false,
			};
		}

		// Bound per-attempt timeout to remaining run budget
		let attemptTimeoutMs = requestTimeoutMs;
		if (runDeadlineEpochMs !== null) {
			const remainingForAttempt = runDeadlineEpochMs - nowMs - reserveCleanupMs;
			attemptTimeoutMs = Math.max(50, Math.min(requestTimeoutMs, remainingForAttempt));
		}

		budgetTracker.acquire(provider, attempt > 1);
		const attemptStartMs = nowFn();
		try {
			const value = await operationFn({
				attempt,
				timeoutMs: attemptTimeoutMs,
				signal,
			});
			budgetTracker.release(provider);
			const durationMs = Math.max(0, nowFn() - attemptStartMs);
			attemptLog.push({
				attempt,
				status: "success",
				durationMs,
			});
			return {
				ok: true,
				value,
				attempts: attempt,
				attemptLog,
				terminalError: null,
				deferred: false,
			};
		} catch (err) {
			budgetTracker.release(provider);
			const durationMs = Math.max(0, nowFn() - attemptStartMs);
			const classified = classifyError(err, {
				provider,
				endpointType: options.endpointType,
				notFoundRetryable: options.notFoundRetryable,
				nowMs: nowFn(),
			});

			attemptLog.push({
				attempt,
				status: "failed",
				durationMs,
				category: classified.category,
				code: classified.code,
				statusCode: classified.statusCode,
				retryable: classified.retryable,
				retryAfterMs: classified.retryAfterMs,
				message: redactUrlSecrets(classified.message),
			});

			// Stop immediately if non-retryable or last attempt
			if (!classified.retryable || attempt >= effectiveMaxAttempts) {
				budgetTracker.markDegraded(provider, classified.category);
				return {
					ok: false,
					value: null,
					attempts: attempt,
					attemptLog,
					terminalError: classified,
					deferred: false,
				};
			}

			// Compute backoff delay and check against retry budget & overall run deadline (RT-02)
			const delayMs = computeBackoffDelayMs(attempt, {
				backoffBaseMs,
				backoffCapMs,
				randomFn,
				retryAfterMs: classified.retryAfterMs,
				minProviderDelayMs,
			});

			const afterAttemptMs = nowFn();
			const elapsedRetryMs = afterAttemptMs - startEpochMs;
			const remainingRetryBudgetMs = maxRetryElapsedMs - elapsedRetryMs;
			const remainingRunBudgetMs =
				runDeadlineEpochMs !== null
					? runDeadlineEpochMs - afterAttemptMs - reserveCleanupMs
					: Infinity;

			if (delayMs > remainingRetryBudgetMs || delayMs > remainingRunBudgetMs) {
				// RT-02: Never retry earlier than provider's minimum delay; if it exceeds remaining budget, defer the work
				budgetTracker.markDeferred(provider);
				const deferredError = {
					...classified,
					category:
						classified.retryAfterMs && classified.retryAfterMs > 0
							? "deferred_rate_limit"
							: "retry_budget_exhausted",
					code:
						classified.retryAfterMs && classified.retryAfterMs > 0
							? "RETRY_AFTER_EXCEEDS_BUDGET"
							: "RETRY_BUDGET_EXCEEDED",
					retryable: false,
					requiredDelayMs: delayMs,
					remainingBudgetMs: Math.min(remainingRetryBudgetMs, remainingRunBudgetMs),
					message: `Required retry delay (${delayMs}ms) exceeds remaining budget (${Math.max(0, Math.min(remainingRetryBudgetMs, remainingRunBudgetMs))}ms); deferring source '${provider}'.`,
				};
				return {
					ok: false,
					value: null,
					attempts: attempt,
					attemptLog,
					terminalError: deferredError,
					deferred: true,
				};
			}

			try {
				await sleepFn(delayMs, signal);
			} catch (sleepErr) {
				const sleepClassified = classifyError(sleepErr, { provider, nowMs: nowFn() });
				budgetTracker.markDegraded(provider, sleepClassified.category);
				return {
					ok: false,
					value: null,
					attempts: attempt,
					attemptLog,
					terminalError: sleepClassified,
					deferred: false,
				};
			}
		}
	}

	return {
		ok: false,
		value: null,
		attempts: effectiveMaxAttempts,
		attemptLog,
		terminalError: {
			category: "retry_exhausted",
			code: "MAX_ATTEMPTS_REACHED",
			statusCode: null,
			retryable: false,
			message: `Exhausted ${effectiveMaxAttempts} attempts for provider '${provider}'.`,
		},
		deferred: false,
	};
}

/**
 * Evaluate feed freshness using source issue time, NOT merely retrieval time (RT-04)
 * @param {object} params - { provider, sourceIssuedAt, retrievedAt, freshnessThresholdMs, isSyntheticFixture, isCachedFallback, nowMs }
 * @returns {object} Structured freshness assessment
 */
function evaluateSourceFreshness(params = {}) {
	const provider = String(params.provider || "unknown").toLowerCase();
	const nowMs = typeof params.nowMs === "number" ? params.nowMs : Date.now();
	const thresholdMs =
		Number(params.freshnessThresholdMs) ||
		DEFAULT_FRESHNESS_THRESHOLDS_MS[provider] ||
		24 * 60 * 60 * 1000;

	const warnings = [];
	const dataOrigin = params.isSyntheticFixture
		? "synthetic_fixture"
		: params.isCachedFallback
			? "cached_snapshot"
			: "live_feed";

	if (params.isSyntheticFixture) {
		warnings.push({
			code: "SYNTHETIC_FIXTURE_INPUT",
			provider,
			message: `Source '${provider}' used synthetic/offline fixture input; does not represent live real-time hazard coverage.`,
		});
	}
	if (params.isCachedFallback) {
		warnings.push({
			code: "CACHED_DATA_INPUT",
			provider,
			message: `Source '${provider}' used cached fallback data; not a live retrieval.`,
		});
	}

	if (!params.sourceIssuedAt) {
		warnings.push({
			code: "SOURCE_ISSUE_TIME_MISSING",
			provider,
			message: `Source '${provider}' response lacks authoritative sourceIssuedAt timestamp; freshness cannot be verified from retrieval time alone.`,
		});
		return {
			provider,
			fresh: false,
			stale: true,
			status: "stale_missing_issue_time",
			sourceIssuedAt: null,
			retrievedAt: params.retrievedAt || new Date(nowMs).toISOString(),
			ageMs: null,
			thresholdMs,
			dataOrigin,
			warnings,
		};
	}

	const issuedMs =
		typeof params.sourceIssuedAt === "number"
			? params.sourceIssuedAt
			: Date.parse(params.sourceIssuedAt);

	if (Number.isNaN(issuedMs)) {
		warnings.push({
			code: "INVALID_SOURCE_ISSUE_TIME",
			provider,
			message: `Source '${provider}' reported unparseable sourceIssuedAt '${params.sourceIssuedAt}'.`,
		});
		return {
			provider,
			fresh: false,
			stale: true,
			status: "stale_invalid_issue_time",
			sourceIssuedAt: String(params.sourceIssuedAt),
			retrievedAt: params.retrievedAt || new Date(nowMs).toISOString(),
			ageMs: null,
			thresholdMs,
			dataOrigin,
			warnings,
		};
	}

	const ageMs = Math.max(0, nowMs - issuedMs);
	const isStale = ageMs > thresholdMs;
	if (isStale) {
		warnings.push({
			code: "STALE_SOURCE_DATA",
			provider,
			message: `Source '${provider}' issue time (${new Date(issuedMs).toISOString()}) is stale: age ${Math.round(ageMs / 60000)}m exceeds threshold ${Math.round(thresholdMs / 60000)}m.`,
		});
	}

	return {
		provider,
		fresh: !isStale,
		stale: isStale,
		status: isStale ? "stale" : "fresh",
		sourceIssuedAt: new Date(issuedMs).toISOString(),
		retrievedAt: params.retrievedAt || new Date(nowMs).toISOString(),
		ageMs,
		thresholdMs,
		dataOrigin,
		warnings,
	};
}

module.exports = {
	RETRY_SCHEMA_VERSION,
	DEFAULT_FRESHNESS_THRESHOLDS_MS,
	parseRetryAfterMs,
	classifyError,
	computeBackoffDelayMs,
	ProviderBudgetTracker,
	executeWithRetry,
	evaluateSourceFreshness,
};
