#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$DIR/../.." && pwd)"

echo "=== 1. Calculating Tropical Cyclone Saffir-Simpson Fragility at 225 km/h ==="
node "$PLUGIN_ROOT/bin/cli.js" fragility --hazard wind --intensity 225

echo "=== 2. Generating Emergency Operations Situation Brief ==="
cat << 'EOF' > "$DIR/generate_brief.js"
const { generateEmergencyBrief } = require("../../lib/cap");
const fs = require("fs");

const brief = generateEmergencyBrief({
  hazard: {
    eventName: "Tropical Cyclone PAMELA",
    hazardType: "Tropical Cyclone",
    eventTypeLabel: "Category 4 Severe Tropical Cyclone",
    alertLevel: "Red Alert",
    country: "Vanuatu / Tafea Province",
    hazardIntensity: "225 km/h Sustained Winds (Category 4)"
  },
  spatial: {
    summary: {
      totalExposedPopulation: 68500,
      totalExposedAssetValueUsd: 185000000
    }
  },
  vulnerability: {
    sendaiFrameworkMetrics: {
      targetB_AffectedPeople: {
        estimatedDisplacedPopulation: 29400
      },
      targetC_DirectEconomicLoss: {
        estimatedDirectEconomicLossUsd: 133200000,
        aggregateLossRatioPercentage: 72.0
      },
      targetD_CriticalInfrastructure: {
        totalDamagedFacilities: 14
      }
    },
    topDamagedAssets: [
      { name: "Lenakel Provincial Hospital", category: "healthcare", meanDamageRatio: 0.72, estimatedEconomicLossUsd: 18000000 },
      { name: "White Sands Coastal Highway Bridge", category: "transport", meanDamageRatio: 0.85, estimatedEconomicLossUsd: 9200000 },
      { name: "Tafea Central Water Depot", category: "utilities", meanDamageRatio: 0.65, estimatedEconomicLossUsd: 4500000 }
    ]
  }
});

fs.writeFileSync(__dirname + "/emergency-brief.md", brief, "utf8");
console.log("Emergency brief written to emergency-brief.md");
EOF

node "$DIR/generate_brief.js"
rm "$DIR/generate_brief.js"

echo "=== Cyclone Scenario Execution Completed Successfully ==="
