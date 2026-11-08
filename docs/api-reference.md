# MCP Tools & API Reference

Complete technical specification of all 7 tools provided by the `drr-analytics` MCP server (`bin/mcp-server.js`).

---

## 1. `drr_gdacs_fetch`
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
