## Why

The Feishu training-log flow already requires a clarification question when a workout log is too ambiguous to persist safely, but the session eval suite only covers successful log writes. A missing negative-path eval could let FitClaw write incomplete `training_log` records when the exercise name is absent.

## What Changes

- Add a deterministic session eval for an ambiguous Feishu workout log.
- Verify FitClaw asks for the missing exercise/action detail.
- Verify FitClaw does not write durable `training_log` data for the ambiguous input.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `feishu-fitness-user-loop`: Training-log eval coverage must include ambiguous log inputs that require clarification before writing.

## Impact

- Affected evals: `packages/coding-agent/evals/tasks/session/`
- Affected spec: `openspec/specs/feishu-fitness-user-loop/spec.md`
- No runtime, API, dependency, or storage-format changes.
