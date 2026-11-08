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
| **`HTTP_PROXY`** | *None* | HTTP proxy URL for enterprise, government, or UN agency firewalls (e.g. `http://proxy.agency.org:8080`). |
| **`HTTPS_PROXY`** | *None* | HTTPS proxy URL for secure outbound connections. |
| **`NO_PROXY`** | *None* | Comma-separated list of hostnames/IPs to bypass the proxy (e.g. `localhost,127.0.0.1`). |
| **`DRR_REQUEST_TIMEOUT_MS`** | `8000` | Network request timeout in milliseconds. |
| **`DRR_USER_AGENT`** | `UNDRR-DRR-Agent-Plugin/1.1` | User-Agent string sent with outgoing scientific data requests. |
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
