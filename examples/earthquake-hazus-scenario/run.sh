#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$DIR/../.." && pwd)"

echo "=== 1. Running Deterministic Spatial Exposure Join ==="
node "$PLUGIN_ROOT/bin/cli.js" spatial-join \
  --hazard "$DIR/input-hazard.json" \
  --exposure "$DIR/input-exposure.json" > "$DIR/spatial-report.json"

echo "Spatial report saved to spatial-report.json"

echo "=== 2. Evaluating Fragility Curves (URM vs C1_PRE_CODE at 0.42g PGA) ==="
node "$PLUGIN_ROOT/bin/cli.js" fragility --hazard earthquake --intensity 0.42 --taxonomy URM
node "$PLUGIN_ROOT/bin/cli.js" fragility --hazard earthquake --intensity 0.42 --taxonomy C1_PRE_CODE

echo "=== 3. Calculating Vulnerability Matrix & Sendai Metrics ==="
node "$PLUGIN_ROOT/bin/cli.js" vulnerability \
  --spatial "$DIR/spatial-report.json" \
  --hazard earthquake \
  --intensity 0.42 > "$DIR/vulnerability-report.json"

echo "Vulnerability report saved to vulnerability-report.json"

echo "=== 4. Generating OASIS CAP v1.2 Compliant Alert XML ==="
node "$PLUGIN_ROOT/bin/cli.js" cap-generate \
  --headline "EARTHQUAKE WARNING: Mw 7.2 Mainshock in Kathmandu Valley" \
  --severity "Extreme" \
  --urgency "Immediate" \
  --event "Major Earthquake Emergency Alert" \
  --area-desc "Kathmandu Valley, Bagmati Province" \
  --output "$DIR/output-cap-alert.xml"

echo "=== 5. Validating Generated CAP XML ==="
node "$PLUGIN_ROOT/bin/cli.js" cap-validate "$DIR/output-cap-alert.xml"

echo "=== Earthquake Scenario Execution Completed Successfully ==="
