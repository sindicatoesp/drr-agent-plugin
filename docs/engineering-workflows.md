# Engineering Workflows & Agent Playbook

Repeatable workflows for AI coding agents and contributors maintaining `@sindicatoesp/drr-agent-plugin`.

## 1. Adding a New Hazard or Telemetry Feed Adapter

1. **DISCOVER & UNDERSTAND**: Inspect [`lib/config.js`](../lib/config.js), [`lib/gdacs.js`](../lib/gdacs.js), [`lib/adam.js`](../lib/adam.js), and [`lib/security.js`](../lib/security.js).
2. **IMPLEMENT Adapter (`lib/<name>.js`)**:
   - Use **pure Node.js stdlib only** (`fetchJsonWithConfig`, `sanitizeUntrustedFeedText`, `redactUrlSecrets`, `computeSnapshotHash`).
   - Preserve `null` for missing numeric data (`unknown ≠ 0`).
   - Support offline `samplePayload` for deterministic air-gapped testing.
   - Export from [`lib/index.js`](../lib/index.js).
3. **WIRE MCP & CLI (`bin/mcp-server.js`, `bin/cli.js`)**:
   - Add tool schema to `TOOLS` (include `compact` option if records carry `rawProperties` or large polygons) and `case` to `handleToolCall`.
   - Add matching CLI subcommand to `printHelp()` and `switch (command)` in `bin/cli.js`.
4. **TEST**:
   - Add `tests/test-<name>.js` covering offline fixture parsing, missing-data/sentinel handling, prompt-injection sanitization, and `events.js` deduplication.
   - Register in `tests/run-all-tests.sh`.
5. **DOCUMENT & SYNC**:
   - Update `.env.example`, `docker-compose.yml`, `Makefile`, `make.bat`, `docs/configuration.md`, `docs/api-reference.md`, `README.md`, and `examples/`.
   - Update tool count assertions in `tests/test-cli-inventory.js` and `tests/test-mcp-server.js`.
   - Run `npm run generate:inventory && npm run check && npm run dpg:audit`.

## 2. Debugging CI & Flaky Network Tests

- Always reproduce offline first with `DRR_OFFLINE_MODE=true node tests/<failing-test>.js`.
- Never allow unit tests to depend on live external HTTP endpoints without an offline fixture fallback.
- Ensure all URLs and error messages pass through `redactUrlSecrets` (`lib/config.js`) so query-string or URL-encoded secrets cannot leak into summaries or logs.

## 3. Release Preparation (`dev` → `main`)

1. Ensure all feature PRs target `dev` and pass `npm run check` + `npm run dpg:audit`.
2. Preview next SemVer with `node scripts/next-version.js`.
3. Create an ADR in `docs/adr/` if any architectural boundary or governance invariant changed.
