# ==============================================================================
# Disaster Risk Reduction (DRR) Agent Plugin - Operational & Config Makefile
# ==============================================================================

.DEFAULT_GOAL := help
SHELL         := /bin/sh

# Colors for terminal output
BOLD  := \033[1m
GREEN := \033[32m
CYAN  := \033[36m
YELLOW:= \033[33m
RED   := \033[31m
RESET := \033[0m

# Configurable variables
INTERVAL     ?= 60
CONFIG_FILE  ?= alerts-config.json
MIN_MAG      ?= 5.0
LAT          ?= 23.8
LON          ?= 90.4
DAYS         ?= 5
DOCKER_IMAGE ?= undrr/drr-agent-plugin:latest

.PHONY: help info version \
        config-init config-check config-show alerts-validate \
        test monitor monitor-once mcp usgs forecast \
        scenario-earthquake scenario-flood scenario-cyclone scenarios \
        clean-alerts \
        docker-build docker-up docker-down docker-restart docker-status \
        docker-logs docker-test docker-once docker-shell

# ------------------------------------------------------------------------------
# 1. Help & Information
# ------------------------------------------------------------------------------

help: ## Show this help message with all operational shortcuts
	@printf "$(BOLD)Disaster Risk Reduction (DRR) Agent Plugin - Operational Shortcuts$(RESET)\n"
	@printf "$(CYAN)Standard: agent-plugins.org v1.0.0 | Runtime: Node.js (0 external npm deps)$(RESET)\n\n"
	@printf "$(BOLD)Usage:$(RESET) make [target] [VARIABLE=value]\n\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(RESET) %s\n", $$1, $$2}'

info: ## Show runtime versions, git commit, and manifest metadata
	@printf "$(BOLD)Plugin Manifest:$(RESET)\n"
	@node -e "const p = require('./plugin.json'); console.log('  Name:        ' + p.name + ' (v' + p.version + ')'); console.log('  Description: ' + p.description);"
	@printf "\n$(BOLD)Environment:$(RESET)\n"
	@printf "  Node.js:     %s\n" "$$(node -v 2>/dev/null || echo 'Not installed')"
	@printf "  Git Commit:  %s\n" "$$(git rev-parse --short HEAD 2>/dev/null || echo 'No git repo')"
	@printf "  Alerts Dir:  %s\n" "$$(test -d alerts && ls alerts | wc -l || echo '0') files in alerts/"

version: info ## Alias for info

# ------------------------------------------------------------------------------
# 2. Configuration Shortcuts
# ------------------------------------------------------------------------------

config-init: ## Initialize .env and alerts-config.json from templates if not present
	@printf "$(CYAN)Initializing configuration files...$(RESET)\n"
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		printf "  $(GREEN)Created .env from .env.example$(RESET)\n"; \
	else \
		printf "  $(YELLOW).env already exists, skipping.$(RESET)\n"; \
	fi
	@if [ ! -f alerts-config.json ]; then \
		cp alerts-config.example.json alerts-config.json; \
		printf "  $(GREEN)Created alerts-config.json from alerts-config.example.json$(RESET)\n"; \
	else \
		printf "  $(YELLOW)alerts-config.json already exists, skipping.$(RESET)\n"; \
	fi
	@mkdir -p alerts
	@printf "  $(GREEN)Ensured alerts/ directory exists.$(RESET)\n"
	@printf "$(BOLD)Initialization complete.$(RESET) Edit .env or alerts-config.json to customize settings.\n"

config-check: ## Validate syntax and integrity of .env and alerts-config.json
	@printf "$(CYAN)Checking configuration integrity...$(RESET)\n"
	@node -e "\
		const { CONFIG } = require('./lib/config.js'); \
		console.log('  \x1b[32m✓\x1b[0m Config module loaded successfully.'); \
		console.log('  \x1b[32m✓\x1b[0m USGS API: ' + CONFIG.USGS_API_URL); \
		console.log('  \x1b[32m✓\x1b[0m GDACS Feed: ' + CONFIG.GDACS_FEED_URL); \
		console.log('  \x1b[32m✓\x1b[0m Open-Meteo: ' + CONFIG.OPENMETEO_API_URL); \
		console.log('  \x1b[32m✓\x1b[0m DELTA MCP API: ' + CONFIG.DELTA_API_URL); \
		console.log('  \x1b[32m✓\x1b[0m Target Country Scope: ' + (CONFIG.TARGET_COUNTRIES.join(', '))); \
		console.log('  \x1b[32m✓\x1b[0m Strict DELTA Country Push: ' + CONFIG.DELTA_COUNTRY_STRICT); \
		console.log('  \x1b[32m✓\x1b[0m Offline Mode: ' + CONFIG.DRR_OFFLINE_MODE); \
	"
	@if [ -f alerts-config.json ]; then \
		node -e "\
			const c = JSON.parse(require('fs').readFileSync('alerts-config.json', 'utf8')); \
			const count = c.rules ? (Array.isArray(c.rules) ? c.rules.length : Object.keys(c.rules).length) : 0; \
			console.log('  \x1b[32m✓\x1b[0m alerts-config.json is valid JSON (' + count + ' rules declared).'); \
		"; \
	elif [ -f alerts-config.example.json ]; then \
		node -e "\
			const c = JSON.parse(require('fs').readFileSync('alerts-config.example.json', 'utf8')); \
			const count = c.rules ? (Array.isArray(c.rules) ? c.rules.length : Object.keys(c.rules).length) : 0; \
			console.log('  \x1b[33m!\x1b[0m alerts-config.json missing; using alerts-config.example.json (' + count + ' rules).'); \
		"; \
	fi

config-show: ## Display active configuration settings (masking secrets)
	@node -e "\
		const { CONFIG } = require('./lib/config.js'); \
		console.log('\x1b[1mActive Configuration Settings:\x1b[0m'); \
		console.log('  TARGET_COUNTRIES:       ' + CONFIG.TARGET_COUNTRIES.join(', ')); \
		console.log('  DELTA_COUNTRY:          ' + (CONFIG.DELTA_COUNTRY || '[NONE]')); \
		console.log('  DELTA_COUNTRY_STRICT:   ' + CONFIG.DELTA_COUNTRY_STRICT); \
		console.log('  USGS_MIN_MAGNITUDE:     ' + CONFIG.USGS_MIN_MAGNITUDE); \
		console.log('  DRR_REQUEST_TIMEOUT_MS: ' + CONFIG.REQUEST_TIMEOUT_MS); \
		console.log('  DRR_OFFLINE_MODE:       ' + CONFIG.DRR_OFFLINE_MODE); \
		console.log('  MONITOR_WEBHOOK_URL:    ' + (CONFIG.MONITOR_WEBHOOK_URL ? '[CONFIGURED]' : '[NONE]')); \
		console.log('  DELTA_MCP_API_KEY:      ' + (CONFIG.DELTA_MCP_API_KEY ? '****' + CONFIG.DELTA_MCP_API_KEY.slice(-4) : '[NONE]')); \
		console.log('  HTTP_PROXY:             ' + (CONFIG.HTTP_PROXY || '[NONE]')); \
	"

alerts-validate: ## Validate declarative alert rules in alerts-config.json
	@node -e "\
		const fs = require('fs'); \
		const file = fs.existsSync('alerts-config.json') ? 'alerts-config.json' : 'alerts-config.example.json'; \
		const c = JSON.parse(fs.readFileSync(file, 'utf8')); \
		if (!c.rules || typeof c.rules !== 'object') throw new Error('rules must be an object or array'); \
		const count = Array.isArray(c.rules) ? c.rules.length : Object.keys(c.rules).length; \
		console.log('\x1b[32m✓\x1b[0m ' + file + ' passed validation: ' + count + ' active rule(s).'); \
	"

# ------------------------------------------------------------------------------
# 3. Local Operational Shortcuts
# ------------------------------------------------------------------------------

test: ## Run the complete 10-suite unit and MCP test suite
	@bash tests/run-all-tests.sh

monitor: ## Run the autonomous early warning daemon (INTERVAL=60)
	@mkdir -p alerts
	node bin/cli.js monitor --interval $(INTERVAL) --config $$(test -f $(CONFIG_FILE) && echo $(CONFIG_FILE) || echo alerts-config.example.json)

monitor-once: ## Run a single-scan alert feed evaluation check
	node bin/cli.js monitor --once --config $$(test -f $(CONFIG_FILE) && echo $(CONFIG_FILE) || echo alerts-config.example.json)

mcp: ## Start the JSON-RPC 2.0 stdio Model Context Protocol server
	node bin/mcp-server.js

usgs: ## Fetch real-time USGS earthquakes (MIN_MAG=5.0)
	node bin/cli.js usgs --min-mag $(MIN_MAG)

forecast: ## Fetch Open-Meteo flood anticipatory forecast (LAT=23.8 LON=90.4 DAYS=5)
	node bin/cli.js forecast --lat $(LAT) --lon $(LON) --days $(DAYS)

scenario-earthquake: ## Run full HAZUS MMI-to-PGA + CAP XML earthquake pipeline
	@bash examples/earthquake-hazus-scenario/run.sh

scenario-flood: ## Run full GDACS flood spatial exposure pipeline
	@bash examples/flood-gdacs-exposure/run.sh

scenario-cyclone: ## Run full cyclone wind speed & situation brief pipeline
	@bash examples/cyclone-emergency-brief/run.sh

scenarios: scenario-earthquake scenario-flood scenario-cyclone ## Run all three real-world scenario pipelines

clean-alerts: ## Remove generated CAP alert XMLs and reports from alerts/
	@rm -rf alerts/*.xml alerts/*.json alerts/*.md
	@printf "$(GREEN)Cleaned generated files from alerts/$(RESET)\n"

# ------------------------------------------------------------------------------
# 4. Docker Container Shortcuts (Lightweight Alpine Image)
# ------------------------------------------------------------------------------

docker-build: ## Build the lightweight Docker image (undrr/drr-agent-plugin:latest)
	docker compose build

docker-up: ## Start the autonomous monitoring daemon in the background
	@mkdir -p alerts
	docker compose up -d drr-monitor

docker-start: docker-up ## Alias for docker-up

docker-down: ## Stop the running monitoring daemon and containers
	docker compose down

docker-stop: docker-down ## Alias for docker-down

docker-restart: ## Restart the monitoring daemon container
	docker compose restart drr-monitor

docker-status: ## Show running container status and health
	docker compose ps

docker-ps: docker-status ## Alias for docker-status

docker-logs: ## Follow live logs from the monitoring daemon container
	docker compose logs -f drr-monitor

docker-test: ## Run the full 10-suite test runner inside the Alpine container
	docker compose run --rm drr-cli test

docker-once: ## Run a single monitor scan inside the Alpine container
	docker compose run --rm drr-cli monitor --once

docker-shell: ## Open an interactive shell inside the Alpine container
	docker compose run --rm drr-cli sh
