---
name: undrr-hip-hazard-classification
description: Versioned crosswalk of hazard codes, external telemetry taxonomies, and free-text labels to UNDRR-ISC Hazard Information Profiles (HIP 2020 + 2025 revision flags), distinguishing exact matches from candidate suggestions.
---

# UNDRR-ISC Hazard Information Profiles (HIP) Classification

## Triggers
* Mapping incoming USGS, GDACS, GLIDE, or national hazard codes onto the UNDRR-ISC HIP triad (`typeId`, `clusterId`, `hazardId`).
* Migrating legacy 2020 HIP hazard codes toward the 2025 HIP revision (281 hazards across 8 types).

## Non-Goals
* **MUST NOT** turn free-text substring or fuzzy matches into authoritative deterministic classifications (free text returns ranked `candidates_require_review`, C-08).
* **MUST NOT** silently resolve unknown or ambiguous hazard codes (return `unresolved`).
* **MUST NOT** discard original source codes or taxonomy version identifiers.

## Authoritative References & Versions
* **UNDRR / ISC Hazard Information Profiles (HIPs): 2025 Revision** (281 hazards, 8 types) & bundled `lib/hips-data.json` (`UNDRR-ISC-HIP-2020-DELTA-v1`). [S2]

## Required Inputs
* Hazard query string or object (`query`), optional `sourceSystem` (`GDACS`, `USGS`, `DELTA`, `GLIDE`), optional `candidateLimit`.

## Allowed Executable Tools
* `drr_hazard_crosswalk`
* `drr_delta_fetch_exposure` *(for `hip-hazard`, `hip-cluster`, `hip-type` queries)*

## Escalation Conditions
* Escalate to national taxonomy focal point whenever `resolutionType === "candidates_require_review"` or `"unresolved"`, or when `hip2025Revision.requires2025Crosswalk === true` affects official historical series.

## Example Output & Failure Cases
* **Exact Match**: `{ resolutionType: "exact", taxonomyVersion: "UNDRR-ISC-HIP-2020-DELTA-v1", originalQuery: "EQ", resolved: { hipId: "GH0101", ... } }`.
* **Free Text**: `{ resolutionType: "candidates_require_review", requiresHumanReview: true, candidates: [...] }`.
* **Unknown Code**: `{ resolutionType: "unresolved", resolved: null }`.
