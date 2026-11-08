---
name: gdacs-feed-ingestion
description: Ingestion and interpretation of GDACS (Global Disaster Alert and Coordination System) active hazard alerts for earthquakes, tropical cyclones, floods, and volcanoes. Use when monitoring global disaster feeds or triggering early warning workflows.
---

# GDACS Feed Ingestion & Alert Scoring

## Overview
The Global Disaster Alert and Coordination System (GDACS) is a joint framework of the United Nations (UN OCHA) and the European Commission (DG ECHO). This skill instructs AI agents on interpreting GDACS feeds, understanding alert scores, and extracting geographic footprints for downstream modeling.

---

## 1. GDACS Alert Score Hierarchy

GDACS calculates a multi-factor alert score based on physical event magnitude, vulnerable population density, and country coping capacity (INFORM index):

| Alert Level | GDACS Score | Color Code | Humanitarian & Operational Impact |
| :--- | :--- | :--- | :--- |
| **Red Alert** | $\ge 2.5$ | 🔴 Red | High probability of severe humanitarian crisis; international assistance likely required. |
| **Orange Alert** | $1.5 \le \text{Score} < 2.5$ | 🟠 Orange | Moderate humanitarian impact; national response capacity potentially strained. |
| **Green Alert** | $< 1.5$ | 🟢 Green | Localized impact; expected to be handled by local/municipal civil protection. |

---

## 2. Supported Hazard Types

* **`EQ` (Earthquake)**: Magnitude ($M_w$), focal depth (km), ShakeMap intensity contours (MMI / PGA).
* **`TC` (Tropical Cyclone)**: Saffir-Simpson category (1-5), wind buffer radii (34kt, 50kt, 64kt), track forecast points.
* **`FL` (Flood)**: Satellite inundation extent, river basin identifier, duration (days).
* **`VO` (Volcano)**: Volcanic Explosivity Index (VEI), aviation color code, ash plume height.
* **`DR` (Drought)**: SPEI / NDVI agricultural anomalies.

---

## 3. Workflow for AI Agents

1. When a user asks for active global alerts, or alerts for a specific country or hazard type:
   - Call the MCP tool `drr_gdacs_fetch` with optional parameters (`minAlertLevel`, `eventType`, `country`).
2. If working in an offline or sandboxed environment:
   - Supply the `samplePayload` parameter with local test GeoJSON.
3. Extract the geographic coordinates and event metadata.
4. Pass the event location or footprint polygon directly to `drr_spatial_exposure_join` to initiate hazard exposure modeling.
