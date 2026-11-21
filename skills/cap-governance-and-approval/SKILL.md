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

## Example End-User Prompts
* **Use Case — Sandbox Broadcast Drill (National EOC)**:
  ```text
  Using the cap-governance-and-approval skill, test publishing the validated CAP XML at
  examples/earthquake-hazus-scenario/output-cap-alert.xml to channelType "sandbox" at
  "https://sandbox.cap.example.org/ingest" with permissionScope "publish_cap" and
  idempotencyKey "cap-drill-2026-001". Report the delivery and authorization audit status.
  ```
* **Use Case — Fail-Closed Production Guardrail Check (Security Officer)**:
  ```text
  Verify that attempting to publish a Draft CAP alert to channelType "production" with a
  self-asserted { approved: true } object (no signed HMAC approvalToken) is rejected.
  ```
* See [`docs/skills-guide.md`](../../docs/skills-guide.md#7-cap-governance-and-approval) for additional examples.

