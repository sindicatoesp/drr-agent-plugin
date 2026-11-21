---
name: risk-reduction-options-appraisal
description: Expected Annual Loss (EAL) trapezoidal AEP integration and mitigation Cost-Benefit Analysis (NPV, BCR, residual risk, sensitivity matrix) distinguishing quantitative economics from policy judgement.
---

# Risk Reduction & Mitigation Investment Appraisal

## Triggers
* Computing Expected Annual Loss (EAL) from multi-return-period exceedance loss curves.
* Comparing mitigation/prevention investments using NPV, Benefit-Cost Ratio (BCR), maintenance OpEx, discounting, and residual EAL.

## Non-Goals
* **MUST NOT** compute Expected Annual Loss (EAL) from a single scenario event (R-15).
* **MUST NOT** omit `currency`, `valuationYear`, discount rate, or tail extrapolation assumptions.
* **MUST NOT** present an investment recommendation as purely mathematical without separating quantitative findings from policy/equity judgement.

## Authoritative References & Versions
* **UNDRR Risk-Informed Investment & Cost-Benefit Appraisal Principles** (`REG_EAL_TRAPEZOIDAL_AEP`, `REG_MITIGATION_CBA`).

## Required Inputs
* For EAL: >= 2 distinct `{ returnPeriodYears, loss }` points, explicit `currency`, `valuationYear`, and `tailHandling`.
* For CBA: `baselineEal`, `mitigatedEal`, `capex`, `discountRate`, `horizonYears`, `currency`, `valuationYear`, optional `annualOpex` / `annualCoBenefits`.

## Allowed Executable Tools
* `drr_expected_annual_loss`
* `drr_mitigation_cost_benefit`
* `drr_uncertainty_propagate`

## Escalation Conditions
* Escalate to economic planning & treasury stakeholders for discount rate selection, fiscal constraints, and equity weighting (`policyJudgements`).

## Example Output & Failure Cases
* **Single-Event EAL Rejection**: Supplying 1 return-period point fails deterministically (`EAL requires at least 2 distinct return periods`).
* **CBA Separation**: Returns both `quantitativeMetrics: { npv, bcr, residualRiskEal, sensitivityMatrix }` and distinct `policyJudgements` array.

## Example End-User Prompts
* **Use Case — Coastal Flood Levee EAL & Cost-Benefit Appraisal (Municipal Treasury)**:
  ```text
  Using the risk-reduction-options-appraisal skill, compute baseline EAL (USD, 2026,
  tailHandling: "flat_extrapolation") from return-period flood losses: 10-yr $800k, 50-yr $4.2M,
  100-yr $8.5M, 250-yr $14M. Then run CBA for a $2.5M levee upgrade ($30k/yr OpEx, $15k/yr
  co-benefits, 5% discount rate, 25-year horizon) that lowers EAL to $180k/yr, reporting NPV,
  BCR, residual risk, sensitivity matrix, and separate policyJudgements.
  ```
* **Use Case — Seeded Monte Carlo Uncertainty Check**:
  ```text
  Run seeded Monte Carlo uncertainty propagation (seed: 42, iterations: 1000,
  allowIllustrativeDistributions: true) for a 2.0 m flood across $10M residential_1story exposure.
  ```
* See [`docs/skills-guide.md`](../../docs/skills-guide.md#13-risk-reduction-options-appraisal) for additional examples.

