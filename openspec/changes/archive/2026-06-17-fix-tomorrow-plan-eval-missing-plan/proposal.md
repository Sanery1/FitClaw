## Why

The captured Feishu tomorrow-plan eval seeds a recent `training_log` but currently requires zero tool calls and a specific Day 2 plan answer. Because no `training_plan` is seeded, that eval contradicts the saved-context and missing-plan requirements for next-session guidance.

## What Changes

- Update the captured tomorrow-plan eval so it requires reading `training_plan` and `training_log`.
- Change the expected answer from an invented specific plan to a missing-plan uncertainty response based only on available saved history.
- Keep the eval write-safe by forbidding durable writes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `feishu-fitness-user-loop`: Captured Feishu next-session evals with no saved `training_plan` must verify missing-plan uncertainty and saved-log reads.

## Impact

- Affected eval: `packages/coding-agent/evals/tasks/session/feishu-2026-05-08-tomorrow-plan.yaml`
- Affected spec: `openspec/specs/feishu-fitness-user-loop/spec.md`
- No runtime, API, dependency, or storage-format changes.
