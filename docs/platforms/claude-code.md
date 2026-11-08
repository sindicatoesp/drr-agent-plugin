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

Restart Claude Desktop. The hammer icon (Tools) will show the 5 active DRR tools.

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

## 3. Loading Skills in Claude Code

Add the skills to your project's `CLAUDE.md`:

```markdown
## DRR Skills & Rules
Consult the following skill definitions when performing disaster loss or alerting tasks:
- `drr-agent-plugin/skills/hazard-exposure-modeling/SKILL.md`
- `drr-agent-plugin/skills/vulnerability-matrix/SKILL.md`
- `drr-agent-plugin/skills/oasis-cap-alerting/SKILL.md`
- `drr-agent-plugin/skills/gdacs-feed-ingestion/SKILL.md`
```

---

## 4. Example Interactions

```text
> Analyze the active GDACS flood alert in Bangladesh using drr_gdacs_fetch.
  Then execute a spatial join against our health clinics GeoJSON and report Sendai Target D damages.
```
