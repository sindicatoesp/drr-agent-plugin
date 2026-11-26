# GitHub Copilot Instructions

Generic repository engineering rules, invariants, and verification workflows are defined in [`AGENTS.md`](../AGENTS.md).

## GitHub Copilot–Specific Behavior
- **Copilot Chat / Agent Mode**: Use `#codebase` or `#file:AGENTS.md` to ground edits in actual module implementations before proposing changes.
- **Copilot Code Review & PRs**: Flag any violations of the invariants in [`AGENTS.md`](../AGENTS.md) (external npm imports, `lib/` importing `bin/`, stale `docs/tool-inventory.md`, or PRs targeting `main` instead of `dev`).
- **End-User DRR Tasks in VS Code**: When assisting with disaster telemetry, exposure, fragility, Sendai/DELTA, or CAP alerting, invoke the `drr-analytics` MCP server tools (`bin/mcp-server.js`) and follow the relevant `skills/*/SKILL.md` rather than estimating numbers inline.
