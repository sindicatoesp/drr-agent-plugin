# Configuration & Environment Settings Guide

This guide details all configuration options, environment variables, network proxy settings, and client-specific parameters for the **DRR Analytics Agent Plugin**.

---

## 1. Configuration Precedence & Discovery

The plugin automatically resolves configuration values in the following order of precedence:

1. **System Environment Variables** (highest precedence, e.g. `export GDACS_FEED_URL=...`)
2. **Explicit `.env` File** specified via `DRR_ENV_FILE=/path/to/.env`
3. **Workspace Root `.env`** (`.env` in current working directory)
4. **Plugin Root `.env`** (`drr-agent-plugin/.env`)
5. **Internal Defaults** (lowest precedence)

A template configuration is provided in [`drr-agent-plugin/.env.example`](../.env.example).

---

## 2. Complete Environment Variables Reference

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| **`GDACS_FEED_URL`** | `https://www.gdacs.org/datareport/resources/GDACS_events.geojson` | Endpoint for the UN OCHA / DG ECHO global disaster alert GeoJSON feed. Override to use an internal proxy or mirror. |
| **`USGS_API_URL`** | `https://earthquake.usgs.gov/fdsnws/event/1/query` | Base URL for the USGS Earthquake Hazards FDSN-WS event API. |
| **`USGS_MIN_MAGNITUDE`**| `4.5` | Default minimum magnitude threshold when querying seismic events without an explicit parameter. |
| **`USGS_DEFAULT_LIMIT`**| `20` | Maximum number of seismic events to return per query. |
| **`OPENMETEO_API_URL`** | `https://api.open-meteo.com/v1/forecast` | Open-Meteo endpoint for numerical weather prediction. Automatically switches to `customer-api.open-meteo.com` when `OPENMETEO_API_KEY` is provided. |
| **`OPENMETEO_API_KEY`** | *None (empty)* | Optional commercial API key for high-frequency or SLA-backed Open-Meteo queries. |
| **`DELTA_API_URL`** | `http://localhost:3000/en/api/mcp` | Target endpoint for connecting to DELTA Resilience core application MCP server. |
| **`DELTA_MCP_API_KEY`** | *None (empty)* | Secret API token passed in `X-Auth` header to authenticate against DELTA's database. |
| **`TARGET_COUNTRIES`** | `*` (all) | Comma-separated list of target country names or ISO-2/3 codes (e.g. `Indonesia,ID,IDN`). Foreign events are excluded from DELTA push. |
| **`DELTA_COUNTRY`** | *None* | Explicit single country name for the national DELTA instance (e.g. `Vanuatu`). |
| **`DELTA_COUNTRY_STRICT`**| `true` | When true, strictly gates all DELTA disaster record pushes so only events matching `TARGET_COUNTRIES` or `DELTA_COUNTRY` are saved. |
| **`MONITOR_WEBHOOK_URL`**| *None (empty)* | Universal incoming webhook URL (Slack, Microsoft Teams, Discord, Mattermost) to dispatch alert payloads when thresholds trigger. |
| **`ALERTS_CONFIG_PATH`** | `alerts-config.json` | Path to declarative JSON monitoring rules file. |
| **`MONITOR_INTERVAL_SEC`** | `60` | Polling interval in seconds when running `drr-tool monitor` daemon. |
| **`HTTP_PROXY`** | *None* | HTTP proxy URL for enterprise, government, or UN agency firewalls (e.g. `http://proxy.agency.org:8080`). |
| **`HTTPS_PROXY`** | *None* | HTTPS proxy URL for secure outbound connections. |
| **`NO_PROXY`** | *None* | Comma-separated list of hostnames/IPs to bypass the proxy (e.g. `localhost,127.0.0.1`). |
| **`DRR_REQUEST_TIMEOUT_MS`** | `8000` | Network request timeout in milliseconds. |
| **`DRR_USER_AGENT`** | `UNDRR-DRR-Agent-Plugin/1.3` | User-Agent string sent with outgoing scientific data requests. |
| **`DRR_OFFLINE_MODE`** | `false` | When set to `true`, blocks all outgoing network calls and requires offline sample payloads (ideal for air-gapped EOCs and secure sandboxes). |

---

## 3. Platform-Specific Configuration

When running the MCP server within different AI assistants, configure environment variables in their respective configuration files:

### Google Antigravity (`~/.gemini/config/mcp_config.json` or `.agents/plugins/`)
Pass environment variables in the `env` object:
```json
{
  "mcpServers": {
    "drr-analytics": {
      "command": "node",
      "args": ["drr-agent-plugin/bin/mcp-server.js"],
      "env": {
        "USGS_MIN_MAGNITUDE": "5.0",
        "DRR_REQUEST_TIMEOUT_MS": "10000",
        "HTTP_PROXY": "http://proxy.undrr.org:8080"
      }
    }
  }
}
```

### Cursor IDE (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "drr-analytics": {
      "command": "node",
      "args": ["/path/to/drr-agent-plugin/bin/mcp-server.js"],
      "env": {
        "GDACS_FEED_URL": "https://internal-cache.org/gdacs.geojson",
        "DELTA_MCP_API_KEY": "${env:DELTA_MCP_API_KEY}"
      }
    }
  }
}
```

### Claude Code CLI & Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "drr-analytics": {
      "command": "node",
      "args": ["/path/to/drr-agent-plugin/bin/mcp-server.js"],
      "env": {
        "DRR_OFFLINE_MODE": "false",
        "DRR_REQUEST_TIMEOUT_MS": "12000"
      }
    }
  }
}
```

