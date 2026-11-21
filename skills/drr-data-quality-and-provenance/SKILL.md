---
name: drr-data-quality-and-provenance
description: Validates input contracts, explicit intensity units, lat/lon ordering, temporal bounds, secret-sanitized SHA-256 provenance manifests, model registry applicability, and frozen-input replay verification.
---

# DRR Data Quality, Registry & Provenance

## Triggers
* Pre-flight validation of hazard intensity, units, coordinates, temporal windows, or exposure missing-data completeness before running models.
* Generating tamper-evident SHA-256 provenance manifests or verifying frozen-input scientific replay tests.

## Non-Goals
* **MUST NOT** convert missing/null asset values or intensities to `0` or silent defaults (R-02).
* **MUST NOT** allow secrets/credentials/tokens inside hashed input snapshots (secrets must be redacted before hashing, R-03).
* **MUST NOT** represent test replay passes on synthetic curves as real-world empirical validation (R-05).

## Authoritative References & Versions
* **Result & Provenance Contract v1.0** (`lib/contracts.js`, `lib/registry.js`, `lib/replay.js`).

## Required Inputs
* Assessment input payload (`input`), optional `strictMissingData` flag, method ID/parameters, or replay suite selector (`all`, `synthetic_reference`, `hindcast_benchmark`).

## Allowed Executable Tools
* `drr_input_contract_validate`
* `drr_source_provenance_manifest`
* `drr_model_registry_list`
* `drr_assessment_replay_validate`
* `drr_uncertainty_propagate`

## Escalation Conditions
* Escalate to data steward when critical assets report `unknown` / `null` population or replacement values (`strictMissingData: true` triggers blocker) or when `mode: "production"` encounters uncalibrated illustrative methods.

## Example Output & Failure Cases
* **Contract Failure**: Out-of-order `[lat, lon]` coordinates (`lat > 90` in slot 1) or incompatible units return structured `errors` rather than silent coercion.

## Example End-User Prompts
* **Use Case — Pre-Flight Audit & Secret-Sanitized Provenance Manifest**:
  ```text
  Using the drr-data-quality-and-provenance skill, validate an earthquake input with coordinates
  [125.15, 6.85], intensity 0.38 g, currency "USD", valuationYear 2026, and strictMissingData: true.
  Then generate a SHA-256 provenance manifest for method REG_WALD99_GMICE with evidenceBasis "modelled"
  and approvalStatus "draft", ensuring any API keys in inputsSnapshot are redacted before hashing.
  ```
* **Use Case — Model Registry & Scientific Replay Verification**:
  ```text
  List all registered methods in MODEL_REGISTRY, check applicability of REG_WALD99_GMICE at MMI 9.2,
  and run drr_assessment_replay_validate (suite: "all") to verify frozen-input invariants.
  ```
* See [`docs/skills-guide.md`](../../docs/skills-guide.md#12-drr-data-quality-and-provenance) for additional examples.

