# GEMINI.md — Gemini CLI & Antigravity Instructions

@AGENTS.md

## Gemini & Antigravity–Specific Behavior
- **Plugin & MCP Discovery**: Antigravity loads `plugin.json`, `mcp.json`, and `skills/*/SKILL.md` automatically via `.agents/plugins/` or `~/.gemini/config/plugins/`.
- **Context Budget**: When invoking `drr_adam_fetch`, `drr_gdacs_fetch`, or `drr_usgs_earthquake_fetch`, pass `compact: true` unless full `rawProperties` or `MultiPolygon` coordinates are required.
- **Verification Gate**: Always run `npm run check` (`lint.js` + `arch-check.js` + `tests/run-all-tests.sh`) and `npm run dpg:audit` before reporting completion.
