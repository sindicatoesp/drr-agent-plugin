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

## 2. Mounting All 19 Domain Skills in Cursor

Once connected, Cursor exposes all **41 deterministic DRR MCP tools**. To enable Cursor's agent to follow the DRR methodologies and governance rules, add references to `.cursorrules` or `.cursor/rules/`:

```markdown
# Disaster Risk Reduction Guidelines
When performing disaster telemetry, exposure modeling, loss estimation, alerting, or appraisal,
follow the relevant skill in `drr-agent-plugin/skills/`:
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

## 3. Example Cursor Commands & Chat Prompts

> See **[docs/skills-guide.md](../skills-guide.md)** for prompt examples across all **13 DRR skills**.

In Cursor Composer (`Ctrl + I` or `Cmd + I`):

```text
@drr-analytics Using hazard-exposure-modeling and vulnerability-matrix, validate and join
examples/earthquake-hazus-scenario/input-hazard.json against input-exposure.json.
Calculate illustrative economic loss (USD, 2026) under 0.40 g PGA for URM and C1_PRE_CODE
in exploratory mode, preserving any null asset values.
```
