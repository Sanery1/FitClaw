#!/bin/sh
set -e

# Validate required environment variables
: "${MOM_LLM_PROVIDER:?Missing MOM_LLM_PROVIDER}"
: "${MOM_LLM_MODEL:?Missing MOM_LLM_MODEL}"
: "${MOM_LLM_API_KEY:?Missing MOM_LLM_API_KEY}"
: "${MOM_LLM_BASE_URL:?Missing MOM_LLM_BASE_URL}"
: "${MOM_LLM_API_TYPE:?Missing MOM_LLM_API_TYPE}"

AGENT_DIR="/opt/fitclaw/.fitclaw/agent"
mkdir -p "$AGENT_DIR"

# Generate auth.json using node for safe JSON output (no heredoc injection)
node -e "
JSON.stringify(
  Object.fromEntries([
    [process.env.MOM_LLM_PROVIDER, { type: 'api_key', key: process.env.MOM_LLM_API_KEY }]
  ]),
  null, 2
)
" > "$AGENT_DIR/auth.json"

# Generate models.json with provider override (baseUrl + api + models)
node -e "
JSON.stringify(
  {
    providers: {
      [process.env.MOM_LLM_PROVIDER]: {
        baseUrl: process.env.MOM_LLM_BASE_URL,
        api: process.env.MOM_LLM_API_TYPE,
        models: [{ id: process.env.MOM_LLM_MODEL }]
      }
    }
  },
  null, 2
)
" > "$AGENT_DIR/models.json"

echo "Config files generated: $AGENT_DIR/auth.json, $AGENT_DIR/models.json"
echo "Bot starting..."

exec node /opt/fitclaw/node_modules/@fitclaw/mom/dist/main.js "$@"
