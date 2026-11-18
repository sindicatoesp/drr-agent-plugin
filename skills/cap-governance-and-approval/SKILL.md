---
name: cap-governance-and-approval
description: Enforces C-07 CAP state separation, signed cryptographic approval tokens bound to exact payload hash and destination, production channel isolation, destination allowlists, idempotency, and audit logging.
---

# CAP Alert Governance & Controlled Publication

## Triggers
* Evaluating whether a CAP alert is eligible for publication to a `sandbox` or `production` endpoint.
* Enforcing least-privilege permission scopes (`publish_cap`), signed `approvalToken` checks, and duplicate-dispatch idempotency.

## Non-Goals
* **MUST NOT** accept a model-generated `{ approved: true }` object in lieu of a cryptographically verified `approvalToken` (R-06, Section 9).
* **MUST NOT** publish `Draft`, `Test`, or `Exercise` CAP messages to a `production` channel (R-07).
* **MUST NOT** enable production publication without explicit deployment configuration (`DRR_ENABLE_PRODUCTION_PUBLISH === 'true'`).

## Authoritative References & Versions
* **OASIS CAP v1.2 / ITU-T X.1303** [S5], **WMO CAP Validator Trust Note** [S6], `lib/security.js`, `lib/cap.js`.

## Required Inputs
* Validated `xmlString`, `channelType` (`sandbox` | `production`), `destination` URI, `permissionScope`, signed `approvalToken`, and `idempotencyKey`.

## Allowed Executable Tools
* `drr_cap_alert_generate_validate`
* `drr_cap_publish`

## Escalation Conditions
* Any unauthorized actor, untrusted destination host, channel/status mismatch, replay `idempotencyKey`, or invalid XML fails closed and requires Duty Officer + Security Officer intervention.

## Example Output & Failure Cases
* **Self-Asserted Approval Blocked**: Passing `{ approved: true }` without a valid HMAC signature is rejected with an explicit authorization policy failure.
