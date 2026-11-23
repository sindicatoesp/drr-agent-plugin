# Critical Infrastructure Overlay — Systems Integration & Authoring Guide

This guide defines the **systems integration standards**, **Sendai Framework Target D 9-sector grouping**, **GeoJSON feature schema**, **lifeline dependency modeling**, and **Critical Infrastructure Protection (CIP) security controls** for overlaying critical infrastructure onto hazard footprints in `drr-agent-plugin`.

---

## 1. Systems Integration Standards & Best Practices

To ensure interoperability across national GIS platforms (ArcGIS, GeoServer, QGIS, PostGIS, DELTA Resilience) and humanitarian datasets (OpenStreetMap / HOTOSM), the plugin adopts four complementary international standards:

1. **Transport & Query API — OGC API – Features (Part 1 Core, OGC 17-069r4)**:
   * Modern REST + GeoJSON (RFC 7946, WGS 84 `[lon, lat]`) successor to WFS, endorsed by **EU INSPIRE**, **Esri ArcGIS**, **GeoServer**, **pygeoapi**, and **ldproxy**.
   * Standard URL pattern: `GET {OGC_FEATURES_API_URL}/collections/{collectionId}/items?bbox={minLon,minLat,maxLon,maxLat}&limit=200&f=json`.
   * Pure HTTP + JSON — preserves `drr-agent-plugin`'s **zero external dependency** Node.js standard library core.
2. **Semantic Grouping — UNDRR Sendai Framework Target D (9 Canonical Sectors)**:
   * Groups every infrastructure asset into the 9 official Sendai Target D sectors so physical damage (`D-2`, `D-3`, `D-4`) and service disruption (`D-6`, `D-7`, `D-8`) roll up deterministically into Sendai Framework Monitor (SFM) and DELTA Resilience reports.
3. **Lifeline Interdependencies — FEMA Community Lifelines + Sendai `C-02` Separation**:
   * Supports optional `dependsOn: ["<upstream-asset-id>"]` links so structurally intact facilities (e.g., an upland hospital outside a flood polygon) are flagged for **cascading service disruption risk (`D-6`..`D-8`)** when their upstream power substation or water plant is physically exposed—**without** conflating service disruption with physical structural damage (`D-2`..`D-4`).
4. **Critical Infrastructure Protection (CIP) — Audience-Based Redaction**:
   * Exact coordinates of high-voltage substations, dams, water treatment plants, and core telecom exchanges can be national-security sensitive.
   * Every feature carries `sensitivity` (`public` | `eoc_internal` | `restricted`) and `redistributionAllowed`. When `audience: "public"` is requested (e.g., for public CAP advisories), `restricted` and `redistributionAllowed: false` assets are automatically stripped from the GeoJSON output while `redactedForPublicCount` is audited.

---

## 2. Canonical 9 Sendai Framework Target D Sectors

| Canonical `sendaiSector` | Display Label | Physical Damage (`C-02`) | Service Disruption (`C-02`) | Default Sensitivity | Typical `assetType` Values |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `health` | Health | `D-2` | `D-7` | `public` | `hospital`, `health_centre`, `clinic`, `pharmacy` |
| `education` | Education | `D-3` | `D-6` | `public` | `school`, `university`, `college` |
| `water` | Water | `D-4` | `D-8` | `eoc_internal` | `water_supply`, `water_treatment_plant`, `pumping_station`, `reservoir` |
| `transportation` | Transportation | `D-4` | `D-8` | `public` | `road`, `bridge`, `airport`, `seaport`, `railway` |
| `telecommunications` | Telecommunications | `D-4` | `D-8` | `eoc_internal` | `mobile_tower`, `telecom_exchange`, `broadcast_station`, `data_center` |
| `energy` | Energy | `D-4` | `D-8` | `eoc_internal` | `power_plant`, `substation`, `transmission_line`, `fuel_depot` |
| `waste_management` | Waste management | `D-4` | `D-8` | `eoc_internal` | `wastewater_plant`, `sanitation`, `sewage`, `landfill` |
| `protective_infrastructure` | Protective infrastructure | `D-4` | `D-8` | `eoc_internal` | `levee`, `floodwall`, `dam`, `drainage_pump`, `seawall`, `green_infrastructure` |
| `other_essential` | Other essential infrastructure | `D-4` | `D-8` | `public` | `emergency_shelter`, `eoc`, `fire_station`, `government_designated` |

> **Auto-Classification Fallback:** If you import raw GeoJSON (such as an OpenStreetMap or municipal export) without an explicit `sendaiSector` property, `classifySendaiInfraSector` deterministically maps known `assetType`, `category`, `amenity`, `power`, or `man_made` tags into the 9 sectors. Any unrecognized label is placed in `other_essential` with `classificationWarning: true` so nothing is silently misclassified.

---

## 3. How to Define a Critical Infrastructure Overlay (GeoJSON Schema)

You can organize your infrastructure layers either as:
* **Option A — Single Combined GeoJSON (`infraGeoJSON`)**: One `FeatureCollection` containing features across all 9 sectors (grouped automatically by `sendaiSector`).
* **Option B — Multi-File Per-Sector Layers (`infraLayers`)**: Separate GeoJSON files per agency (e.g., `ministry-of-health.geojson`, `grid-operator.geojson`, `public-works-levees.geojson`) merged and grouped at runtime.
* **Option C — Live OGC API – Features Endpoint (`endpointUrl` + `collection`)**: Queried dynamically with `bbox` and `limit` filters (SSRF-guarded).

