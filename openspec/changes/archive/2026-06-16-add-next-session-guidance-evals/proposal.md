## Why

The Feishu loop spec requires next-session guidance to use the saved `training_plan` and recent `training_log` when available, and to state uncertainty when plan data is missing. Existing session evals check final wording, but they do not verify that the assistant reads saved context before answering.

## What Changes

- Add a session eval that reads `training_plan` and `training_log` before answering the next-session question.
- Add a session eval that reads missing `training_plan`, states uncertainty, and avoids writing durable data.
- Add a Feishu loop verification requirement for next-session guidance eval coverage.
- Do not change runtime tools, storage, dependencies, or Feishu bot code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `feishu-fitness-user-loop`: Require deterministic eval coverage for next-session guidance context reads and missing-plan uncertainty.

## Impact

- `packages/coding-agent/evals/tasks/session/feishu-next-session-with-context.yaml`
- `packages/coding-agent/evals/tasks/session/feishu-next-session-missing-plan.yaml`
- `openspec/changes/add-next-session-guidance-evals/*`
