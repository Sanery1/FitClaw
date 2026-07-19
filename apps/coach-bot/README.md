# FitClaw Coach Bot

[简体中文](./README.zh-CN.md) | English

The primary FitClaw application: a Feishu-first personal AI fitness coach.

The app owns Feishu transport, card rendering, private user relationships,
per-private-chat sessions, sandboxed tools, and deployment. Coaching behavior
lives in `@fitclaw/coach-core`; Skill discovery and persisted namespaces live in
`@fitclaw/runtime`.

## Run

Run deployment commands from the repository root. Docker is the recommended
path:

```bash
cp .env.example .env
chmod 600 .env
# Fill in the Feishu and model credentials. Never commit or share this file.
docker compose up -d --build
```

The `MOM_*` prefix is retained as the Docker deployment contract. At startup,
the container entrypoint writes `auth.json` and `models.json`; built-in models
keep their catalog metadata, and unknown API-compatible provider/model pairs
are registered from the same fields.

For a local source run, install dependencies and build the workspace first.
Built-in providers use their standard key environment variable; for DeepSeek
that is `DEEPSEEK_API_KEY`. Custom provider registration requires Docker or an
explicit `~/.fitclaw/agent/models.json` and `auth.json` configuration.

```bash
npm install
npm run build --workspace @fitclaw/coach-bot
export MOM_FEISHU_APP_ID=cli-xxxxxxxx
export MOM_FEISHU_APP_SECRET=xxxxxxxx
export MOM_FEISHU_BOT_NAME=FitClaw
export MOM_LLM_PROVIDER=deepseek
export MOM_LLM_MODEL=deepseek-v4-pro
export DEEPSEEK_API_KEY=sk-xxxxxxxx
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach ./data
```

In the Feishu developer console, select long-connection event delivery and
subscribe to `im.message.receive_v1`, `contact.user.created_v3`, and
`contact.user.deleted_v3`. Grant the permissions used to receive and send
messages, upload/download message resources, and receive those contact events.
Publish the application version and include every intended user in the
application availability scope; otherwise invitations or events will fail.

Docker Compose runs Skill commands in a separate `fitclaw-skill-runner`
container. The Runner has `network_mode: none`, a read-only workspace mount,
no Bot credentials, and communicates with the Bot only through a mode-`0600`
Unix socket. Command execution fails closed when the Runner is unavailable.

## Private Coach Data

FitClaw is one enterprise Bot with a separate private coach relationship for
each `tenant_key + open_id`. New employees receive one private invitation. The
relationship becomes active only after the user replies `开始`; group mentions
only receive a private-chat redirect and never enter the Coach Agent.
An active user can send `停用` to withdraw access, then send `开始` later to
consent again. Existing data is retained but remains inaccessible while the
relationship is inactive.

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
is dry-run by default. It never changes or deletes source files, but apply mode
can merge and atomically replace destination files:

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
# Build once before using the workspace command
npm run build --workspace @fitclaw/coach-bot

# Report only; inspect the identity mapping and every warning
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach migrate-memory ./data --mapping ./mapping.json

# Back up the workspace and stop the Bot before apply. The migration does not
# share a write lock with a running conversation session.
docker compose stop fitclaw-bot
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach migrate-memory ./data --mapping ./mapping.json --apply --conflict destination
docker compose start fitclaw-bot

# Preview existing employees, then explicitly send one invitation
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach invite-existing ./data --mapping ./mapping.json
npm exec --workspace @fitclaw/coach-bot -- fitclaw-coach invite-existing ./data --mapping ./mapping.json --send
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
