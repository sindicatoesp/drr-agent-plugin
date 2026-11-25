#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "1) Offline WFP ADAM earthquake ingestion with --min-mag and --iso3 filters:"
node "$ROOT/bin/cli.js" adam \
  --collection eq \
  --file "$ROOT/examples/wfp-adam-ogc/sample-adam-eq.json" \
  --min-mag 6.0 \
  --iso3 PHL

echo "2) Offline WFP ADAM GloFAS gauge forecast (-9999.0 sentinel normalization):"
node "$ROOT/bin/cli.js" adam \
  --collection glofas \
  --file "$ROOT/examples/wfp-adam-ogc/sample-adam-glofas.json" \
  --country Thailand
