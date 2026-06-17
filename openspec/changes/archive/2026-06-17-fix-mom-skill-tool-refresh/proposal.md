## Why

Mom caches one runner per Feishu channel and reloads Skills on each message, but Skill data tools are only registered when the runner is created. After workspace Skills are added or changed, the refreshed prompt can mention `data_<skill>_read/write` tools that are not actually available to the agent.

## What Changes

- Refresh Mom's active tool list from the currently loaded Skill declarations before each Feishu message run.
- Keep initial runner creation and per-run refresh using the same Skill data tool construction path.
- Add a regression test for adding a Skill data namespace after a runner already exists.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `feishu-fitness-user-loop`: Mom must keep runtime Skill data tool registration aligned with Skills reloaded for the Feishu user loop.

## Impact

- Affected code: `packages/mom/src/agent.ts`
- Affected tests: `packages/mom/test/agent-skill-loading.test.ts`
- No dependency, API, storage format, or deployment changes.
