---
name: critical-infrastructure-overlay
description: Groups critical infrastructure assets by the 9 UNDRR Sendai Framework Target D sectors, ingests layers via OGC API - Features (OGC 17-069r4) or GeoJSON, overlays them onto hazard footprints, evaluates lifeline dependency cascades (D-6..D-8 separate from D-2..D-4), and enforces CIP sensitivity redaction.
---

# Sendai Target D Critical Infrastructure Overlay & Lifeline Cascades

## Triggers
* User requests overlaying critical infrastructure (hospitals, schools, water plants, bridges, telecom towers, substations, wastewater plants, levees/dams, emergency shelters) onto a hazard footprint (ShakeMap PGA contour, STAC flood extent, GDACS polygon, or geodesic buffer).
* EOC analyst needs assets grouped by the **9 official Sendai Framework Target D sectors** or needs to identify intact facilities facing cascading service disruption from exposed upstream utilities (`dependsOn`).

## Non-Goals
* **MUST NOT** conflate physical facility exposure/damage (`D-2`, `D-3`, `D-4`) with cascading lifeline service disruption risk (`D-6`, `D-7`, `D-8`) (C-02).
* **MUST NOT** coerce missing `valueUsd` or `capacity` fields to `0` (`R-02`).
* **MUST NOT** include `sensitivity: "restricted"` or `redistributionAllowed: false` infrastructure coordinates in public outputs (`audience: "public"` must redact them).
* **MUST NOT** bypass SSRF host blocking on custom OGC API – Features `endpointUrl` hosts.

## Authoritative References & Versions
* **UNDRR Sendai Framework Monitor Technical Guidance** (Target D: 9 critical infrastructure sectors, `D-2..D-4` & `D-6..D-8`).
* **OGC API – Features Part 1 Core** (`OGC 17-069r4`, registered method `overlay.sendai.critical_infra_v1`).
* **Overlay Authoring & Integration Guide**: [`docs/critical-infrastructure-overlay-guide.md`](../../docs/critical-infrastructure-overlay-guide.md).

## Required Inputs
* Offline `infraGeoJSON` (single FeatureCollection) OR `infraLayers` (array of per-sector FeatureCollections) OR live OGC API – Features `endpointUrl` + `collection`.
* Optional: `hazardGeoJSON` (or `epicenter` + `bufferKm`), `sectors` filter array, and `audience` (`"eoc_internal"` | `"public"`).

## Canonical Sendai Sector Keys & GeoJSON Contract

| Canonical `sendaiSector` Key | Sendai Indicator | Typical Asset Subtypes (`assetType`) |
| :--- | :---: | :--- |
| `health` | `D-2` / `D-7` | `hospital`, `health_centre`, `clinic`, `pharmacy` |
| `education` | `D-3` / `D-6` | `school`, `university`, `college` |
| `water` | `D-4` / `D-8` | `water_treatment_plant`, `water_supply`, `pumping_station`, `reservoir` |
| `transportation` | `D-4` / `D-8` | `road`, `bridge`, `airport`, `seaport`, `railway` |
| `telecommunications` | `D-4` / `D-8` | `mobile_tower`, `telecom_exchange`, `broadcast_station` |
| `energy` | `D-4` / `D-8` | `power_plant`, `substation`, `transmission_line`, `distribution_hub` |
| `waste_management` | `D-4` / `D-8` | `wastewater_plant`, `sanitation_facility`, `landfill` |
| `protective_infrastructure` | `D-4` / `D-8` | `levee`, `floodwall`, `dam`, `drainage_pump`, `seawall` |
| `other_essential` | `D-4` / `D-8` | `emergency_shelter`, `eoc`, `fire_station`, `government_designated` |

## Allowed Executable Tools
* `drr_critical_infra_overlay`
* `drr_spatial_exposure_join`
* `drr_delta_fetch_exposure`
* `drr_sendai_validate`

## Escalation Conditions
* Escalate to EOC Operations Chief when `cascadingServiceRiskCount > 0` (e.g., upland hospitals/schools losing power or water from exposed substations/plants).
* Escalate to security/CIP officer before sharing `eoc_internal` or `restricted` utility coordinates outside the EOC.
* Escalate to GIS steward when `unclassifiedCount > 0` (`classificationWarning: true` on unrecognized asset types).

## Example Output & Failure Cases
* **C-02 Separation**: An upland hospital outside the flood polygon with `dependsOn: ["SUB-YALA-01"]` reports `physicallyExposed: false` (`D-2` not incremented) and `cascadingServiceDisruptionRisk: true` (`D-7` service risk incremented).
* **Public Redaction**: Setting `audience: "public"` strips `SUB-YALA-01` (`sensitivity: "restricted"`) and reports `redactedForPublicCount > 0`.

## Example End-User Prompts
* **Use Case — Southern Thailand 9-Sector Flood Overlay & Lifeline Cascade Check (National EOC)**:
  ```text
  Using the critical-infrastructure-overlay skill, overlay
  examples/critical-infra-overlay/sample-sendai-infra.json onto
  examples/thailand-flood-scenario/input-hazard.json (audience: "eoc_internal").
  Group results by the 9 Sendai Target D sectors, separate physical exposure (D-2..D-4)
  from cascading lifeline disruption risk (D-6..D-8) on the upland hospital and school,
  and then re-run with audience: "public" to verify restricted energy/telecom assets are redacted.
  ```
* **Use Case — Live OGC API – Features National GIS Integration**:
  ```text
  Query our national OGC API - Features server (endpointUrl: "https://gis.agency.gov/ogcapi",
  collection: "critical-infrastructure", bbox: [101.1, 6.4, 101.4, 6.7]) filtered to
  sectors ["health", "energy", "water", "protective_infrastructure"] and overlay against
  our latest STAC flood footprint.
  ```
* See [`docs/skills-guide.md`](../../docs/skills-guide.md#17-critical-infrastructure-overlay) and [`docs/critical-infrastructure-overlay-guide.md`](../../docs/critical-infrastructure-overlay-guide.md) for additional examples.
