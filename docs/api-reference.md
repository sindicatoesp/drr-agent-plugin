# MCP Tools & CLI Technical Reference

Complete technical specification of all 10 MCP tools provided by `bin/mcp-server.js` and the standalone Command-Line Interface (`bin/cli.js`).

---

# Part 1: Model Context Protocol (MCP) Tools (10 Tools)
Ingests and filters active GDACS alerts by severity, hazard type, or country.

### Input Schema
```json
{
  "minAlertLevel": "Green" | "Orange" | "Red",
  "eventType": "EQ" | "TC" | "FL" | "VO" | "DR" | "WF",
  "country": "string",
  "samplePayload": {}
}
```

---

## 2. `drr_usgs_earthquake_fetch`
Queries real-time seismic events from the USGS Earthquake Hazards Program and estimates Peak Ground Acceleration (PGA in $g$) from Instrumental Intensity (MMI) via Wald et al. (1999) ground motion equations.

### Input Schema
```json
{
  "minMagnitude": 5.0,     // Minimum earthquake magnitude (e.g. 4.5, 6.0)
  "limit": 20,             // Maximum number of events
  "samplePayload": {}      // Optional offline GeoJSON fixture
}
```

### Output Example
```json
{
  "totalEvents": 1,
  "earthquakes": [
    {
      "id": "usgs_us7000m8v7",
      "usgsId": "us7000m8v7",
      "title": "M 6.8 - 15 km SW of Port-Vila, Vanuatu",
      "place": "15 km SW of Port-Vila, Vanuatu",
      "magnitude": 6.8,
      "coordinates": [168.21, -17.85],
      "depthKm": 35.0,
      "mmi": 7.2,
      "estimatedPgaG": 0.2642,
      "alertLevel": "orange",
      "tsunamiAlert": false,
      "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000m8v7"
    }
  ]
}
```

---

## 3. `drr_openmeteo_forecast`
Queries Open-Meteo multi-model weather forecasts and evaluates Anticipatory Action triggers for flash floods and extreme wind.

### Input Schema
```json
{
  "latitude": 23.8,        // Target latitude
  "longitude": 90.4,       // Target longitude
  "days": 5,               // Forecast window in days
  "samplePayload": {}      // Optional offline payload
}
```

### Output Example
```json
{
  "totalForecastPrecipitationMm": 268.7,
  "peakDailyPrecipitationMm": 115.0,
  "peakPrecipitationDate": "2026-08-11",
  "peakWindSpeedKmh": 68.0,
  "anticipatoryAction": {
    "riskLevel": "Extreme Flash Flood & River Inundation Trigger",
    "alertColor": "Red",
    "triggerThresholdMet": true,
    "estimatedInundationDepthMeters": 1.84,
    "recommendedEarlyAction": "Pre-position water purification units and trigger evacuation advisories for low-lying settlements."
  }
}
```

---

## 4. `drr_spatial_exposure_join`
Performs deterministic point-in-polygon and buffer spatial joins between hazard footprints and exposure assets.

### Input Schema
```json
{
  "hazardGeoJSON": {},       // Feature or FeatureCollection (Polygon/MultiPolygon)
  "exposureGeoJSON": {},     // FeatureCollection (Points or Polygons)
  "epicenter": [125.15, 6.85], // Optional [lon, lat]
  "bufferKm": 25.0           // Optional buffer in km
}
```

---

## 5. `drr_fragility_eval`
Evaluates GEM and HAZUS lognormal damage state probabilities.

### Input Schema
```json
{
  "hazardType": "earthquake" | "flood" | "wind",
  "intensity": 0.35,        // PGA in g, flood depth in m, or wind in km/h
  "taxonomy": "URM" | "C1_PRE_CODE" | "C1_MODERATE_CODE" | "C2" | "S1" | "W1",
  "occupancy": "residential_1story" | "residential_2story" | "commercial"
}
```

---

## 6. `drr_vulnerability_matrix_calc`
Computes composite losses, displacement, and Sendai Framework metrics (Targets B, C, D).

### Input Schema
```json
{
  "spatialReport": {},       // Output from drr_spatial_exposure_join
  "hazardType": "earthquake" | "flood" | "wind",
  "intensity": 0.35,
  "defaultTaxonomy": "URM"
}
```

---

