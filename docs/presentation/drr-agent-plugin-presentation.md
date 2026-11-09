---
marp: true
theme: gaia
_class: lead
paginate: true
backgroundColor: #0f172a
color: #f8fafc
header: 'Disaster Risk Reduction (DRR) Agent Plugin'
footer: 'UN Sendai Framework • OASIS CAP v1.2 • GEM / HAZUS • agent-plugins.org'
style: |
  section {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    padding: 40px 60px;
    background: radial-gradient(circle at 15% 15%, #1e293b 0%, #0f172a 100%);
  }
  h1 {
    color: #38bdf8;
    font-size: 2.2rem;
    margin-bottom: 0.5rem;
  }
  h2 {
    color: #93c5fd;
    font-size: 1.6rem;
    border-bottom: 2px solid #334155;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  h3 {
    color: #e2e8f0;
    font-size: 1.25rem;
  }
  p, li {
    font-size: 1.05rem;
    line-height: 1.5;
    color: #cbd5e1;
  }
  strong {
    color: #f8fafc;
  }
  .highlight {
    color: #38bdf8;
    font-weight: bold;
  }
  .tag {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 0.8rem;
    font-weight: 600;
    margin-right: 6px;
  }
  .tag-red { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
  .tag-blue { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #38bdf8; }
  .tag-green { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; }
  .tag-orange { background: rgba(249, 115, 22, 0.2); color: #fb923c; border: 1px solid #f97316; }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
  }
  .card {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 16px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th {
    background: #1e293b;
    color: #38bdf8;
    padding: 8px 12px;
    border-bottom: 2px solid #475569;
    text-align: left;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid #334155;
  }
---

# Disaster Risk Reduction (DRR) Agent Plugin
### Autonomous Telemetry, Deterministic Physical Modeling & Multi-Agency Alerting

<span class="tag tag-blue">Model Context Protocol</span>
<span class="tag tag-green">Zero External Dependencies</span>
<span class="tag tag-red">OASIS CAP v1.2</span>
<span class="tag tag-orange">UNDRR SFM Targets B/C/D</span>

**Presenter / Team:** DRR Agent Plugin Engineering & Operations  
**Target Audience:** EOC Duty Officers, Humanitarian Leads, Resilience Engineers & Donors  
**Platform Standard:** agent-plugins.org v1.0.0

<!--
Speaker Notes:
Welcome everyone. Today we are presenting the Disaster Risk Reduction Agent Plugin.
This plugin solves the critical gap between conversational AI agents and deterministic, physics-based disaster management analytics. It is 100% dependency-free, operates in real-time, and adheres strictly to UN and OASIS international standards.
-->

---

## 1. The Operational Reality & Problem Statement

Disaster response decisions in the first **120 minutes** dictate survival rates, while **72-hour anticipatory windows** dictate economic resilience.

<div class="grid-2">
<div class="card">
<h3 style="color:#f87171;">⚠️ The Humanitarian & EOC Crisis</h3>

* **Information Overload**: Satellite feeds, seismic sensors, and weather models flood EOCs with disconnected raw telemetry.
* **LLM Hallucinations**: Standard LLMs cannot accurately compute ground motion attenuation, ray-casting spatial joins, or lognormal fragility curves.
* **Fragmented Formats**: UN OCHA SitReps, OASIS CAP broadcasts, and national disaster accounting databases live in silos.
</div>

<div class="card">
<h3 style="color:#4ade80;">💡 The Agent Plugin Solution</h3>

* **Deterministic Computation**: Rigorous math for Wald GMPE ground acceleration, GEM/HAZUS curves, and ray-casting.
* **Agentic Interoperability**: Compatible with Google Antigravity, Cursor, Claude Code, GitHub Copilot, and OpenCode.
* **Multi-Agency Outputs**: Auto-generates ITU-T X.1303 CAP XML alerts, Markdown SitReps, and DELTA draft records simultaneously.
</div>
</div>

<!--
Speaker Notes:
In sudden-onset disasters like M7+ earthquakes, EOCs don't need text summaries—they need instant spatial intersection with schools, hospitals, and population centers, coupled with validated structural damage estimates.
-->

---

## 2. Real-World Lifecycles: "When & By Whom"

The plugin addresses the complete disaster lifecycle across specialized operational personas:

| Operational Phase | Timeline | Primary Actors | Key Plugin Workflows |
| :--- | :--- | :--- | :--- |
| **Pre-Disaster** | T -72h to -24h | Anticipatory Action Leads (Red Cross, WFP) | Open-Meteo multi-model precipitation triggers, flood shelter exposure join |
| **Co-Disaster (Instant)** | T +5m to +2h | National EOC Watchstanders (FEMA, BNPB) | USGS seismic telemetry, Wald PGA estimation, OASIS CAP v1.2 broadcast sirens |
| **Co-Disaster (Tactical)** | T +6h to +48h | UN Humanitarian Officers (OCHA, UNDAC) | GDACS cyclone swaths, critical infrastructure audit, 24h Situation Briefs |
| **Post-Disaster** | T +2w to +3m | National Loss Focal Points (UNDRR DELTA) | Sendai Framework Target B, C, & D loss accounting for UN General Assembly |

<!--
Speaker Notes:
Notice how the plugin adapts seamlessly: from releasing pre-allocated forecast-based financing 3 days before a flood peaks, to cell broadcasts within 5 minutes of an earthquake, all the way to year-end UN Sendai loss reporting.
-->

---

## 3. End-to-End System Architecture

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      MULTI-SOURCE HAZARD TELEMETRY                     │
 │  GDACS (Live GeoJSON) │ USGS FDSN-WS (Seismic) │ Open-Meteo (NWP Rain) │
 └──────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                   DETERMINISTIC COMPUTATIONAL ENGINES                  │
 │  Spatial Ray-Casting  │ Wald GMPE (PGA) │ GEM / HAZUS Fragility Curves │
 └──────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                       MULTI-AGENCY DISPATCH LAYER                      │
 │  OASIS CAP v1.2 XML   │ Universal Webhooks │ UNDRR DELTA Push (HIPs)   │
 └──────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                       AI AGENT & CLIENT RUNTIMES                       │
 │  Antigravity IDE │ Claude Code │ Cursor │ Copilot │ OpenCode │ Docker  │
 └────────────────────────────────────────────────────────────────────────┘
```

**Zero External Dependencies** • Pure Node.js Standard Library • 100% Deterministic & Air-Gappable

<!--
Speaker Notes:
Every computation is local and deterministic. No third-party packages to bloat security or introduce supply-chain vulnerabilities. Even in air-gapped military or EOC networks, the engine runs flawlessly.
-->

---

## 4. Multi-Source Hazard Telemetry Engines

<div class="grid-3">
<div class="card">
<h3 style="color:#fb923c;">📡 USGS Real-Time</h3>
<ul>
  <li>Global seismic event ingestion</li>
  <li>Depth, magnitude, Instrumental MMI</li>
  <li>Automated Wald et al. (1999) GMPE:</li>
</ul>
$$\text{PGA} = \frac{10^{(\text{MMI} + 1.66) / 3.66}}{980.665}$$
</div>

<div class="card">
<h3 style="color:#38bdf8;">🌪️ GDACS Hazards</h3>
<ul>
  <li>Tropical Cyclones, Floods, Volcanoes</li>
  <li>Calculated impact buffer radii</li>
  <li>Alert severity scores (Green, Orange, Red)</li>
  <li>UN OCHA & EC DG ECHO coordination</li>
</ul>
</div>

<div class="card">
<h3 style="color:#4ade80;">🌧️ Open-Meteo</h3>
<ul>
  <li>ECMWF, GFS, ICON multi-model</li>
  <li>Anticipatory Action flood triggers</li>
  <li>Cumulative 24h/72h rainfall</li>
  <li>Inundation depth estimation</li>
</ul>
</div>
</div>

<!--
Speaker Notes:
The plugin translates raw intensity parameters—like Instrumental Modified Mercalli Intensity—into engineering metrics like Peak Ground Acceleration in units of g, which directly feeds physical fragility equations.
-->

---

## 5. GEM & HAZUS Physical Fragility Modeling

Translating ground motion & flood depth into structural failure probabilities:

$$P(DS \ge ds_i \mid IM) = \Phi\left(\frac{\ln(IM / \theta_i)}{\beta_i}\right)$$

<div class="grid-2">
<div class="card">
<h3 style="color:#38bdf8;">Supported Structural Taxonomies</h3>

* **URM**: Unreinforced Masonry Bearing Walls
* **C1_PRE_CODE**: Non-Ductile Concrete Frame
* **C1_MODERATE_CODE**: Ductile Moment Frame
* **C2 / S1 / W1**: Shear Wall, Steel, Wood Frame
* **Flood & Wind**: Depth-damage & Saffir-Simpson curves
</div>

<div class="card">
<h3 style="color:#f87171;">Damage State Hierarchy</h3>

* **Slight ($ds_1$)**: Hairline cracking (MDR: 5%)
* **Moderate ($ds_2$)**: Shear rebar yielding (MDR: 25%)
* **Extensive ($ds_3$)**: Permanent drift (MDR: 60%)
* **Complete ($ds_4$)**: Partial/total collapse (MDR: 100%)

$$\text{MDR} = \sum P(DS = ds_i) \times \text{DF}(ds_i)$$
</div>
</div>

<!--
Speaker Notes:
Rather than arbitrary guessing, the plugin uses lognormal cumulative distribution functions based on the Global Earthquake Model and FEMA HAZUS-MH 2.1 methodologies.
-->

---

## 6. Offline Leaflet & Spatial GIS Intelligence

Air-gapped geospatial visualization and deterministic exposure intersection:

<div class="grid-2">
<div class="card">
<h3 style="color:#4ade80;">🗺️ 100% Offline Vector Mapping</h3>

* **Air-Gapped EOC Ready**: Pure vector canvas & GeoJSON geometry with zero tile server or CDN dependencies.
* **Ray-Casting Point-in-Polygon**: Evaluates containment for schools, hospitals, and population clusters.
* **Geodesic Buffer Queries**: Calculates hazard decay and attenuation zones across kilometers.
* **Multi-Scenario Switcher**: Pre-loaded with Nepal M7.2 Earthquake, Cyclone Pamela, and Bangladesh Flood fixtures.
</div>

<div class="card">
<h3 style="color:#38bdf8;">📍 Tactical Facility Triage</h3>

* **Dynamic Severity Pins**:
  * 🔴 **Critical Failure**: Mean Damage Ratio $\ge 50\%$
  * 🟠 **Moderate Damage**: MDR $25\% - 50\%$
  * 🟢 **Light / Operational**: MDR $< 25\%$
* **Embedded SitRep Map**: Automatically injected into every HTML Situation Report generated by the agent.
* **Interactive HUD**: Real-time cursor coordinates (WGS84), dynamic scale bar, and layer toggles.
</div>
</div>

<!--
Speaker Notes:
In disaster zones, internet connectivity is the first infrastructure to fail. Our GIS mapping presentation runs completely offline, rendering spatial polygons, buffer rings, and facility damage without external tile requests.
-->

---

## 7. United Nations Sendai Framework Loss Accounting

Post-event damage calculations map automatically to official **UN Sendai Framework Targets**:

<div class="grid-3">
<div class="card" style="border-top: 4px solid #38bdf8;">
<h3 style="color:#38bdf8;">Target B: Population</h3>
<p><strong>Substantially reduce affected people</strong></p>
<ul>
  <li>Exposed population in footprint</li>
  <li>Estimated displaced individuals</li>
  <li>Shelter-dependent households</li>
</ul>
</div>

<div class="card" style="border-top: 4px solid #fb923c;">
<h3 style="color:#fb923c;">Target C: Economic Loss</h3>
<p><strong>Reduce direct economic disaster loss</strong></p>
<ul>
  <li>Exposed structural asset value</li>
  <li>Direct physical loss in USD</li>
  <li>Aggregate loss ratio percentage</li>
</ul>
</div>

<div class="card" style="border-top: 4px solid #f87171;">
<h3 style="color:#f87171;">Target D: Infrastructure</h3>
<p><strong>Disruptions to basic services</strong></p>
<ul>
  <li>Hospitals & Emergency clinics</li>
  <li>Schools & Educational facilities</li>
  <li>Power substations & Critical bridges</li>
</ul>
</div>
</div>

**Direct Ingestion**: Automatically committed as Draft Records into the UNDRR DELTA Resilience Database.

<!--
Speaker Notes:
This enables immediate alignment between disaster operations and national reporting commitments under the Sendai Framework 2015-2030.
-->

---

## 7. OASIS Common Alerting Protocol (CAP v1.2)

Strict compliance with **ITU-T Recommendation X.1303** & **OASIS CAP v1.2**:

<div class="grid-2">
<div class="card">
<h3 style="color:#4ade80;">Validated CAP XML Alert Elements</h3>

* **Namespace**: `urn:oasis:names:tc:emergency:cap:1.2`
* **Status**: `Actual` | **MsgType**: `Alert` | **Scope**: `Public`
* **Severity Matrix**: `Extreme`, `Severe`, `Moderate`, `Minor`
* **Urgency**: `Immediate` | **Certainty**: `Observed`
* **Targeting**: Geodesic `lat,lon` polygons & buffer circles
* **Safety Directives**: Direct public protection guidance
</div>

<div class="card">
<h3 style="color:#38bdf8;">Broadcast & Multi-Channel Reach</h3>

```xml
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>DELTA-CAP-1731118400</identifier>
  <info>
    <category>Geo</category>
    <event>Major Earthquake Warning</event>
    <urgency>Immediate</urgency>
    <severity>Extreme</severity>
    <area>
      <areaDesc>Vanuatu Province</areaDesc>
      <polygon>-14.5,166.8 -14.8,167.2 ...</polygon>
    </area>
  </info>
</alert>
```
</div>
</div>

<!--
Speaker Notes:
CAP is the global standard for cellular broadcasts, outdoor sirens, and television emergency crawlers. The plugin generates and validates this XML with zero external libraries.
-->

---

## 8. Autonomous 24/7 Monitoring Daemon

Continuous background vigilance with automated impact modeling and universal webhooks:

<div class="grid-2">
<div class="card">
<h3 style="color:#38bdf8;">Daemon Engine Workflow</h3>

1. **Scheduled Polling**: Ingests USGS, GDACS, and Open-Meteo feeds at customizable intervals (`INTERVAL=60`).
2. **Rule Evaluation**: Compares events against declarative rules in `alerts-config.json` (magnitude, PGA, rain).
3. **Automated Impact Modeling**: Auto-executes spatial exposure joins and fragility calculations.
4. **Tri-Output Dispatch**:
   * Saves CAP v1.2 XML to `alerts/`
   * Writes executive Situation Brief (`.brief.md`)
   * Pushes Draft Record to DELTA Resilience
   * Fires Slack / Teams / Discord Webhooks
</div>

<div class="card">
<h3 style="color:#4ade80;">Instant Operational Commands</h3>

```bash
# 1. Native background process
make monitor INTERVAL=60

# 2. Production Docker container (~130MB)
make docker-up
make docker-logs

# 3. Direct CLI execution
drr-tool monitor --once --mock
```

<div style="margin-top:15px; padding:10px; background:#0f172a; border-radius:8px; font-size:0.85rem;">
  <strong>National Border Guard:</strong> Restrict automated actions to specific national boundaries via <code>TARGET_COUNTRIES=Vanuatu</code> or bounding box.
</div>
</div>
</div>

<!--
Speaker Notes:
The daemon can run locally or in our hardened 130MB Alpine Docker image. It monitors feeds 24/7 without needing human intervention until an actionable threshold is breached.
-->

---

## 9. Real-World Tabletop Scenario Walkthroughs

Three end-to-end executable testbeds included out-of-the-box:

<div class="grid-3">
<div class="card">
<h3 style="color:#f87171;">Scenario A: Earthquake</h3>
<p><strong>HAZUS M7.2 Shaking</strong></p>
<ul>
  <li>PGA: 0.38g shaking</li>
  <li>Taxonomy: URM & C1</li>
  <li>18,400 exposed population</li>
  <li>3 hospitals compromised</li>
  <li>Instant OASIS CAP siren</li>
</ul>
<code>make scenario-earthquake</code>
</div>

<div class="card">
<h3 style="color:#38bdf8;">Scenario B: Flood</h3>
<p><strong>GDACS Atmospheric River</strong></p>
<ul>
  <li>240mm 72h rainfall</li>
  <li>1.8m inundation depth</li>
  <li>Anticipatory action trigger</li>
  <li>3 critical shelters secured</li>
  <li>Pre-flood evacuation notice</li>
</ul>
<code>make scenario-flood</code>
</div>

<div class="card">
<h3 style="color:#fb923c;">Scenario C: Cyclone</h3>
<p><strong>Cat 4 Tropical Cyclone</strong></p>
<ul>
  <li>210 km/h peak gust swath</li>
  <li>4 coastal health facilities</li>
  <li>Sendai Target C: $4.2M loss</li>
  <li>DELTA record push</li>
  <li>Multi-agency briefing</li>
</ul>
<code>make scenario-cyclone</code>
</div>
</div>

<!--
Speaker Notes:
Every scenario is completely reproducible with a single make command or CLI execution, verifying the full pipeline from raw GeoJSON to Sendai metrics.
-->

---

## 10. Multi-Platform AI Agent Ecosystem

Built to open standards, ensuring seamless adoption across modern AI development environments:

<div class="grid-2">
<div class="card">
<h3 style="color:#38bdf8;">Supported IDEs & Platforms</h3>

* **Google Antigravity**: Full MCP stdio server + custom skills (`antigravity.md`).
* **Cursor IDE**: Stdio MCP tool provider with project rules (`cursor.md`).
* **Claude Code & Desktop**: Native JSON-RPC stdio integration (`claude-code.md`).
* **GitHub Copilot**: VS Code workspace tool integration (`github-copilot.md`).
* **OpenCode CLI**: Terminal-based AI agent harness (`opencode-cli.md`).
</div>

<div class="card">
<h3 style="color:#4ade80;">11 Deterministic MCP Tools</h3>

```json
{
  "drr_gdacs_fetch": "Active global alerts",
  "drr_usgs_earthquake_fetch": "Seismic & PGA estimation",
  "drr_openmeteo_forecast": "Weather & flood triggers",
  "drr_spatial_exposure_join": "Point-in-polygon exposure",
  "drr_fragility_eval": "GEM/HAZUS physical damage",
  "drr_vulnerability_matrix_calc": "Sendai SFM losses",
  "drr_cap_alert_generate_validate": "CAP XML & Briefs",
  "drr_delta_push_draft_record": "DELTA DB sync",
  "drr_delta_fetch_exposure": "Admin boundaries",
  "drr_delta_docs": "Taxonomy & data models",
  "drr_monitor_check": "Declarative alert monitor"
}
```
</div>
</div>

<!--
Speaker Notes:
Because it adheres strictly to the Model Context Protocol, any agent runtime can invoke these tools with zero custom bridging.
-->

---

## 11. Strategic Roadmap for Visual & Operational Excellence

Building the next tier of visual communication and field usability:

<div class="grid-2">
<div class="card">
<h3 style="color:#38bdf8;">Visual & Presentation Enhancements</h3>

* **Interactive SitRep Dashboard**: Instant HTML/Tailwind situation reports with dynamic Leaflet maps and SVG fragility curves.
* **Executive Presentation Generator**: One-click generation of Marp `.pptx` slide decks from any active emergency assessment.
* **Visual Terminal UI**: Colorized ASCII gauges, risk scorecards, and formatted tables for CLI operators.
</div>

<div class="card">
<h3 style="color:#4ade80;">Operational & Analytical Expansions</h3>

* **Local GMPE Ground Motion Models**: Adding regional subduction zone GMPEs (e.g. Boore-Atkinson, Chiou-Youngs).
* **Multi-Hazard Cascades**: Earthquake-triggered landslides and tsunamis modeling.
* **Low-Bandwidth Satellite Sync**: Optimized lightweight binary CAP payload for satellite phones in disaster zones.
</div>
</div>

<!--
Speaker Notes:
Our visual roadmap focuses on ensuring that emergency personnel and executive leadership don't have to decipher raw numbers. Information must be clear, actionable, and visually immediate.
-->

---

<!-- _class: lead -->
# Thank You
### Disaster Risk Reduction (DRR) Agent Plugin

<span class="tag tag-blue">Documentation: /docs</span>
<span class="tag tag-green">Automated Tests: make test</span>
<span class="tag tag-orange">Marp Slide Deck: docs/presentation/</span>

**Repository:** `drr-agent-plugin`  
**License:** Apache 2.0 • Zero External Dependencies  
**Specification:** [agent-plugins.org](https://agent-plugins.org/) • [modelcontextprotocol.io](https://modelcontextprotocol.io/)

<!--
Speaker Notes:
Thank you for your time. We welcome questions, partnerships, and trial deployments with emergency management agencies and humanitarian clusters.
-->