### Recommended Feature Schema
```json
{
  "type": "Feature",
  "id": "HOSP-YALA-UP",
  "geometry": {
    "type": "Point",
    "coordinates": [100.1500, 7.2500]
  },
  "properties": {
    "name": "Yala Upland Regional Hospital",
    "sendaiSector": "health",
    "assetType": "hospital",
    "nationalCategory": "Ministry of Public Health Tertiary Referral Hospital",
    "taxonomy": "C2",
    "valueUsd": 22000000,
    "capacity": 500,
    "dependsOn": ["SUB-YALA-01", "WTP-YALA-01"],
    "sensitivity": "public",
    "redistributionAllowed": true
  }
}
```

### Property Rules
* **`id`** *(Recommended)*: Stable unique asset identifier (referenced by `dependsOn` in downstream facilities).
* **`geometry`** *(Required)*: RFC 7946 WGS 84 (`EPSG:4326`) `Point`, `Polygon`, `MultiPolygon`, or `LineString` in `[lon, lat]` order.
* **`sendaiSector`** *(Recommended)*: One of the 9 canonical keys above.
* **`valueUsd` / `capacity`** *(Optional)*: Must be numeric or `null` when unknown—**never** substitute `0` for missing data (`R-02`).
* **`dependsOn`** *(Optional)*: Array of upstream facility IDs whose physical exposure triggers `cascadingServiceDisruptionRisk: true` on this asset.
* **`sensitivity` / `redistributionAllowed`** *(Optional)*: Controls public redaction when `audience: "public"`.

---

## 4. CLI & AI Agent Usage Examples

### Direct CLI
```bash
# Group & overlay all 9 Sendai sectors against the Southern Thailand flood polygon (EOC internal view)
node bin/cli.js infra-overlay \
  --file examples/critical-infra-overlay/sample-sendai-infra.json \
  --hazard examples/thailand-flood-scenario/input-hazard.json

# Filter to Health + Energy + Water only and redact restricted nodes for public briefing
node bin/cli.js infra-overlay \
  --file examples/critical-infra-overlay/sample-sendai-infra.json \
  --hazard examples/thailand-flood-scenario/input-hazard.json \
  --sectors health,energy,water \
  --audience public
```

### AI Agent Prompt (MCP Tool `drr_critical_infra_overlay`)
```text
Using the critical-infrastructure-overlay skill, overlay
examples/critical-infra-overlay/sample-sendai-infra.json onto
examples/thailand-flood-scenario/input-hazard.json (audience: "eoc_internal").
Group results by the 9 Sendai Target D sectors, report physical exposure (D-2..D-4)
separately from cascading lifeline disruption risk (D-6..D-8), and then re-run with
audience: "public" to confirm restricted energy/telecom assets are redacted.
```

---

## Interim Open-Source Fallback (When No Authoritative National Source Exists)

When a country or municipality does not yet expose an authoritative national GIS / OGC API – Features or UNDRR DELTA layer, use **`drr_osm_critical_infra_fetch`** (CLI: `drr-tool osm-infra`, registered method `exposure.osm.interim_critical_infra_v1`) to retrieve an interim **OpenStreetMap (Overpass API)** baseline mapped directly to the 9 Sendai Target D sectors:

```bash
# Offline sample fixture
node bin/cli.js osm-infra \
  --file examples/critical-infra-overlay/sample-osm-overpass.json

# Live Overpass API query (WGS84 bbox max 5° x 5°, SSRF-guarded) with immediate hazard overlay
node bin/cli.js osm-infra \
  --bbox 100.40,6.95,100.55,7.08 \
  --sectors health,energy,water,protective_infrastructure \
  --hazard examples/thailand-flood-scenario/input-hazard.json
```

**Complementary global open interim registries** (GeoJSON can be passed directly into `drr_critical_infra_overlay`):
* **All sectors (pre-clipped by country):** HOTOSM / HDX Country Exports (`data.humdata.org`, ODbL-1.0)
* **`health`:** Healthsites.io & WHO/HDX Health Facilities
* **`education`:** UNICEF Giga & HOTOSM/HDX Education Facilities
* **`energy`:** WRI Global Power Plant Database (CC-BY-4.0) & Open Infrastructure Map
* **`transportation`:** OurAirports (Public Domain) & World Port Index / HDX Ports
* **`water` & `protective_infrastructure`:** GRanD & GOODD Global Dam Databases

> **Governance Guardrail:** Interim OSM outputs are automatically tagged `interimFallback: true`, `verificationStatus: "external_unverified"`, `reportingEligibility: "screening_only"`, and `license: "ODbL-1.0"` (`© OpenStreetMap contributors`). Crowdsourced completeness varies by region (unmapped ≠ zero) and does not include operational lifeline `dependsOn` topology; replace with authoritative national layers as soon as available.

---

## Pre-Building Static Global & Regional Infrastructure Packs

Instead of querying Overpass live per event, you can pre-build a single local GeoJSON file once using [`scripts/build-static-infra.js`](../scripts/build-static-infra.js) and point `defaultExposureFile` in `alerts-config.json` to it:

```bash
# 1. Global Major Infrastructure (WRI Power Plants + OurAirports + optional --extra-geojson)
make infra-build-global
# or: node scripts/build-static-infra.js --mode global --extra-geojson ./my-healthsites.geojson

# 2. Regional / Multi-Country Static Extract (auto-tiled <= 4° Overpass queries)
make infra-build-regional PRESET=southeast-asia
# or custom bbox: node scripts/build-static-infra.js --mode regional --bbox 97.3,5.6,105.7,20.5
```

Then configure `alerts-config.json`:
```json
{
  "defaultExposureFile": "./data/static-critical-infra-global.geojson"
}
```

See **[CREDITS.md](../CREDITS.md)** for full license and attribution requirements (`ODbL-1.0`, `CC-BY-4.0`, `Public Domain`).
