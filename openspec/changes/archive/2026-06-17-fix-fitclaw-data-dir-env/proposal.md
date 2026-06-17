## Why

Mom and the SDK set `FITCLAW_DATA_DIR` to `<session>/sport-data`, while `fitclaw-data` passes that value to `FileSportDataStore`, which itself writes under `<dataDir>/sport-data`. Scripts using the CLI can therefore read/write `<session>/sport-data/sport-data/...`, diverging from the `data_<skill>_read/write` tools used by the agent.

## What Changes

- Set `FITCLAW_DATA_DIR` to the same root directory passed to `FileSportDataStore`.
- Keep Agent data tools and `fitclaw-data` CLI pointed at the same `sport-data/<skill>/<namespace>.json` files.
- Add regression coverage for the environment variable contract.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `fitness-memory-contract`: Skill data CLI access must share the same storage root as Agent data tools.

## Impact

- Affected code: `packages/coding-agent/src/core/sdk.ts`, `packages/mom/src/agent.ts`
- Affected tests: `packages/coding-agent/test/sport-data-store.test.ts`
- No dependency, public API, or data format changes.