## 7. `drr_cap_alert_generate_validate`
Generates and validates ITU-T X.1303 / OASIS CAP v1.2 XML alerts or synthesizes situation briefs.

### Input Schema
```json
{
  "mode": "generate_xml" | "validate_xml" | "generate_brief",
  "alertParams": { ... },
  "xmlString": "<?xml ...>",
  "context": { ... }
}
```

---

## 8. `drr_delta_push_draft_record`
Pushes a validated post-disaster assessment into DELTA Resilience as a Draft record with `status: "draft"`, `source: "drr-agent-plugin"`, and full Sendai Targets B, C, D accounting.

### Input Schema
```json
{
  "assessment": {},         // Output from drr_vulnerability_matrix_calc
  "name": "string",         // Optional event title
  "notes": "string",        // Context / audit trail notes
  "mock": false             // Set true for local dry-run validation
}
```

### Output Example
```json
{
  "success": true,
  "record": {
    "name": "Mw 7.2 Mainshock Emergency Assessment",
    "status": "draft",
    "source": "drr-agent-plugin",
    "sendaiMetrics": {
      "totalExposedPopulation": 11495,
      "estimatedDisplaced": 9585,
      "estimatedDirectLossUsd": 49428050,
      "damagedCriticalFacilities": 3
    }
  }
}
```

---

## 9. `drr_delta_fetch_exposure`
Queries baseline administrative divisions, sector assets, or historical disaster records from DELTA via MCP.

### Input Schema
```json
{
  "entity": "division" | "disaster-record" | "organization",
  "filter": {
    "page": 1,
    "pageSize": 50
  },
  "mock": false
}
```

---

## 10. `drr_monitor_check`
Executes an automated monitoring cycle against multi-source telemetry feeds using thresholds defined in `alerts-config.json`, triggering spatial joins, DELTA draft records, and CAP warnings.

### Input Schema
```json
{
  "configPath": "alerts-config.json", // Optional custom path
  "mock": false                       // Set true for dry-run simulation
}
```

### Output Example
```json
{
  "timestamp": "2026-11-09T00:00:00.000Z",
  "eventsChecked": 12,
  "qualifyingEventsTriggered": 1,
  "alerts": [
    {
      "eventId": "usgs_us7000m8v7",
      "processed": true,
      "filesCreated": {
        "capXml": "alerts/usgs_us7000m8v7.cap.xml",
        "brief": "alerts/usgs_us7000m8v7.brief.md",
        "assessment": "alerts/usgs_us7000m8v7.assessment.json"
      },
      "deltaRecord": {
        "success": true,
        "action": "created_new_relational_draft",
        "recordId": "rec_1730000000000"
      },
      "webhook": { "dispatched": true }
    }
  ]
}
```

---

# Part 2: Command-Line Interface (CLI) Reference

The CLI binary is located at `bin/cli.js` (aliased as `drr-tool`). It operates with zero external dependencies and provides direct access to scientific models, live feed ingestion, and DELTA integration.

```text
Usage:
  node bin/cli.js <command> [options]
```

### 1. `usgs` — Query Real-Time USGS Earthquakes
Queries the live USGS FDSN-WS feed and computes Wald et al. (1999) Peak Ground Acceleration (PGA in $g$) from MMI:

```bash
# Query live M5.0+ earthquakes:
node bin/cli.js usgs --min-mag 5.0 --limit 10

# Options:
#   --min-mag <val>   Minimum magnitude threshold (default: 4.5)
#   --limit <num>     Maximum number of events (default: 20)
#   --file <path>     Offline GeoJSON fixture instead of live fetch
```

### 2. `forecast` — Open-Meteo Flood & Weather Risk
Queries global numerical weather models (ECMWF, GFS, ICON) and evaluates Anticipatory Action cumulative rainfall triggers:

```bash
# Fetch 5-day precipitation forecast for Jakarta, Indonesia (-6.2, 106.8):
node bin/cli.js forecast --lat -6.2 --lon 106.8 --days 5

# Options:
#   --lat <num>       Target latitude (default: 23.8)
#   --lon <num>       Target longitude (default: 90.4)
#   --days <num>      Forecast duration in days (default: 5)
#   --file <path>     Offline forecast JSON fixture
```

