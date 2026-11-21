---
name: event-identity-and-linkage
description: Multi-source disaster event deduplication, revision tracking, and reversible event-linkage classification avoiding automatic causal inference from spatial-temporal co-occurrence.
---

# Event Identity, Revisions & Linkage

## Triggers
* Ingesting events from multiple telemetry feeds (USGS, GDACS, Open-Meteo) into a unified monitoring cycle or catalog.
* Checking whether an incoming event is an exact duplicate, a source revision update, an ambiguous duplicate candidate, or a secondary hazard co-occurrence.

## Non-Goals
* **MUST NOT** automatically merge ambiguous `possible_duplicate` cross-source events without human review (R-10).
* **MUST NOT** infer `triggered_by` causal linkage solely from proximity in time and space (C-08, R-10).
* **MUST NOT** erase prior match state without recording reversible `mergeHistory`.

## Authoritative References & Versions
* **UNDRR DELTA Event Identity Rules & GLIDE Event Linking Guidance** (`lib/events.js`).

## Required Inputs
* `incomingEvents` array, `existingCatalog` array, optional `spatialRadiusKm` and `timeWindowHours`.

## Allowed Executable Tools
* `drr_event_match_deduplicate`
* `drr_monitor_check`

## Escalation Conditions
* Escalate to watchstander/catalog editor when any event returns `classification: "possible_duplicate"` or `"cascading_candidate"` requiring causal confirmation.

## Example Output & Failure Cases
* **Exact ID Match**: `classification: "exact_match_idempotent"`, prevents duplicate CAP/DELTA artifacts.
* **Cross-Hazard Co-occurrence**: `classification: "cascading_candidate"`, `causalInferenceAllowed: false`.

## Example End-User Prompts
* **Use Case — Multi-Feed Earthquake & Coastal Flood Deduplication (24/7 EOC)**:
  ```text
  Using the event-identity-and-linkage skill, run drr_event_match_deduplicate (spatialRadiusKm: 50,
  timeWindowHours: 48) to compare an incoming USGS magnitude revision, a nearby GDACS EQ alert 18 km away,
  and a GDACS flood alert 3 hours later against our catalog. Distinguish revision_update from
  possible_duplicate (held for human review) and cascading_candidate (causalInferenceAllowed: false).
  ```
* **Use Case — Shadow Monitoring Deduplication Verification**:
  ```text
  Run drr_monitor_check with mock: true and readOnly: true against alerts-config.example.json and show
  how duplicate events are suppressed while preserving reversible mergeHistory.
  ```
* See [`docs/skills-guide.md`](../../docs/skills-guide.md#11-event-identity-and-linkage) for additional examples.

