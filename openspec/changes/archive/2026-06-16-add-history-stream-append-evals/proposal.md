## Why

`body_metrics`, `progression`, and `personal_records` are defined as append-only history streams, but the skills eval suite currently only protects `training_log` append behavior. Adding deterministic coverage lowers the risk that future memory work accidentally replaces historical data.

## What Changes

- Add a skills eval for appending one body metrics record.
- Add a skills eval for appending one progression record.
- Add a skills eval for appending one personal record.
- Add a memory-contract requirement that history-stream append behavior has deterministic eval coverage.
- Do not change runtime tools, storage, dependencies, or Feishu workflow code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `fitness-memory-contract`: Require deterministic eval coverage for append-only history streams beyond `training_log`.

## Impact

- `packages/coding-agent/evals/tasks/skills/bodybuilding-body-metrics.yaml`
- `packages/coding-agent/evals/tasks/skills/bodybuilding-progression.yaml`
- `packages/coding-agent/evals/tasks/skills/bodybuilding-personal-record.yaml`
- `openspec/changes/add-history-stream-append-evals/*`
