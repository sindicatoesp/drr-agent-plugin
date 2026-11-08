# OpenCode & Standalone CLI Platform Guide

How to use the **DRR Analytics Agent Plugin** with OpenCode and directly from the command line.

---

## 1. OpenCode Configuration (`opencode.json`)

To enable the DRR MCP server in OpenCode, add it to your `opencode.json`:

```json
{
  "mcp": {
    "drr-analytics": {
      "type": "local",
      "command": "node",
      "args": ["drr-agent-plugin/bin/mcp-server.js"],
      "enabled": true
    }
  }
}
```

---

## 2. Standalone Terminal CLI Reference

The plugin includes a dedicated CLI binary (`bin/cli.js`) that runs with zero external npm dependencies.

### Command Reference

#### 1. Ingest GDACS Hazard Alerts
```bash
# Fetch live active alerts from GDACS (Orange and Red alerts only)
node drr-agent-plugin/bin/cli.js gdacs --min-level Orange

# Filter by hazard type (EQ, TC, FL, VO)
node drr-agent-plugin/bin/cli.js gdacs --type EQ --min-level Orange

# Parse an offline or test GeoJSON file
node drr-agent-plugin/bin/cli.js gdacs --file sample.geojson
```

#### 2. Query USGS Earthquake Hazards Program
```bash
# Query real-time M5.0+ earthquakes and compute estimated PGA (g)
node drr-agent-plugin/bin/cli.js usgs --min-mag 5.0 --limit 10

# Parse an offline or test USGS GeoJSON file
node drr-agent-plugin/bin/cli.js usgs --file sample-usgs.geojson
```

#### 3. Query Open-Meteo Anticipatory Action Flood Triggers
```bash
# Forecast cumulative precipitation and flood risk for Dhaka (lat 23.8, lon 90.4)
node drr-agent-plugin/bin/cli.js forecast --lat 23.8 --lon 90.4 --days 5
```

#### 4. Evaluate GEM / HAZUS Fragility Curves
```bash
# Earthquake (PGA in g) for Unreinforced Masonry (URM)
node drr-agent-plugin/bin/cli.js fragility --hazard earthquake --intensity 0.40 --taxonomy URM

# Earthquake for Pre-Code Concrete Frame
node drr-agent-plugin/bin/cli.js fragility --hazard earthquake --intensity 0.40 --taxonomy C1_PRE_CODE

# Flood Depth-Damage (depth in meters)
node drr-agent-plugin/bin/cli.js fragility --hazard flood --intensity 1.8 --occupancy residential_1story

# Tropical Cyclone Wind Damage (speed in km/h)
node drr-agent-plugin/bin/cli.js fragility --hazard wind --intensity 225
```

#### 5. Deterministic Spatial Exposure Joins
```bash
node drr-agent-plugin/bin/cli.js spatial-join \
  --hazard examples/earthquake-hazus-scenario/input-hazard.json \
  --exposure examples/earthquake-hazus-scenario/input-exposure.json > spatial-report.json
```

#### 6. Vulnerability Matrix & Sendai Target Calculations
```bash
node drr-agent-plugin/bin/cli.js vulnerability \
  --spatial spatial-report.json \
  --hazard earthquake \
  --intensity 0.40 > vulnerability-report.json
```

#### 7. Generate OASIS CAP v1.2 XML Alerts
```bash
node drr-agent-plugin/bin/cli.js cap-generate \
  --headline "FLASH FLOOD EMERGENCY WARNING" \
  --severity "Extreme" \
  --urgency "Immediate" \
  --event "Flash Flood Inundation" \
  --area-desc "Padma River Lowlands" \
  --output flood-alert.xml
```

#### 8. Validate CAP XML Conformance
```bash
node drr-agent-plugin/bin/cli.js cap-validate flood-alert.xml
```