### 3. `gdacs` — UN OCHA / DG ECHO Disaster Alerts
Fetches active global disaster alerts for earthquakes (`EQ`), cyclones (`TC`), floods (`FL`), or volcanoes (`VO`):

```bash
# Query active Orange and Red disaster alerts:
node bin/cli.js gdacs --min-level Orange

# Query active tropical cyclones:
node bin/cli.js gdacs --type TC --min-level Orange

# Options:
#   --min-level <lvl> Minimum alert score (Green, Orange, Red)
#   --type <code>     Hazard type (EQ, TC, FL, VO)
#   --file <path>     Offline GeoJSON fixture
```

### 4. `monitor` — Autonomous Early Warning Engine
Evaluates live telemetry feeds against declarative threshold rules in `alerts-config.json`, running spatial exposure joins, fragility modeling, CAP XML generation, universal webhook dispatching, and DELTA draft record ingestion:

```bash
# Run a one-shot scan across all live feeds:
node bin/cli.js monitor --once

# Run continuous 24/7 background monitoring daemon:
node bin/cli.js monitor --interval 60 --config alerts-config.json

# Options:
#   --once            Execute a single scan and exit
#   --interval <sec>  Daemon polling interval in seconds (default: 60)
#   --config <path>   Custom path to declarative rules file
```

### 5. `delta-push` — Ingest Disaster Records into DELTA
Pushes an evaluated hazard assessment directly into a running DELTA Resilience instance (`http://localhost:3000/en/api/mcp`):

```bash
# Push an earthquake draft record with PGA intensity:
node bin/cli.js delta-push \
  --hazard earthquake \
  --event-id "usgs_us7000m8v7" \
  --intensity "0.32" \
  --notes "Live USGS Telemetry: M6.8 in Vanuatu"

# Options:
#   --hazard <type>   earthquake, flood, or wind (default: earthquake)
#   --event-id <id>   External event identifier (used for idempotent apiImportId)
#   --intensity <val> Hazard intensity (PGA in g, flood depth in m, wind in km/h)
#   --notes <text>    Audit notes attached to the draft disaster record
```

### 6. `fragility` — GEM & HAZUS Physical Fragility Curves
Calculates exceedance and discrete damage state probabilities (Slight, Moderate, Extensive, Complete) and Mean Damage Ratio (MDR):

```bash
# Evaluate Unreinforced Masonry (URM) at 0.40g PGA:
node bin/cli.js fragility --hazard earthquake --intensity 0.40 --taxonomy URM

# Evaluate Non-Ductile Pre-Code Concrete (C1_PRE_CODE) at 0.35g PGA:
node bin/cli.js fragility --hazard earthquake --intensity 0.35 --taxonomy C1_PRE_CODE

# Evaluate Flood Depth-Damage at 1.8m inundation:
node bin/cli.js fragility --hazard flood --intensity 1.8

# Options:
#   --hazard <type>   earthquake, flood, or wind
#   --intensity <val> Numerical hazard intensity
#   --taxonomy <code> Building class (URM, C1_PRE_CODE, C1_MODERATE_CODE, C2, S1, W1)
```

### 7. `spatial-join` — Deterministic Spatial Exposure Join
Performs ray-casting point-in-polygon queries intersecting hazard impact boundaries with exposed population, health clinics, and schools:

```bash
node bin/cli.js spatial-join \
  --hazard examples/earthquake-hazus-scenario/input-hazard.json \
  --exposure examples/earthquake-hazus-scenario/input-exposure.json
```

### 8. `vulnerability` — Sendai Framework Loss Accounting
Calculates Sendai Targets B (displaced), Target C (direct economic loss in USD), and Target D (critical infrastructure disruption):

```bash
node bin/cli.js vulnerability \
  --spatial spatial-report.json \
  --hazard earthquake \
  --intensity 0.42
```

### 9. `cap-generate` & `cap-validate` — OASIS CAP Alerting
Generates and validates ITU-T Recommendation X.1303 / OASIS CAP v1.2 XML emergency alerts:

```bash
# Generate CAP alert XML:
node bin/cli.js cap-generate \
  --headline "EARTHQUAKE WARNING: Mw 7.2 Mainshock" \
  --severity Extreme \
  --urgency Immediate \
  --event "Major Earthquake Emergency Alert"

# Validate CAP XML against specification:
node bin/cli.js cap-validate alerts/alert.cap.xml
```
