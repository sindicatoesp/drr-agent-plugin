# ADR 0002: Fail-Closed Governance, Structured MCP Errors & Dual-Layer Evaluation

- **Status**: Accepted
- **Date**: 2026-11-25

## Context
When LLM agents orchestrate DRR tools, two failure modes are critical:
1. **Silent/Unsafe Defaults**: Treating missing numeric data as `0`, fabricating flood depth from rainfall totals, or auto-publishing live CAP/DELTA alerts.
2. **Opaque Tool Errors**: Returning raw JSON-RPC `-32000` errors on invalid tool arguments prevents LLM agents from self-correcting parameters.

## Decision
1. **Fail-Closed Defaults**: Keep `DRR_ENABLE_PRODUCTION_PUBLISH=false` by default, preserve `null` for missing numeric values, and enforce `depthStatus: "depth_unavailable"` when no calibrated hydraulic grid is supplied.
2. **MCP-Standard `isError: true` Tool Responses**: Tool-level validation and execution errors in `bin/mcp-server.js` return `result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: true, errorCode, tool, message, remediation, retryable }) }] }`, while protocol-level errors (malformed JSON-RPC, unknown method) retain standard JSON-RPC error codes (`-32700`, `-32601`, `-32602`).
3. **Dual-Layer Evaluation**: Evaluate both deterministic analytics (`lib/benchmarks.js`) and agentic orchestration/grounding (`tests/test-agent-eval-harness.js`, `tests/test-harness-eval.js`).

## Consequences
- End-user agents receive actionable remediation hints on bad parameters and recover reliably without aborting sessions.
- Safety invariants remain mechanically enforced regardless of prompt phrasing.
