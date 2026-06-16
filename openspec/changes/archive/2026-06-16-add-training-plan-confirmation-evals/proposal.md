## Why

The `fitness-memory-contract` already says `training_plan` is the current active plan and must only be replaced after clear user confirmation, but the skills eval suite does not yet protect that boundary. This makes plan suggestions a high-risk place for accidental long-term memory overwrite.

## What Changes

- Add a focused skills eval that suggests a tentative plan adjustment without writing `training_plan`.
- Add a focused skills eval that saves a confirmed plan with `mode: replace` and key plan fields.
- Add a memory-contract requirement that `training_plan` confirmation boundaries have deterministic eval coverage.
- Do not change runtime tools, storage, dependencies, or existing runtime behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `fitness-memory-contract`: Require deterministic eval coverage for tentative plan suggestions and confirmed plan saves.

## Impact

- `packages/coding-agent/evals/tasks/skills/bodybuilding-plan-suggest-no-save.yaml`
- `packages/coding-agent/evals/tasks/skills/bodybuilding-plan-confirmed-replace.yaml`
- `openspec/changes/add-training-plan-confirmation-evals/*`
