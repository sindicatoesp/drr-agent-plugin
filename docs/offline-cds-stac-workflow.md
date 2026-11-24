# Offline Copernicus CDS / ERA5 → STAC & Raster Zonal Stats Workflow

This guide explains how to connect heavy scientific climate archives—such as the **Copernicus Climate Data Store (CDS)** (`ERA5`, `ERA5-Land`, `GloFAS`, `CMIP6`)—to **`drr-agent-plugin`** without breaking the plugin's zero-dependency Node.js architecture or hitting CDS's asynchronous batch-queue latency during live EOC/agent sessions.

---

## 1. Architecture Boundary: Why Offline Preprocessing?

Copernicus CDS is an **asynchronous batch archive** returning binary **NetCDF4 / GRIB** files that typically require Python scientific libraries (`xarray`, `netCDF4`, `metpy`, `pywbgt`) and minutes-to-hours of queue wait time.

Instead of wiring a live CDS MCP tool into `bin/mcp-server.js`, use the **file-based STAC / `rasterGrid` JSON handoff**:

```text
[Copernicus CDS / ERA5 NetCDF]
        │  (Offline Python / R / QGIS script)
        ▼
[Compact STAC 1.0.0 + rasterGrid JSON (~15–100 KB)]
        │  (Zero-dependency deterministic ingestion)
        ▼
[drr-agent-plugin: drr_raster_zonal_stats / drr_humanitarian_severity_assess / drr_assessment_replay_validate]
```

This keeps `drr-agent-plugin` fast, air-gap/offline capable, and **0-dependency** while preserving full numerical precision from peer-reviewed physical models (e.g., Liljegren et al. 2008 outdoor WBGT).

---

## 2. One-Time Environment Setup (Python / CDS Side)

