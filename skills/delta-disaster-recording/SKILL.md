---
name: delta-disaster-recording
description: Two-way synchronization with UNDRR DELTA Resilience. Queries baseline exposure and administrative divisions, and pushes validated post-disaster assessments as Draft records with full Sendai Target B, C, D metrics.
---

# DELTA Resilience Two-Way Synchronization

## Overview
This skill guides AI agents in establishing two-way interoperability with the **UNDRR DELTA Resilience** disaster tracking platform. It enforces audit standards, multi-tenant isolation, and automated draft recording of disaster losses.

---

## 1. Principles of Two-Way Integration

### 1.1 Non-Destructive Ingestion (Draft Status)
The agent must **never** publish or finalize records directly into the operational database. All created records must have:
* `status: "draft"`
* `source: "drr-agent-plugin"`
* An automated audit note detailing timestamp, hazard intensity, and model parameters.

### 1.2 Multi-Tenancy & Scoped Permissions
DELTA requires strict `countryAccountsId` scoping:
* Authenticate using a dedicated service key with `read_write` permissions bound to the designated country account.
* Use `drr_delta_fetch_exposure` to query division boundaries (`division_list`) and verify that asset coordinates match the tenant's administrative territory.

---

## 2. Standard Workflow for AI Agents

1. **Conduct Rapid Assessment**:
   Ingest hazard data (GDACS, USGS, or Open-Meteo), execute `drr_spatial_exposure_join`, and compute `drr_vulnerability_matrix_calc`.
2. **Review Assessment Summary**:
   Confirm that Sendai Framework Target B (displaced population), Target C (direct economic losses), and Target D (critical facilities) metrics are populated.
3. **Execute Draft Ingestion**:
   Call `drr_delta_push_draft_record` passing the assessment object.
4. **Notify Duty Officer**:
   Provide the created draft record ID and link to the DELTA web interface so the national focal point can review, edit, and approve the event.
