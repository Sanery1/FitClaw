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
export MOM_LLM_PROVIDER=deepseek
export MOM_LLM_MODEL=deepseek-v4-pro
export MOM_LLM_API_KEY=sk-xxxxxxxx
export MOM_LLM_BASE_URL=https://api.deepseek.com
export MOM_LLM_API_TYPE=openai-completions

fitclaw-coach ./data
```

Docker remains the recommended deployment path:

```bash
cp .env.example .env
docker compose up -d --build
```

Docker Compose runs Skill commands in a separate `fitclaw-skill-runner`
container. The Runner has `network_mode: none`, a read-only workspace mount,
no Bot credentials, and communicates with the Bot only through a mode-`0600`
Unix socket. Command execution fails closed when the Runner is unavailable.

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
- `src/runtime/session.ts`: model/auth selection and shared managed-session assembly
- `src/runtime/events.ts`: Agent/session events translated into Bot responses
- `src/skill-runner.ts`: isolated Skill command server and manifest revalidation
- `src/runtime/skill-runner-client.ts`: Unix socket client used by the Coach executor
- `src/adapters/feishu/`: Feishu transport and rendering
- `src/tools/`: sandboxed file and shell tools
- `src/store.ts`: channel logs and persisted conversation state

Durable fitness facts must use Skill-declared data namespaces. Conversation
history is session context, not a second fitness database.

The `attach` tool can send images or files only from currently loaded Skill
directories. Requested paths and final realpaths are both checked before file
bytes are passed to the Feishu media upload API.

Skills that execute local scripts must declare `permissions.network: false`
and an explicit `permissions.commands.allow` prefix. Network-enabled Skill
commands are not supported.
