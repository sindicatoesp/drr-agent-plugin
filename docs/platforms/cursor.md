# Cursor Platform Guide

How to configure and use the **DRR Analytics Agent Plugin** in Cursor IDE.

---

## 1. Configuring the MCP Server in Cursor

Cursor supports Model Context Protocol (MCP) servers via workspace configuration or global settings.

### Workspace Configuration (`.cursor/mcp.json`)
In the root of your project, create or edit `.cursor/mcp.json`:

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

### Global Cursor Settings
1. Open Cursor Settings (`Ctrl + Shift + J` or `Cmd + Shift + J`).
2. Navigate to **Features > MCP Servers**.
3. Click **Add New MCP Server**:
   * **Name**: `drr-analytics`
   * **Type**: `command` (stdio)
   * **Command**: `node /absolute/path/to/drr-agent-plugin/bin/mcp-server.js`

---

## 2. Mounting the Domain Skills in Cursor

To enable Cursor's agent to read the DRR methodologies:
1. In `.cursorrules` or `.cursor/rules/`, add a reference to the plugin skills:

```markdown
# Disaster Risk Reduction Guidelines
When performing disaster loss modeling or alert generation, follow the methodologies in:
- `drr-agent-plugin/skills/hazard-exposure-modeling/SKILL.md`
- `drr-agent-plugin/skills/vulnerability-matrix/SKILL.md`
- `drr-agent-plugin/skills/oasis-cap-alerting/SKILL.md`
```

---

## 3. Example Cursor Commands & Chat Prompts

In Cursor Composer (`Ctrl + I` or `Cmd + I`):

```text
@drr-analytics Run an exposure join between hazard-footprint.json and critical-facilities.json.
Calculate the economic loss under 0.40g PGA for Unreinforced Masonry (URM) and Concrete Frames (C1).
```
