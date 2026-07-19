# FitClaw Coach Bot

The primary FitClaw application: a Feishu-first personal AI fitness coach.

The app owns Feishu transport, card rendering, private user relationships,
per-private-chat sessions, sandboxed tools, and deployment. Coaching behavior
lives in `@fitclaw/coach-core`; Skill discovery and persisted namespaces live in
`@fitclaw/runtime`.

## Run

Configure the existing Bot environment variables:

The `MOM_*` prefix is retained as the current deployment contract. Application
code and user-facing identity use FitClaw Coach terminology.
DeepSeek V4 Pro is the current default selection, not a provider lock-in. The
same fields can select another built-in model or register an API-compatible
custom provider without changing Coach application code.

```bash
export MOM_FEISHU_APP_ID=cli-xxxxxxxx
export MOM_FEISHU_APP_SECRET=xxxxxxxx
export MOM_FEISHU_BOT_NAME=FitClaw
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

At startup, built-in models keep their catalog capabilities, pricing, context,
and compatibility metadata. Unknown provider/model pairs are added to the
runtime model registry with `MOM_LLM_API_KEY` referenced from the environment.
Credentials, model metadata, and the active model selection remain separate
runtime concerns even though `.env` is the deployment entry point.

The Feishu application must subscribe to `im.message.receive_v1`,
`contact.user.created_v3`, and `contact.user.deleted_v3`. It also needs message
sending permission and an application availability scope containing the users
who may receive an invitation.

Docker Compose runs Skill commands in a separate `fitclaw-skill-runner`
container. The Runner has `network_mode: none`, a read-only workspace mount,
no Bot credentials, and communicates with the Bot only through a mode-`0600`
Unix socket. Command execution fails closed when the Runner is unavailable.

## Private Coach Data

FitClaw is one enterprise Bot with a separate private coach relationship for
each `tenant_key + open_id`. New employees receive one private invitation. The
relationship becomes active only after the user replies `开始`; group mentions
only receive a private-chat redirect and never enter the Coach Agent.

```text
tenants/{tenantKey}/users/{openId}/
├── relationship.json
├── sport-data/bodybuilding/*.json
└── sessions/{chatId}/context.jsonl
```

Employee deletion changes the relationship to `revoked`, disables reminders,
and blocks memory access immediately. Physical data retention and deletion are
a separate release-governance policy and are not performed automatically.

## Memory Migration

Legacy private sessions require an administrator-provided mapping. The command
is dry-run by default and copies rather than moves source files:

```json
{
  "version": 1,
  "sessions": [
    {
      "chatId": "oc_private_chat",
      "tenantKey": "tenant_key",
      "openId": "ou_user",
      "kind": "dm"
    },
    {
      "chatId": "oc_group_chat",
      "tenantKey": "tenant_key",
      "openId": "ou_user",
      "kind": "group",
      "legacyPath": "oc_group_chat/ou_user",
      "confirmedPersonalData": false
    }
  ]
}
```

```bash
# Report only
fitclaw-coach migrate-memory ./data --mapping ./mapping.json

# Copy and verify data; object conflicts require an explicit source choice
fitclaw-coach migrate-memory ./data --mapping ./mapping.json --apply --conflict destination

# Preview existing employees, then explicitly send one invitation
fitclaw-coach invite-existing ./data --mapping ./mapping.json
fitclaw-coach invite-existing ./data --mapping ./mapping.json --send
```

Group transcripts are archived under `migration-archive/groups` and are never
merged into private session context. Group-derived structured data is skipped
unless `confirmedPersonalData` is explicitly true.

## Development

From the repository root:

```bash
npm run build --workspace @fitclaw/coach-bot
npm test --workspace @fitclaw/coach-bot
npx tsx apps/coach-bot/src/main.ts ./feishu-workspace
```

Key modules:

- `src/main.ts`: process entrypoint and private-coach wiring
- `src/private-coach-service.ts`: invitation, activation, privacy, and revocation routing
- `src/relationships.ts`: atomic private relationship persistence
- `src/memory-migration.ts`: dry-run-first legacy data migration
- `src/agent.ts`: per-private-session run orchestration
- `src/runtime/skills.ts`: Skill loading and data-tool assembly
- `src/runtime/session.ts`: model/auth selection and shared managed-session assembly
- `src/runtime/events.ts`: Agent/session events translated into Bot responses
- `src/skill-runner.ts`: isolated Skill command server and manifest revalidation
- `src/runtime/skill-runner-client.ts`: Unix socket client used by the Coach executor
- `src/adapters/feishu/`: Feishu transport and rendering
- `src/tools/`: sandboxed file and shell tools

Durable fitness facts must use Skill-declared data namespaces. Conversation
history is session context, not a second fitness database.

The `attach` tool can send images or files only from currently loaded Skill
directories. Requested paths and final realpaths are both checked before file
bytes are passed to the Feishu media upload API.

Skills that execute local scripts must declare `permissions.network: false`
and an explicit `permissions.commands.allow` prefix. Network-enabled Skill
commands are not supported.
