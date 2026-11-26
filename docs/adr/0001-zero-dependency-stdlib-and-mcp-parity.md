# ADR 0001: Zero-Dependency Node.js Stdlib & 1:1 MCP/CLI Parity

- **Status**: Accepted
- **Date**: 2026-11-25

## Context
The DRR Agent Plugin operates in humanitarian, government Emergency Operations Center (EOC), and air-gapped environments where `npm install` supply-chain risk and binary native-addon failures are unacceptable. Furthermore, both AI agents (via MCP stdio) and shell/CI pipelines (via CLI) must expose identical deterministic capabilities.

## Decision
1. **Zero External Dependencies**: Production code in `bin/`, `lib/`, and `scripts/` MUST use only Node.js `>= 18.0.0` built-in modules, enforced by `scripts/lint.js`.
2. **1:1 MCP ↔ CLI Parity**: Every tool registered in `bin/mcp-server.js` (`TOOLS`) MUST have a corresponding subcommand in `bin/cli.js` and be indexed by `scripts/generate-inventory.js`, enforced by `scripts/arch-check.js` and `tests/test-cli-inventory.js`.
3. **Unidirectional Layering**: `lib/` modules contain domain logic and adapters and MUST NOT import `bin/`, `scripts/`, or `tests/`.

## Consequences
- Zero `node_modules` supply-chain surface and instant startup in air-gapped containers.
- Automated inventory (`docs/tool-inventory.md`, `skills-manifest.json`) stays synchronized with executable code.
