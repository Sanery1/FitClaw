## Why

The Feishu training-log spec says a clear personal-record report should append the completed workout to `training_log` and update `personal_records` when enough data is available. Current session evals cover normal workout logging, while existing personal-record coverage only exists in the Skill suite and only writes `personal_records`.

## What Changes

- Add a deterministic Feishu session eval for a clear PR log.
- Verify FitClaw appends the workout to `training_log`.
- Verify FitClaw appends the PR to `personal_records`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `feishu-fitness-user-loop`: Feishu PR logging coverage must verify both workout-log and personal-record writes when the user gives enough structured data.

## Impact

- Affected evals: `packages/coding-agent/evals/tasks/session/`
- Affected spec: `openspec/specs/feishu-fitness-user-loop/spec.md`
- No runtime, API, dependency, or storage-format changes.
