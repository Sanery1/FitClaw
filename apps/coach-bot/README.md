# FitClaw Coach Bot

The primary FitClaw application: a Feishu-first personal AI fitness coach.

The app owns Feishu transport, card rendering, per-channel sessions, sandboxed
tools, and deployment. Coaching behavior lives in `@fitclaw/coach-core`; Skill
discovery and persisted namespaces live in `@fitclaw/runtime`.

## Run

Configure the existing Bot environment variables:

The `MOM_*` prefix is retained as the current deployment contract. Application
code and user-facing identity use FitClaw Coach terminology.

```bash
export MOM_FEISHU_APP_ID=cli-xxxxxxxx
export MOM_FEISHU_APP_SECRET=xxxxxxxx
export MOM_FEISHU_BOT_NAME=FitCoach
export MOM_LLM_PROVIDER=minimax
export MOM_LLM_MODEL=MiniMax-M2.7-highspeed
export MOM_LLM_API_KEY=sk-xxxxxxxx
export MOM_LLM_BASE_URL=https://example.com/v1
export MOM_LLM_API_TYPE=openai-completions

fitclaw-coach ./data
```

Docker remains the recommended deployment path:

```bash
cp .env.example .env
docker compose up -d --build
```

## Development

From the repository root:

```bash
npm run build --workspace @fitclaw/coach-bot
npm test --workspace @fitclaw/coach-bot
npx tsx apps/coach-bot/src/main.ts ./feishu-workspace
```

Key modules:

- `src/main.ts`: process entrypoint and message routing
- `src/agent.ts`: per-channel run orchestration
- `src/runtime/skills.ts`: Skill loading and data-tool assembly
- `src/runtime/session.ts`: isolated adapter to the current CLI session stack
- `src/runtime/events.ts`: Agent/session events translated into Bot responses
- `src/adapters/feishu/`: Feishu transport and rendering
- `src/tools/`: sandboxed file and shell tools
- `src/store.ts`: channel logs and persisted conversation state

Durable fitness facts must use Skill-declared data namespaces. Conversation
history is session context, not a second fitness database.
