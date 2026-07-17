---
change: add-skill-data-schema-validation
status: pass-with-build-limitation
verified-at: 2026-07-18
---

# Verify: Add Optional Skill Data Schema Validation

## Result

PASS for the changed runtime and its direct consumers. The root build remains limited by unrelated live model-catalog generation failures described below.

## Demonstrated Problem

The 2026-07-17 real Feishu smoke saved `training_plan` with `start_date/sessions`, while the established contract and deterministic eval fixtures use `name/goal/days_per_week/days`. Prompt guidance alone therefore did not keep this namespace canonical.

## Decision

- `SKILL.md` data declarations may include an optional JSON Schema for the complete persisted namespace value.
- `replace` validates the replacement value before saving; `append` validates the resulting complete array.
- Invalid writes return up to eight actionable issues and do not mutate persisted data.
- Existing data remains readable and is not automatically migrated.
- Only `training_plan` receives a domain Schema now; no other namespace showed the same live failure.

## Source Basis

| Source | Adapted pattern |
| --- | --- |
| [OpenAI Agents SDK tools](https://openai.github.io/openai-agents-js/guides/tools/) | Tool boundaries use Zod or JSON Schema and reject invalid structured arguments. |
| [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | Structured tool data should conform to declared JSON Schema and validation errors should be actionable. |
| [TypeBox](https://github.com/sinclairzx81/typebox) | Reuse the project's existing JSON Schema runtime and `Schema.Errors`; no new validator dependency. |

## Checks

| Check | Result |
| --- | --- |
| Runtime focused tests | PASS, 40/40 |
| `npm run test` | PASS across all workspaces |
| Skills eval | PASS, 8/8 |
| Session eval | PASS, 23/23 |
| `npm run check` | PASS |
| `@fitclaw/runtime` build | PASS |
| `@fitclaw/claw` build | PASS |
| `@fitclaw/coach-bot` build | PASS |
| Skill sync | PASS; canonical and Bot `bodybuilding/SKILL.md` hashes match |
| `docker compose up -d --build` | PASS; Bot running and Skill Runner healthy |
| Feishu startup | PASS; WebSocket client ready |
| Deployed Schema smoke | PASS; in-memory invalid `start_date/sessions` write returned `schema_validation` with zero saves |
| Root `npm run build` | BLOCKED outside this change: models.dev and OpenRouter returned TLS certificate host mismatches; the partial generated model file was restored before review |

## Not Added

- No database, schema registry service, migration framework, or new dependency.
- No read-time validation or automatic rewrite of existing user data.
- No schemas for namespaces without demonstrated drift.
