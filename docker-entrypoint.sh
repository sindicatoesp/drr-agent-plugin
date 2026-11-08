#!/bin/sh
set -e

# Default to monitor daemon if no arguments are provided
if [ $# -eq 0 ]; then
  set -- "monitor" "--interval" "${MONITOR_INTERVAL_SEC:-60}"
fi

# Shortcut handling for drr CLI subcommands
case "$1" in
  monitor|usgs|forecast|fragility|spatial-join|vulnerability|cap-generate|cap-validate|delta-push)
    set -- node bin/cli.js "$@"
    ;;
  mcp|mcp-server)
    shift
    set -- node bin/mcp-server.js "$@"
    ;;
  test)
    set -- bash tests/run-all-tests.sh
    ;;
  *)
    # If the first argument is a flag like --help or --version
    case "$1" in
      -*)
        set -- node bin/cli.js "$@"
        ;;
    esac
    ;;
esac

exec "$@"
