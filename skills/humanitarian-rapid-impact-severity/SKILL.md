---
name: humanitarian-rapid-impact-severity
description: Conducts JIAF 2.0 / INFORM-aligned multi-factor humanitarian rapid impact and severity assessments (phases 1-5), explicitly separating hazard intensity, exposure, vulnerability, coping capacity deficit, and data confidence, and verifying agent trajectories via curated DRR benchmarks.
---

# Humanitarian Rapid Impact & Multi-Factor Severity Analysis

## Triggers
* Producing a rapid impact assessment or sub-national humanitarian severity ranking across ADM1/ADM2 COD-AB units following a disaster shock.
* Synthesizing spatial exposure, critical infrastructure cascades, vulnerability/loss models, and HDX baseline populations into a standardized 1–5 humanitarian severity phase with explicit missing-data disclosure.
* Running curated GeoDisaster-style benchmark evaluations to audit DRR agent tool selection, numerical accuracy, and non-goal compliance.

## Non-Goals
* **MUST NOT** reduce humanitarian severity to hazard magnitude alone (`hazardOnlyBlocked: true` when exposure, vulnerability, and coping capacity are all absent).
* **MUST NOT** coerce missing or unknown severity pillars to `0` (R-02); missing pillars must be preserved in `missingDimensions` and reflected in `dataConfidence`.
* **MUST NOT** present screening severity phases (`approvalStatus: "draft"`, `reportingEligibility: "screening_only"`) as an official IASC/OCHA JIAF or IPC declaration without inter-cluster human review.

## Authoritative References & Versions
* **JIAF 2.0 1–5 Severity Scale & EU JRC INFORM Multi-Pillar Structure** (`assessment.humanitarian.severity_v1`).
* **Curated DRR Agent Benchmark Suite** (`tests/benchmarks/geodisaster-scenarios.json`).

## Required Inputs
* At least two non-overlapping pillars among `hazardIntensity` (0–10), `exposure` (or `affectedPopulation`/`totalPopulation`/`spatialReport`), `vulnerability` (or `vulnerabilityReport`), and `copingCapacityDeficit` (or `copingCapacity`/`infraOverlay`); or an array of `units[]` for multi-unit COD-AB priority ranking.

## Allowed Executable Tools
* `drr_humanitarian_severity_assess`
* `drr_spatial_exposure_join`
* `drr_critical_infra_overlay`
* `drr_vulnerability_matrix_calc`
* `drr_hdx_hapi_fetch`
* `drr_cod_boundary_validate`
* `drr_benchmark_run`

## Escalation Conditions
* Escalate to Humanitarian Coordinator / Inter-Cluster Coordination Group (ICCG) when `severityPhase >= 4` (Extreme/Catastrophic), `hazardOnlyBlocked === true`, or `dataConfidence === "insufficient"`.

## Example End-User Prompts
* **Use Case — Rapid Impact & Multi-Unit Severity Ranking**:
  ```text
  Apply the humanitarian-rapid-impact-severity skill to rank flood severity across ADM2 units
  Hat Yai (TH9001) and Sadao (TH9002) using hazardIntensity, affectedPopulation/totalPopulation,
  vulnerability, and copingCapacityDeficit. Report severityPhase, dataConfidence, and missingDataList.
  ```
* **Use Case — Run DRR Agentic Benchmark Suite**:
  ```text
  Run drr_benchmark_run across all curated GeoDisaster scenarios and verify 100% pass rate on
  tool selection, numerical accuracy, non-goal compliance, and provenance coverage.
  ```