1. **Create a Copernicus CDS account & accept dataset terms** at [cds.climate.copernicus.eu](https://cds.climate.copernicus.eu/) (e.g., *ERA5 hourly data on single levels from 1940 to present*).
2. **Configure `~/.cdsapirc`** with your personal CDS API URL and key (never commit this file to git).
3. **Install the offline Python stack** (outside `drr-agent-plugin`):
   ```bash
   pip install cdsapi xarray netCDF4 numpy pandas
   # Optional for physical WBGT heat-stress modeling:
   pip install pywbgt metpy matplotlib regionmask
   ```

---

## 3. Exact `rasterGrid` JSON Contract & Common Pitfalls

[`computeRasterZonalStats`](../lib/spatial.js) (`drr_raster_zonal_stats`) expects a deterministic JSON grid with these fields:

```json
{
  "crs": "EPSG:4326",
  "valueSemantics": "continuous",
  "unit": "degC",
  "statistic": "monthly_max",
  "bbox": [119.375, 11.875, 124.625, 19.625],
  "width": 21,
  "height": 31,
  "nodata": -9999,
  "rowOrder": "top_to_bottom",
  "values": [
    [32.14, 32.45, "..."]
  ]
}
```

### Four Technical Details You Must Get Right
1. **Cell-edge `bbox` (not cell-center):**
   ERA5 NetCDF coordinates (`latitude`, `longitude`) are **cell centers** (typically `0.25°` spacing). Always expand by half a grid step so polygons align cleanly with pixel edges:
   `[lon.min() - dlon/2, lat.min() - dlat/2, lon.max() + dlon/2, lat.max() + dlat/2]`.
2. **Latitude orientation (`rowOrder`):**
   Sort latitude **descending** (North → South) and longitude **ascending** (West → East), then set `"rowOrder": "top_to_bottom"` (row `0` = `maxLat`, matching GeoTIFF convention).
3. **Choose the right `valueSemantics`:**
   * `"continuous"` — Temperatures (`°C`, WBGT), flood depth (`m`), PGA (`g`), wind speed (`km/h`). `drr_raster_zonal_stats` computes `mean`/`min`/`max` and **refuses to sum cells** (`integratedTotal: null`).
   * `"count"` — Per-cell population counts (summed across intersected cells).
   * `"density_per_sqkm"` — Density rasters (integrated by geodesic cell area in $\text{km}^2$).
4. **Cast `float32` → `float64` before rounding:**
   NetCDF arrays are often `float32`. Call `np.round(arr.astype("float64"), 2)` before `.tolist()` so JSON values serialize cleanly (e.g., `34.52` instead of `34.52000045776367`).

---

## 4. Drop-In Python Exporter (Any `xarray.DataArray`)

Use this helper in any ERA5 / GloFAS / CMIP6 script to export both a **STAC 1.0.0 Feature** (with metadata and links to `.nc` / `.gif`) and a standalone **`rasterGrid` JSON** file:

```python
import json
import numpy as np
import pandas as pd

def export_drr_raster_snapshot(da_2d, out_raster_json, out_stac_json=None, *,
                               event_id="ERA5-GRID", title="ERA5 Hazard Grid",
                               unit="degC", semantics="continuous", statistic="monthly_max",
                               timestamp_utc="2024-04-29T05:00:00Z", media_href=None, nc_href=None):
    lat_dim = "latitude" if "latitude" in da_2d.coords else "lat"
    lon_dim = "longitude" if "longitude" in da_2d.coords else "lon"
    da = da_2d.sortby(lat_dim, ascending=False).sortby(lon_dim, ascending=True)

    lats, lons = da[lat_dim].values, da[lon_dim].values
    dlat = abs(float(lats[1] - lats[0])) if lats.size > 1 else 0.25
    dlon = abs(float(lons[1] - lons[0])) if lons.size > 1 else 0.25
    bbox = [
        round(float(lons.min() - dlon / 2), 6),
        round(float(lats.min() - dlat / 2), 6),
        round(float(lons.max() + dlon / 2), 6),
        round(float(lats.max() + dlat / 2), 6),
    ]

    clean = np.where(np.isfinite(da.values), np.round(da.values.astype("float64"), 2), -9999).tolist()
    raster_grid = {
        "crs": "EPSG:4326",
        "valueSemantics": semantics,
        "unit": unit,
        "statistic": statistic,
        "bbox": bbox,
        "width": int(lons.size),
        "height": int(lats.size),
        "nodata": -9999,
        "rowOrder": "top_to_bottom",
        "values": clean,
    }

    with open(out_raster_json, "w", encoding="utf-8") as f:
        json.dump(raster_grid, f, indent=2)

    if out_stac_json:
        stac_item = {
            "type": "Feature",
            "stac_version": "1.0.0",
            "id": event_id,
            "bbox": bbox,
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]]],
            },
            "properties": {
                "title": title,
                "datetime": timestamp_utc,
                "drr:unit": unit,
                "drr:raster_grid": raster_grid,
            },
            "assets": {
                k: v for k, v in {
                    "overview_media": {"href": media_href, "roles": ["overview"]} if media_href else None,
                    "source_netcdf": {"href": nc_href, "type": "application/x-netcdf", "roles": ["data"]} if nc_href else None,
                }.items() if v is not None
            },
        }
        with open(out_stac_json, "w", encoding="utf-8") as f:
            json.dump(stac_item, f, indent=2)
```

For the WBGT workflow (`wbgt_animation.py`), run with `--reuse --stac-only` to export directly from an existing `wbgt_YYYY_MM.nc` without recomputing or re-rendering animations:

```bash
python wbgt_animation.py --indir era5_wbgt --year 2024 --month 4 --reuse --stac-only
```

---

## 5. Applying the Snapshot in `drr-agent-plugin`

### A. Run Zonal Statistics via CLI
Compute deterministic per-province / per-municipality WBGT (or rainfall / flood-depth) statistics against any COD-AB GeoJSON polygon:

```bash
node bin/cli.js raster-zonal-stats \
  --raster wbgt_output/wbgt_outdoor_2024_04_raster.json \
  --zone path/to/luzon-cod-ab.geojson
```

### B. Verify the Built-In April 2024 Luzon ERA5 WBGT L3 Replay
The repository includes a frozen Copernicus C3S ERA5 April 2024 Luzon WBGT validation fixture in [`tests/validation/era5-luzon-wbgt-2024-04.json`](../tests/validation/era5-luzon-wbgt-2024-04.json), verified in CI by `hindcast_era5_luzon_wbgt_heatwave_2024`:

```bash
node bin/cli.js replay-validate --suite hindcast_benchmark
```

This checks:
* Continuous-raster governance (`integratedTotal === null`, `rawCellSum === null`)
* Lowland extreme-heat exceedance (`>= 32.0 °C` outdoor WBGT, peaking at `36.16 °C` in Cagayan Valley on `2024-04-29T05:00:00Z` / 1:00 PM PHT)
* Outdoor-vs-indoor solar load differential (`>= 3.0 °C`)
* Cordillera highland elevation cooling gradient (`>= 2.0 °C`)
* Humanitarian severity phase (`>= 3`) and deterministic SHA-256 reproducibility

### C. Using with an AI Agent (MCP Workflow)
Prompt your AI assistant to chain the exported snapshot with existing tools:
> *"Using `drr_raster_zonal_stats`, compute peak outdoor and indoor WBGT across our Luzon COD-AB zones from `wbgt_outdoor_2024_04_raster.json` and `wbgt_indoor_2024_04_raster.json`. Flag zones exceeding 32 °C outdoor WBGT, pass the peak corridor to `drr_humanitarian_severity_assess`, and reconcile any PAGASA/DepEd/LGU impact counts using `drr_sitrep_reconcile`."*

---

## 6. Attribution Requirement

Any dataset derived from Copernicus CDS ERA5 must retain the Copernicus C3S license notice in provenance and documentation (see [`CREDITS.md`](../CREDITS.md)):
> *"Contains modified Copernicus Climate Change Service information (YYYY). Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains."*
