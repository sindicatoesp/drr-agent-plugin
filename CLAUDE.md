# CLAUDE.md — Claude Code Instructions

@AGENTS.md

## Claude Code–Specific Behavior
- **MCP Integration**: Prefer the `drr-analytics` MCP server (`bin/mcp-server.js`) when running in Claude Code or Claude Desktop; pass `compact: true` on `drr_adam_fetch`, `drr_gdacs_fetch`, and `drr_usgs_earthquake_fetch` to keep context windows lean.
- **Subagents & Edits**: Before editing `bin/mcp-server.js`, `bin/cli.js`, or `skills/*/SKILL.md`, verify 1:1 parity and run `npm run generate:inventory` + `npm run check`.
- **Safety**: Respect `DRR_ENABLE_PRODUCTION_PUBLISH=false` and never bypass `isError: true` remediation responses—adjust parameters and retry or escalate to the user.
