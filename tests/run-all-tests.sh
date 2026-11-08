#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=================================================="
echo " Running All DRR Agent Plugin Unit & MCP Tests"
echo "=================================================="

node "$DIR/test-config.js"
node "$DIR/test-spatial.js"
node "$DIR/test-fragility.js"
node "$DIR/test-vulnerability.js"
node "$DIR/test-cap.js"
node "$DIR/test-usgs.js"
node "$DIR/test-openmeteo.js"
node "$DIR/test-delta.js"
node "$DIR/test-mcp-server.js"

echo "=================================================="
echo " 🎉 ALL 9 TESTS PASSED SUCCESSFULLY!"
echo "=================================================="
