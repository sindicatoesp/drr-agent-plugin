---
name: delta-disaster-recording
description: Schema-validated, tenant-isolated, draft-only interoperability with UNDRR DELTA Resilience retaining C-03 governance metadata, HIP triad completeness, and idempotency keys.
---

# UNDRR DELTA Resilience Interoperability

## Triggers
* User requests fetching DELTA exposure/divisions/HIP catalogs, inspecting DTS schema rules, validating a relational bundle, or pushing a draft disaster record.

## Non-Goals
* **MUST NOT** push non-draft records directly into production or mutate `evidenceBasis: "modelled"` into `"observed"` (C-03).
* **MUST NOT** invent unverified DELTA schema endpoints or bypass `validateDeltaSchema` / tenant isolation (`tenantContext`).
* **MUST NOT** execute live production writes unless `DRR_ENABLE_PRODUCTION_PUBLISH=true` and `mock !== true`.

## Authoritative References & Versions
* **UNDRR DELTA Resilience / DTS Data Model** (`drr_delta_docs` & `validateDeltaSchema`, PostGIS SRID 4326 spatial footprints, HIP triad `typeId`/`clusterId`/`hazardId`).

## Required Inputs
* Validated vulnerability/loss assessment JSON (`assessment`), `mock` flag (`true` for dry-run sandbox validation), `tenantContext`, and optional sanitized `name` / `notes`.

## Allowed Executable Tools
* `drr_delta_docs`
* `drr_delta_fetch_exposure`
* `drr_delta_schema_validate`
* `drr_delta_push_draft_record`

## Escalation Conditions
* Escalate to national DELTA focal point if `drr_delta_schema_validate` fails DTS contract or HIP triad checks.
* Escalate on cross-tenant mismatch (`actorTenant !== targetTenant`) or missing live write authorization.

## Example Output & Failure Cases
* **Expected Draft Output**:
  `{ success: true, record: { status: "draft", source: "drr-agent-plugin", apiImportId: ... }, governanceMetadata: { evidenceBasis, verificationStatus, approvalStatus, reportingEligibility } }`.
* **Production Gate**: Calling live push while `DRR_ENABLE_PRODUCTION_PUBLISH !== "true"` is blocked cleanly unless `mock: true`.
