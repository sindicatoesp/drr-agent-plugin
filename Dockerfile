# ==============================================================================
# Disaster Risk Reduction (DRR) Agent Plugin - Lightweight Production Container
# Base: Node.js 22 on Alpine Linux (~130MB total image footprint)
# Dependencies: 0 external npm modules (pure Node.js standard library)
# ==============================================================================

FROM node:22-alpine

# Install bash & ca-certificates for standard test runner and secure outbound SSL
RUN apk add --no-cache bash ca-certificates

# Set operational environment defaults
ENV NODE_ENV=production \
    DRR_OFFLINE_MODE=false \
    ALERTS_CONFIG_PATH=/app/alerts-config.json \
    MONITOR_INTERVAL_SEC=60

WORKDIR /app

# Create alerts directory and adjust permissions for the non-root node user
RUN mkdir -p /app/alerts && chown -R node:node /app

# Copy application files
COPY --chown=node:node package.json plugin.json mcp.json ./
COPY --chown=node:node bin/ ./bin/
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node skills/ ./skills/
COPY --chown=node:node docs/ ./docs/
COPY --chown=node:node examples/ ./examples/
COPY --chown=node:node tests/ ./tests/
COPY --chown=node:node alerts-config.example.json ./
COPY --chown=node:node .env.example ./
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh bin/cli.js bin/mcp-server.js tests/run-all-tests.sh

# Persist alerts and allow mounting external config
VOLUME ["/app/alerts"]

# Switch to non-root user for hardened security
USER node

# Healthcheck verifies configuration resolution and node runtime integrity
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('./lib/config.js'); process.exit(0);" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["monitor", "--interval", "60"]
