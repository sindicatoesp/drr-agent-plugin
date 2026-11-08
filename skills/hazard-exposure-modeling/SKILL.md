---
name: hazard-exposure-modeling
description: Deterministic spatial exposure joins and GEM/HAZUS physical fragility modeling for earthquakes, floods, and tropical cyclones. Use when intersecting hazard footprints with exposed assets or calculating damage state probabilities.
---

# Hazard Exposure Modeling & Physical Fragility

## Overview
This skill guides AI agents in conducting rigorous spatial exposure assessments and structural fragility modeling. It enforces a strict separation between deterministic calculations (delegated to MCP tools) and domain interpretation (synthesizing implications for civil protection and Sendai Framework targets).

---

## 1. Physical Fragility Methodologies

### 1.1 Seismic Fragility (Global Earthquake Model & HAZUS)
Structural damage state probabilities are modeled using lognormal cumulative distribution functions:

$$P(DS \ge ds_i \mid \text{PGA}) = \Phi\left(\frac{\ln(\text{PGA} / \theta_i)}{\beta_i}\right)$$

Where:
* $\text{PGA}$: Peak Ground Acceleration ($g$)
* $\theta_i$: Median capacity parameter for damage state $i$
* $\beta_i$: Total dispersion (lognormal standard deviation)
* $\Phi$: Standard normal cumulative distribution function

#### Supported Building Typologies:
* **`URM`**: Unreinforced Masonry Bearing Walls (High vulnerability, low ductility)
* **`C1_PRE_CODE`**: Non-Ductile Concrete Moment Frame (Pre-modern building codes)
* **`C1_MODERATE_CODE`**: Ductile Concrete Moment Frame (Seismic detailing)
* **`C2`**: Concrete Shear Walls
* **`S1`**: Steel Moment Frame
* **`W1`**: Wood Light Frame (Residential structures)

#### Central Damage Factors (Damage Ratios):
* **None**: 0%
* **Slight**: 5% (Cosmetic cracks, non-structural damage)
* **Moderate**: 25% (Structural yielding, repairable without demolition)
* **Extensive**: 60% (Partial collapse hazard, significant structural repair needed)
* **Complete**: 100% (Total collapse or demolition required)

### 1.2 Flood Inundation & Depth-Damage
Uses FEMA FIA / HAZUS depth-damage curves relating inundation depth above first floor (meters) to structural and content loss ratios.

### 1.3 Tropical Cyclone Wind Damage
Uses Saffir-Simpson intensity thresholds and structural wind loss functions.

---

## 2. Standard Workflow for AI Agents

When requested to evaluate hazard exposure:

1. **Acquire Hazard Footprint**:
   Obtain the GeoJSON polygon representing the hazard zone (e.g., from GDACS feed, ShakeMap contour, or flood polygon).
2. **Execute Deterministic Spatial Join**:
   Call the MCP tool `drr_spatial_exposure_join` with the hazard GeoJSON and exposed asset GeoJSON (hospitals, schools, residential points). **Never estimate spatial intersections by text inspection.**
3. **Run Fragility Modeling**:
   For exposed assets, evaluate structural damage probabilities using `drr_fragility_eval` based on hazard intensity (PGA, flood depth, or wind speed).
4. **Aggregate Exposure & Loss**:
   Call `drr_vulnerability_matrix_calc` to compute Mean Damage Ratios (MDR), displaced populations (Sendai Target B), and direct economic damage (Sendai Target C).
5. **Formulate Findings**:
   Present findings highlighting critical infrastructure (Sendai Target D: healthcare, emergency services) with high damage state probabilities.
