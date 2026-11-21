# Claude Code & Claude Desktop Platform Guide

How to use the **DRR Analytics Agent Plugin** with Anthropic's Claude Code CLI and Claude Desktop.

---

## 1. Claude Desktop Setup

Edit your Claude Desktop configuration file:
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
* **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add `drr-analytics` to the `mcpServers` object:

```json
{
  "mcpServers": {
    "drr-analytics": {
      "command": "node",
      "args": ["/absolute/path/to/drr-agent-plugin/bin/mcp-server.js"]
    }
  }
}
```

Restart Claude Desktop. The hammer icon (Tools) will show the **29 active DRR tools**.

---

## 2. Claude Code CLI Setup

To enable the MCP server in Claude Code CLI:

```bash
# Add the MCP server to Claude Code
claude mcp add drr-analytics node /absolute/path/to/drr-agent-plugin/bin/mcp-server.js

# Verify connected tools
claude mcp list
```

---

## 3. Loading All 13 Skills in Claude Code

Add the skills to your project's `CLAUDE.md`:

```markdown
## DRR Skills & Rules
Consult the relevant skill definitions in `drr-agent-plugin/skills/` before running DRR analytics:
- `drr-agent-plugin/skills/early-warning-telemetry/SKILL.md`
- `drr-agent-plugin/skills/gdacs-feed-ingestion/SKILL.md`
- `drr-agent-plugin/skills/forecast-based-action-trigger-design/SKILL.md`
- `drr-agent-plugin/skills/hazard-exposure-modeling/SKILL.md`
- `drr-agent-plugin/skills/vulnerability-matrix/SKILL.md`
- `drr-agent-plugin/skills/oasis-cap-alerting/SKILL.md`
- `drr-agent-plugin/skills/cap-governance-and-approval/SKILL.md`
- `drr-agent-plugin/skills/sendai-indicator-accounting/SKILL.md`
- `drr-agent-plugin/skills/delta-disaster-recording/SKILL.md`
- `drr-agent-plugin/skills/undrr-hip-hazard-classification/SKILL.md`
- `drr-agent-plugin/skills/event-identity-and-linkage/SKILL.md`
- `drr-agent-plugin/skills/drr-data-quality-and-provenance/SKILL.md`
- `drr-agent-plugin/skills/risk-reduction-options-appraisal/SKILL.md`
```

---

## 4. Example Interactions

> See **[docs/skills-guide.md](../skills-guide.md)** for ready-to-use prompts applying specific DRR use cases to every skill.

```text
> Using gdacs-feed-ingestion and sendai-indicator-accounting, analyze the offline GDACS flood
  sample at examples/flood-gdacs-exposure/sample-gdacs-flood.json, verify promptInjectionFlagged,
  run a spatial join against examples/flood-gdacs-exposure/critical-facilities.geojson, and
  separate physical facility damage (D-2..D-4) from service disruption (D-6..D-8).
```
