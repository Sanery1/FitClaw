#!/bin/sh
set -e

if [ "${1:-}" = "knowledge" ]; then
  exec node /opt/fitclaw/node_modules/@fitclaw/coach-bot/dist/main.js "$@"
fi

# Validate required environment variables
: "${MOM_LLM_PROVIDER:?Missing MOM_LLM_PROVIDER}"
: "${MOM_LLM_MODEL:?Missing MOM_LLM_MODEL}"
: "${MOM_LLM_API_KEY:?Missing MOM_LLM_API_KEY}"
: "${MOM_LLM_BASE_URL:?Missing MOM_LLM_BASE_URL}"
: "${MOM_LLM_API_TYPE:?Missing MOM_LLM_API_TYPE}"

AGENT_DIR="/opt/fitclaw/.fitclaw/agent"
mkdir -p "$AGENT_DIR"

# Generate auth.json using node for safe JSON output (no heredoc injection)
node -p "
JSON.stringify(
  Object.fromEntries([
    [process.env.MOM_LLM_PROVIDER, { type: 'api_key', key: process.env.MOM_LLM_API_KEY }]
  ]),
  null, 2
)
" > "$AGENT_DIR/auth.json"

# Preserve built-in metadata while still registering unknown providers/models.
node /opt/fitclaw/node_modules/@fitclaw/coach-bot/dist/deployment-model-config-main.js > "$AGENT_DIR/models.json"

echo "Config files generated: $AGENT_DIR/auth.json, $AGENT_DIR/models.json"
echo "Bot starting..."

exec node /opt/fitclaw/node_modules/@fitclaw/coach-bot/dist/main.js "$@"