### OpenCode (`opencode.json`)
```json
{
  "mcp": {
    "drr-analytics": {
      "type": "local",
      "command": "node",
      "args": ["drr-agent-plugin/bin/mcp-server.js"],
      "env": {
        "USGS_MIN_MAGNITUDE": "5.0"
      },
      "enabled": true
    }
  }
}
```

---

## 4. Operational Deployment Patterns

### Pattern A: Enterprise / UN Agency Firewalled Proxy
In UN duty stations or government operations centers, outbound connections to external APIs must pass through an authenticated proxy:

```bash
export HTTP_PROXY="http://proxy.agency.org:8080"
export HTTPS_PROXY="http://proxy.agency.org:8080"
export NO_PROXY="localhost,127.0.0.1,.internal.net"
```

### Pattern B: Air-Gapped or Secure Sandboxed EOC
For mission-critical emergency centers operating in air-gapped environments without external internet access:

1. Enable offline mode in `.env`:
   ```bash
   DRR_OFFLINE_MODE=true
   ```
2. Pass offline GeoJSON fixtures via the `samplePayload` parameter in `drr_gdacs_fetch`, `drr_usgs_earthquake_fetch`, and `drr_openmeteo_forecast`.
3. Spatial joins (`drr_spatial_exposure_join`), fragility modeling (`drr_fragility_eval`), and CAP generation (`drr_cap_alert_generate_validate`) run completely locally without network access.

### Pattern C: Integration with Core DELTA Resilience
To connect the plugin with a running DELTA instance:

1. Generate an API Key in DELTA (`Settings > API Keys`).
2. Set in `.env`:
   ```bash
   DELTA_API_URL="http://localhost:3000/en/api/mcp"
   DELTA_MCP_API_KEY="your-secret-api-key-here"
   ```

### Pattern D: Autonomous Early Warning Monitoring Daemon
Run continuous feed polling against custom threshold rules:

1. Quick configuration initialization via Makefile:
   ```bash
   make config-init
   ```
   Or manually copy and adapt the declarative alert rules:
   ```bash
   cp alerts-config.example.json alerts-config.json
   ```
2. Configure webhook and DELTA push targets:
   ```json
   {
     "rules": [
       {
         "id": "seismic-eoc-threshold",
         "type": "earthquake",
         "enabled": true,
         "minMagnitude": 5.5,
         "minEstimatedPgaG": 0.15,
         "exposureFile": "examples/earthquake-hazus-scenario/input-exposure.json",
         "fragilityTaxonomies": ["URM", "C1_PRE_CODE"],
         "actions": {
           "generateCapXml": true,
           "pushDeltaDraft": true,
           "dispatchWebhook": true
         }
       }
     ],
     "outputs": {
       "alertsDir": "alerts",
       "webhookUrl": "https://hooks.slack.com/services/T00/B00/XXXXX"
     }
   }
   ```
3. Run the daemon locally:
   ```bash
   make monitor INTERVAL=60
   ```
   Or run as a lightweight Docker Compose background daemon:
   ```bash
   make docker-up
   make docker-logs
   ```

### Pattern E: Makefile Configuration Shortcuts Reference

| Command | Action |
| :--- | :--- |
| `make config-init` | Generates `.env` and `alerts-config.json` from templates if not present. |
| `make config-check` | Validates environment variables, active API URLs, and JSON rules syntax. |
| `make config-show` | Displays current active configuration while masking confidential secrets. |
| `make alerts-validate` | Verifies declarative threshold rule count and structure. |
| `make clean-alerts` | Removes temporary generated CAP XMLs and alert artifacts from `alerts/`. |

---

## 5. National Country Scoping & DELTA Push Guard

DELTA Resilience is designed for national and sub-national disaster loss recording instances (e.g. BNPB Indonesia, NDRRMC Philippines, Vanuatu NDMO). By default, feeding global disaster alerts directly into DELTA could pollute a national database with foreign events.

The DRR Agent Plugin solves this with a **Two-Tier Country Scoping System**:

### Tier 1: Declarative Rules in `alerts-config.json`
Configure the `countryFilter` block at the root of `alerts-config.json`:

```json
{
  "countryFilter": {
    "enabled": true,
    "targetCountries": ["Indonesia", "ID", "IDN"],
    "bbox": [95.0, -11.0, 141.0, 6.0],
    "filterFeeds": false,
    "strictDeltaPush": true
  }
}
```

* **`targetCountries`**: Array of country names, ISO-2, or ISO-3 codes. Matches `event.country`, USGS `event.place` (e.g. `"12 km SW of Palu, Indonesia"`), and GDACS properties.
* **`bbox`** *(Optional)*: `[minLon, minLat, maxLon, maxLat]`. If an event has coordinates falling inside this bounding box, it qualifies regardless of country name variations.
* **`filterFeeds`**:
  * `false` *(Default)*: Allows global feeds (USGS, GDACS) to generate emergency CAP XMLs and webhook notifications, but **blocks foreign events from being saved to DELTA**.
  * `true`: Filters the entire monitoring feed at the source so only events inside the target country trigger any alert.
* **`strictDeltaPush`**:
  * `true` *(Default)*: Enforces that `pushDraftDisasterRecord` will **skip foreign events** with `reason: "country_mismatch"`.

### Tier 2: Environment Variables (`.env`)
You can configure country scoping in `.env` without modifying JSON files:

```bash
# Scope to single or multiple national territories:
TARGET_COUNTRIES="Indonesia,ID,IDN"
DELTA_COUNTRY="Indonesia"

# Strictly prevent foreign events from pushing into DELTA:
DELTA_COUNTRY_STRICT=true
```

When an event from outside the target country is evaluated, the plugin logs:
```text
[DELTA Country Filter] Skipped pushing event "Offshore Maule, Chile":
Country "Chile" does not match national DELTA instance ["Indonesia", "ID", "IDN"].
```
