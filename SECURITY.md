# Security Policy & Threat Model

This document defines the vulnerability disclosure policy, threat model, and built-in security controls of **DRR Agent Plugin** (`sindicatoesp/drr-agent-plugin`), aligned with **Digital Public Goods (DPG) Standard Indicators 9A (Data Privacy & Security)** and **9B (Inappropriate & Illegal Content Prevention)**.

---

## 1. Supported Versions

| Version | Supported | Security Patch Policy |
| :--- | :---: | :--- |
| `1.x` (latest minor release on `main`) | ✅ Yes | Active security fixes and regression tests |
| `< 1.0` | ❌ No | Upgrade to latest `1.x` release |

---

## 2. Reporting a Vulnerability

**Please do NOT report security vulnerabilities in public GitHub issues.**

Instead, report vulnerabilities privately through:
* **GitHub Private Vulnerability Reporting**: [https://github.com/sindicatoesp/drr-agent-plugin/security/advisories/new](https://github.com/sindicatoesp/drr-agent-plugin/security/advisories/new)

### Response Targets
* **Initial Acknowledgement**: Within 72 hours.
* **Triage & Severity Assessment**: Within 7 calendar days.
* **Remediation & Coordinated Disclosure**: Critical/high vulnerabilities prioritized for patch release with regression tests in `tests/test-security-cap.js`; public advisory published upon release.

---

## 3. Built-In Technical Security Controls

`drr-agent-plugin` is engineered with a **zero-dependency pure Node.js standard library** runtime (`scripts/lint.js` blocks third-party npm packages in production code), eliminating transitive supply-chain attack surfaces. Key runtime controls in `lib/security.js`, `lib/cap.js`, `lib/state-store.js`, and `lib/infra-overlay.js`:

| Control Area | Implementation | Code Reference |
| :--- | :--- | :--- |
| **XXE & XML Bomb Prevention** | Blocks `<!DOCTYPE>`, `<!ENTITY>`, and oversized XML payloads before CAP parsing/validation. | `validateXmlSafety` (`lib/security.js`), `validateCapXml` (`lib/cap.js`) |
| **SSRF & Outbound Destination Guard** | Validates webhook and external endpoints against non-HTTP(S) schemes, localhost/loopback, link-local metadata IPs (`169.254.169.254`), RFC-1918 private ranges, and unexpanded `${VAR}` placeholders. | `validateDestination` (`lib/security.js`), `dispatchWebhook` (`lib/monitor.js`) |
| **Prompt-Injection & Untrusted Feed Sanitization** | Sanitizes external GDACS/USGS/feed text fields and flags suspicious instruction-override patterns (`promptInjectionFlagged`). | `sanitizeUntrustedFeedText` (`lib/security.js`), `lib/gdacs.js` |
| **XSS Prevention in HTML SitReps** | Strict HTML entity and `<script>` breakout escaping across all hazard names, asset labels, and embedded JSON payloads. | `generateVisualSitRepHtml` (`lib/cap.js`), `tests/test-hindcast-regression.js` |
| **Fail-Closed CAP Broadcast Governance** | Generated OASIS CAP v1.2 XML defaults to `status: "Draft"`. Production publication requires `DRR_ENABLE_PRODUCTION_PUBLISH=true` plus cryptographic HMAC-SHA256 `approvalToken` verification (`issueApprovalToken` / `verifyApprovalToken`). | `lib/security.js`, `lib/cap.js` |
| **Shadow Mode Default** | Scheduled monitoring defaults to `--read-only true`, blocking external webhooks, public CAP writes, and DELTA submissions. | `lib/monitor.js`, `docs/configuration.md` |
| **Multi-Tenant & Country Isolation** | Enforces `tenantId` / `TARGET_COUNTRIES` / `DELTA_COUNTRY_STRICT` scoping so foreign events cannot pollute national disaster databases. | `enforceTenantIsolation` (`lib/security.js`), `lib/delta.js` |
| **Secret & PII Redaction** | Automatically redacts API keys, tokens, passwords, authorization headers, and incidental PII patterns (emails, phone numbers, national IDs) before persisting logs or state snapshots. | `redactSensitiveObject`, `detectAndRedactPii` (`lib/security.js`) |
| **Sensitive Critical Infrastructure Redaction** | Strips `sensitivity: "restricted"` and `redistributionAllowed: false` assets when generating `audience: "public"` outputs. | `lib/infra-overlay.js` |
| **Atomic State & Lease Fencing** | Compare-and-swap (CAS) atomic state commits with monotonically increasing fencing tokens prevent split-brain writes. | `lib/state-store.js` |

---

## 4. Misuse & Inappropriate Content Prevention (DPG Indicator 9B)

* **No Public User-Generated Content Hosting**: The core software is a local/self-hosted deterministic CLI, MCP server, and daemon; it does not host public forums, upload portals, or unmoderated user content.
* **Anti-Spoofing & Unauthorized Warning Prevention**: Generating a valid CAP XML file does **not** grant legal authority to broadcast public warnings. All generated CAP alerts default to `Draft`, and production dissemination is hard-gated behind explicit environment opt-in and signed approval tokens.
* **Acceptable Use**: Deploying this toolkit to fabricate emergency warnings, impersonate national warning authorities, or target vulnerable populations violates the project's [Code of Conduct](./CODE_OF_CONDUCT.md) and applicable laws.
