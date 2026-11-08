---
name: oasis-cap-alerting
description: Generates and validates ITU-T X.1303 / OASIS Common Alerting Protocol (CAP) v1.2 XML emergency alerts and synthesizes multi-agency emergency operations situation briefs. Use when drafting public warnings or validating CAP schemas.
---

# OASIS Common Alerting Protocol (CAP) v1.2 & Emergency Briefs

## Overview
The Common Alerting Protocol (CAP) is an international standard format for emergency alerts and public warnings (ITU-T Recommendation X.1303 / OASIS CAP v1.2). This skill guides agents in generating schema-compliant XML messages and synthesizing clear emergency briefs for National Disaster Management Agencies (NDMAs) and UN OCHA.

---

## 1. CAP v1.2 Mandatory Schema Elements

All generated alerts must strictly adhere to `urn:oasis:names:tc:emergency:cap:1.2`:

### Root `<alert>` Elements
* **`<identifier>`**: Globally unique message identifier (e.g. `DELTA-CAP-20261109-001`).
* **`<sender>`**: Originating authority email or URI (e.g. `ndma-alerts@gov.org`).
* **`<sent>`**: ISO-8601 timestamp with timezone offset (`YYYY-MM-DDTHH:MM:SS+00:00`).
* **`<status>`**: `Actual` | `Exercise` | `System` | `Test` | `Draft`.
* **`<msgType>`**: `Alert` | `Update` | `Cancel` | `Ack` | `Error`.
* **`<scope>`**: `Public` | `Restricted` | `Private`.

### Sub-Element `<info>` Elements
* **`<category>`**: `Geo` (Earthquake/Landslide/Tsunami), `Met` (Flood/Storm/Cyclone), `Safety`, `Fire`, `Health`, `Infra`.
* **`<event>`**: Official event description (e.g. `Major Earthquake Warning`).
* **`<urgency>`**: `Immediate` (< 1 hour), `Expected` (< 24 hours), `Future`, `Past`, `Unknown`.
* **`<severity>`**: `Extreme` (Extraordinary threat to life/property), `Severe` (Significant threat), `Moderate`, `Minor`, `Unknown`.
* **`<certainty>`**: `Observed` (Confirmed occurrence), `Likely` (p > ~50%), `Possible`, `Unlikely`, `Unknown`.
* **`<headline>`**: Concise headline (< 160 characters).
* **`<description>`**: Detailed narrative of hazard intensity and expected impact.
* **`<instruction>`**: Clear, actionable protective directives for the public.
* **`<area>`**:
  * **`<areaDesc>`**: Text description of affected administrative territory.
  * **`<polygon>`**: Space-delimited coordinates formatted strictly as **`lat,lon lat,lon ...`** (Notice latitude precedes longitude in CAP!).

---

## 2. Emergency Situation Brief Standard (SitRep)

When synthesizing situation briefs for Emergency Operations Centers:
1. **Header Block**: Alert Level (Green/Orange/Red), Timestamp, Geo-extent, Authority.
2. **Executive Summary**: 2-3 sentences summarizing the event and total affected population.
3. **Sendai Framework Metrics**:
   - Target B: Exposed vs. displaced population.
   - Target C: Asset value exposed vs. estimated direct losses.
   - Target D: Compromised critical infrastructure (hospitals, schools, bridges).
4. **Immediate Directives**: Actionable operational instructions (search & rescue, shelter activation, public advisories).

---

## 3. Workflow for AI Agents

1. Extract hazard, spatial exposure, and vulnerability outputs.
2. Call `drr_cap_alert_generate_validate` with `mode: "generate_xml"` to produce the CAP XML.
3. Verify that the output validation report returns `isValid: true`.
4. If an operational summary is requested, call `drr_cap_alert_generate_validate` with `mode: "generate_brief"`.
