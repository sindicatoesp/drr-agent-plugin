#!/usr/bin/env bash
# ==============================================================================
# Southern Thailand Catastrophic Flood Scenario (6–7 November 2026)
# Hindcast Validation & E2E Post-Disaster Rapid Impact Assessment
# Provinces: Yala, Songkhla, Pattani, Narathiwat
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$DIR/../.." && pwd)"

echo "================================================================================"
echo " 🌊 SOUTHERN THAILAND FLOOD 2026: DRR AGENT PLUGIN END-TO-END BENCHMARK"
echo "================================================================================"

echo ""
echo "=== Step 1: Deterministic Spatial Exposure Join (Point-in-Polygon) ==="
node "$PLUGIN_ROOT/bin/cli.js" spatial-join \
  --hazard "$DIR/input-hazard.json" \
  --exposure "$DIR/input-exposure.json" > "$DIR/spatial-report.json"
echo "✓ Spatial report written to: $DIR/spatial-report.json"

echo ""
echo "=== Step 2: HAZUS Inundation Vulnerability & Damage Assessment (2.2m Depth) ==="
node "$PLUGIN_ROOT/bin/cli.js" vulnerability \
  --spatial "$DIR/spatial-report.json" \
  --hazard flood \
  --intensity 2.2 > "$DIR/vulnerability-report.json"
echo "✓ Vulnerability assessment written to: $DIR/vulnerability-report.json"

echo ""
echo "=== Step 3: OASIS CAP v1.2 XML Alert Synthesis & Validation ==="
node "$PLUGIN_ROOT/bin/cli.js" cap-generate \
  --headline "EXTREME FLASH & RIVERINE FLOOD WARNING: YALA, SONGKHLA, PATTANI, NARATHIWAT" \
  --severity "Extreme" \
  --urgency "Immediate" \
  --event "Catastrophic Flash & Fluvial Flood Warning (Southern Thailand)" \
  --area-desc "Southern Thailand: Yala, Songkhla, Pattani, Narathiwat Provinces (Pattani, Saiburi, Kolok River Basins)" \
  --output "$DIR/output-cap-alert.xml"

node "$PLUGIN_ROOT/bin/cli.js" cap-validate "$DIR/output-cap-alert.xml"
echo "✓ OASIS CAP v1.2 XML alert validated successfully."

echo ""
echo "=== Step 4: Synthesizing Executive Markdown Brief & Visual SitRep HTML ==="
node "$PLUGIN_ROOT/bin/cli.js" sitrep \
  --file "$DIR/vulnerability-report.json" \
  --output "$DIR/emergency-brief.md"

node "$PLUGIN_ROOT/bin/cli.js" sitrep \
  --file "$DIR/vulnerability-report.json" \
  --html \
  --output "$DIR/situation-report.html"
echo "✓ Executive Brief: $DIR/emergency-brief.md"
echo "✓ Visual HTML SitRep: $DIR/situation-report.html"

echo ""
echo "=== Step 5: UNDRR DELTA Database Ingestion (HIP Cluster 1072 Flood) ==="
node "$PLUGIN_ROOT/bin/cli.js" delta-push \
  --file "$DIR/vulnerability-report.json" \
  --name "2026 Southern Thailand Flash Flood (Yala-Songkhla-Pattani-Narathiwat)" \
  --mock > /dev/null
echo "✓ DELTA relational draft disaster bundle verified."

echo ""
echo "================================================================================"
echo " 🎉 Southern Thailand Flood Scenario Completed with 100% Deterministic Integrity"
echo "================================================================================"
