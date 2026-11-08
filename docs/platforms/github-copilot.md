# GitHub Copilot & VS Code Platform Guide

How to integrate the **DRR Analytics Agent Plugin** into GitHub Copilot Chat and Visual Studio Code.

---

## 1. Project-Level Instructions (`.github/copilot-instructions.md`)

GitHub Copilot automatically loads context and instructions from `.github/copilot-instructions.md`.
Add the following section to `.github/copilot-instructions.md`:

```markdown
## Disaster Risk Reduction (DRR) Domain Capabilities
When working on hazard modeling, loss estimation, GDACS feeds, or CAP emergency alerts:
- Follow the methodology in `drr-agent-plugin/skills/hazard-exposure-modeling/SKILL.md`
- For vulnerability matrices and Sendai Targets B/C/D, consult `drr-agent-plugin/skills/vulnerability-matrix/SKILL.md`
- For OASIS CAP v1.2 alerts, follow `drr-agent-plugin/skills/oasis-cap-alerting/SKILL.md`
- Use the CLI tool: `drr-agent-plugin/bin/cli.js` for deterministic calculations
```

---

## 2. Setting Up Custom Copilot Agents (`.github/agents/`)

You can create a specialized Copilot agent in `.github/agents/drr-analyst.agent.md`:

```markdown
---
name: drr-analyst
description: Specialist agent for hazard exposure modeling, GEM/HAZUS fragility curves, and OASIS CAP alert generation.
---

# DRR Analyst Agent
You are an expert disaster risk reduction analyst assisting UNDRR.
Always use the tools in `drr-agent-plugin/bin/cli.js` for deterministic spatial joins,
fragility probabilities, and CAP XML validation.
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

## 4. Running Verification Commands in the VS Code Terminal

```bash
# Verify installation
node drr-agent-plugin/bin/cli.js --help

# Test fragility calculation
node drr-agent-plugin/bin/cli.js fragility --hazard earthquake --intensity 0.35 --taxonomy URM
```
