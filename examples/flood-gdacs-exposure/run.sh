#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$DIR/../.." && pwd)"

echo "=== 1. Ingesting GDACS Alert Feed Fixture ==="
node "$PLUGIN_ROOT/bin/cli.js" gdacs --file "$DIR/sample-gdacs-flood.json" --min-level Orange

echo "=== 2. Performing Spatial Intersection Join Against Critical Facilities ==="
node "$PLUGIN_ROOT/bin/cli.js" spatial-join \
  --hazard "$DIR/sample-gdacs-flood.json" \
  --exposure "$DIR/critical-facilities.geojson" > "$DIR/exposure-report.json"

echo "Exposure report saved to exposure-report.json"

echo "=== 3. Evaluating Flood Vulnerability at 1.8m Inundation Depth ==="
node "$PLUGIN_ROOT/bin/cli.js" vulnerability \
  --spatial "$DIR/exposure-report.json" \
  --hazard flood \
  --intensity 1.8 > "$DIR/flood-loss-report.json"

echo "Flood loss report saved to flood-loss-report.json"
echo "=== Flood Scenario Execution Completed Successfully ==="
