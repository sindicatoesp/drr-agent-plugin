---
name: sendai-indicator-accounting
description: Enforces UNDRR Sendai Framework Monitor (SFM) indicator definitions across Target B (B-1 vs displacement & deduplication), Target D (D-2..D-4 physical damage vs D-6..D-8 disruption), per-100,000 denominators, and C-03 official reporting eligibility.
---

# Sendai Indicator Accounting & Semantic Validation

## Triggers
* Auditing or preparing Sendai Framework Targets B, C, or D submissions from disaster loss assessments or national reporting payloads.

## Non-Goals
* **MUST NOT** automatically map modelled displacement to Indicator `B-1` (directly affected people) without direct empirical eligibility (C-01).
* **MUST NOT** sum potentially overlapping Target B sub-populations (`B-2`..`B-5`) without an explicit `populationDeduplicationMethod` (C-01).
* **MUST NOT** conflate physical infrastructure damage (`D-2`..`D-4`) with service disruption (`D-6`..`D-8`) (C-02).
* **MUST NOT** treat raw counts as normalized per-100,000 indicators without an explicit `populationDenominator` (R-08).
* **MUST NOT** mark unreviewed modelled estimates as `reportingEligibility: "eligible"` (C-03).

## Authoritative References & Versions
* **UNDRR Sendai Framework Monitor (SFM) Technical Guidance** [S1] (`lib/sendai.js`, `lib/vulnerability.js`).

## Required Inputs
* Sendai submission or assessment `payload`, optional `requireCalibratedMethodology` boolean.

## Allowed Executable Tools
* `drr_sendai_validate`
* `drr_vulnerability_matrix_calc`
* `drr_delta_schema_validate`

## Escalation Conditions
* Escalate to national Sendai Framework Focal Point when `reportingEligibility === "pending"` or `"ineligible"`, or when `evidenceBasis === "modelled"` lacks national validation review.

## Example Output & Failure Cases
* **Official Reporting Gate**: Unreviewed modelled payload yields `reportingEligibility: "pending"` or `"ineligible"` with structured reason codes (never silently promoted to official national statistics).
