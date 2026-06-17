## Why

The captured Feishu training-summary eval seeds `training_log` data but currently requires zero tool calls. That lets the eval pass even when the assistant summarizes seeded memory without exercising the required `data_bodybuilding_read("training_log")` path.

## What Changes

- Update the captured training-summary eval so it requires reading `training_log` before answering.
- Keep the eval write-safe by continuing to forbid `data_bodybuilding_write`.
- Verify the change with a red/green focused eval run and the session suite.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `feishu-fitness-user-loop`: Captured Feishu training-summary evals with seeded saved records must verify the saved-log read before answering.

## Impact

- Affected eval: `packages/coding-agent/evals/tasks/session/feishu-2026-05-08-training-summary.yaml`
- Affected spec: `openspec/specs/feishu-fitness-user-loop/spec.md`
- No runtime, API, dependency, or storage-format changes.
