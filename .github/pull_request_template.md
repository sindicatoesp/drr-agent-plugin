## Summary

<!-- Briefly describe what this PR changes and why. -->

## Type of Change

- [ ] Bug fix (`fix`)
- [ ] New feature or open-standard adapter (`feat`)
- [ ] Scientific validation / hindcast fixture (`test` / `feat`)
- [ ] Documentation / governance / DPG alignment (`docs`)

## DPG & Safety Checklist

- [ ] **Zero external dependencies**: Production code uses pure Node.js standard library only.
- [ ] **Fail-closed guardrails preserved**: CAP defaults to `Draft`, Sendai C-01..C-03 separation intact, missing data preserved as `null`, no fabricated flood depths from rainfall.
- [ ] **Privacy & Do-No-Harm**: No telemetry/tracking or individual PII collection introduced.
- [ ] **Automated checks pass**:
  - [ ] `npm run check` (lint + all test suites)
  - [ ] `npm run dpg:audit` (DPG Standard 9-indicator audit)
  - [ ] `npm run generate:inventory` (if MCP tools, CLI commands, or skills changed)
