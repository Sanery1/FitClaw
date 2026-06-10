# mom — FitClaw Feishu Bot

A Feishu bot powered by an LLM that acts as your AI fitness coach (FitCoach).
Mom connects to Feishu via WebSocket long-connection mode, responds to @mentions in
group chats and direct messages in single chats.

## Features

- **Feishu Integration**: WebSocket long-connection mode, group chat @mention + single chat
- **AI Fitness Coach**: Built-in fitness tools (exercise database, workout tracking, training plans)
- **Self-Managing**: Installs tools, writes scripts, configures credentials autonomously
- **Full Bash Access**: Execute commands, read/write files, automate workflows
- **Docker Sandbox**: Isolate mom in a container (recommended for all use)
- **Persistent Workspace**: All conversation history, files, and tools stored in one directory

## Quick Start

```bash
# Set environment variables
export MOM_FEISHU_APP_ID=cli-xxxxxxxx
export MOM_FEISHU_APP_SECRET=xxxxxxxx
export MOM_FEISHU_BOT_NAME=FitCoach

# Set LLM config
export MOM_LLM_PROVIDER=MiniMax
export MOM_LLM_MODEL=MiniMax-M2.7-highspeed
export MOM_LLM_API_KEY=sk-xxxxxxxx
export MOM_LLM_BASE_URL=https://v2.aicodee.com/v1
export MOM_LLM_API_TYPE=openai-completions

# Run mom
mom ./data
```

Or use `.env` file + Docker:
```bash
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

## CLI Options

```bash
mom [options] <working-directory>

Options:
  --sandbox=host              Run tools on host (not recommended)
  --sandbox=docker:<name>     Run tools in Docker container (recommended)
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MOM_FEISHU_APP_ID` | Feishu app ID (cli-...) |
| `MOM_FEISHU_APP_SECRET` | Feishu app secret |
| `MOM_FEISHU_BOT_NAME` | Bot display name (default: FitCoach) |
| `MOM_LLM_PROVIDER` | LLM provider name |
| `MOM_LLM_MODEL` | LLM model name |
| `MOM_LLM_API_KEY` | LLM API key |
| `MOM_LLM_BASE_URL` | LLM API base URL (optional) |
| `MOM_LLM_API_TYPE` | LLM API type (e.g. openai-completions) |

## Development

### Code Structure

- `src/main.ts` — Entry point, Feishu bot setup, message handler
- `src/agent.ts` — Agent runner, event handling, tool execution, session management
- `src/feishu.ts` — Feishu WebSocket integration, message parsing, deduplication
- `src/context.ts` — Session manager (context.jsonl), log-to-context sync
- `src/store.ts` — Channel data persistence, message logging
- `src/log.ts` — Centralized logging
- `src/sandbox.ts` — Docker/host sandbox execution
- `src/tools/` — Tool implementations (bash, read, write, edit, attach)

### Running in Dev Mode

```bash
# Build
npm run build

# Run mom with auto-restart
cd packages/mom
npx tsx src/main.ts ./data
```

## License

MIT
