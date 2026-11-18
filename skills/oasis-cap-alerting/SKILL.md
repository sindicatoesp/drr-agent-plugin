---
name: oasis-cap-alerting
description: Generates XXE-hardened OASIS CAP v1.2 / ITU-T X.1303 XML emergency messages (defaulting to Draft status), verifies schema/profile/reference/scope rules, and routes publication through authorized approval tokens.
---

# OASIS Common Alerting Protocol (CAP) v1.2 & Controlled Alerting

## Triggers
* User requests drafting or validating an OASIS CAP v1.2 XML message or synthesizing a situation brief (`generate_brief`).

## Non-Goals
* **MUST NOT** equate XML schema validity with warning authorization or public broadcast approval (C-07).
* **MUST NOT** default generated CAP messages to `status: "Actual"` (all drafts default to `status: "Draft"` and UTC `+00:00` timestamps).
* **MUST NOT** send `Draft`, `Test`, or `Exercise` alerts over `production` publication channels, or publish without a verified cryptographic `approvalToken` bound to exact `payloadHash` and `destination` (R-06 / R-07).

## Authoritative References & Versions
* **OASIS Common Alerting Protocol Version 1.2** (`urn:oasis:names:tc:emergency:cap:1.2`) & **ITU-T Recommendation X.1303**. [S5]
* **WMO CAP Validator Evaluation Note** (`World-Meteorological-Organization/capvalidator` for external XSD/XMLDSig verification when trust policy permits). [S6]

## Required Inputs
* `mode` (`generate_xml`, `validate_xml`, `generate_brief`) plus `alertParams` / `xmlString` / `context`.
* For `Update` / `Cancel` / `Ack`: valid CAP `<references>` (`sender,identifier,sent`). For `Private` scope: `<addresses>`.

## Allowed Executable Tools
* `drr_cap_alert_generate_validate`
* `drr_cap_publish` *(sandbox/production gated by `DRR_ENABLE_PRODUCTION_PUBLISH` & `approvalToken`)*

## Escalation Conditions
* Escalate to authorized Duty Officer for cryptographic signing (`approvalToken`) prior to `drr_cap_publish` on `Actual` / `Public` channels.
* Halt and escalate security alert if `validateCapXml` detects `<!DOCTYPE>` or `<!ENTITY>` (XXE attempt).

## Example Output & Failure Cases
* **C-07 Separated Governance Block**:
  `validation.governanceStates: { schemaValid: true, profileCompliant: true, authenticityVerified: false, issuerAuthorized: false, publicationApproved: false, deliveryStatus: "not_sent" }`.
* **Publication Block**: Submitting a `Draft` alert to `channelType: "production"` is rejected deterministically.
