# GitHub Copilot & VS Code Platform Guide

How to integrate the **DRR Analytics Agent Plugin** into GitHub Copilot Chat and Visual Studio Code.

---

## 1. Project-Level Instructions (`.github/copilot-instructions.md`)

GitHub Copilot automatically loads context and instructions from `.github/copilot-instructions.md`.
Add the following section to `.github/copilot-instructions.md`:

```markdown
## Disaster Risk Reduction (DRR) Domain Capabilities
When working on disaster telemetry, exposure modeling, loss estimation, alerting, Sendai/DELTA
reporting, or mitigation appraisal, consult the relevant skill in `drr-agent-plugin/skills/`:
- Telemetry & Triggers: `early-warning-telemetry`, `gdacs-feed-ingestion`, `forecast-based-action-trigger-design`
- Spatial & Impact: `hazard-exposure-modeling`, `vulnerability-matrix`
- Alerting Governance: `oasis-cap-alerting`, `cap-governance-and-approval`
- Sendai, DELTA & Taxonomy: `sendai-indicator-accounting`, `delta-disaster-recording`, `undrr-hip-hazard-classification`, `event-identity-and-linkage`
- Quality & Appraisal: `drr-data-quality-and-provenance`, `risk-reduction-options-appraisal`
- Use the MCP server (`drr-agent-plugin/bin/mcp-server.js`, 29 tools) or CLI (`drr-agent-plugin/bin/cli.js`, 29 commands) for deterministic calculations.
```

---

## 2. Setting Up Custom Copilot Agents (`.github/agents/`)

You can create a specialized Copilot agent in `.github/agents/drr-analyst.agent.md`:

```markdown
---
name: drr-analyst
description: Specialist agent for hazard exposure modeling, GEM/HAZUS fragility curves, Sendai/DELTA accounting, and OASIS CAP alert generation.
---

# DRR Analyst Agent
You are an expert disaster risk reduction analyst assisting UNDRR.
Always use the 29 MCP tools in `drr-agent-plugin/bin/mcp-server.js` (or CLI `drr-agent-plugin/bin/cli.js`)
and follow the 13 domain skills in `drr-agent-plugin/skills/` for deterministic spatial joins,
fragility probabilities, Sendai validation, and CAP XML governance.
```

---

## 3. VS Code MCP Bridge (via MCP Extension or Stdio Runner)

In `.vscode/settings.json`:

```json
{
  "mcp.servers": {
    "drr-analytics": {
      "command": "node",
      "args": ["${workspaceFolder}/drr-agent-plugin/bin/mcp-server.js"]
    }
  }
}
```

---

## 4. Verification Commands & Prompt Examples

> For end-user prompt examples covering all **13 DRR skills**, see **[docs/skills-guide.md](../skills-guide.md)**.

```bash
# Verify installation (lists all 29 CLI subcommands)
node drr-agent-plugin/bin/cli.js --help

# Test illustrative fragility calculation
node drr-agent-plugin/bin/cli.js fragility --hazard earthquake --intensity 0.35 --taxonomy URM
```
