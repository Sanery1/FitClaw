## Why

The Feishu loop spec requires missing injury information to be clarified before plan generation and pain/1RM requests to be handled conservatively. Existing session evals cover some final wording, but they do not explicitly protect the "no durable write before safety clarification" boundary.

## What Changes

- Add a session eval for plan requests that have enough goal/equipment/schedule context but no injury information; the assistant must ask a short safety question and avoid saving a plan.
- Add a session eval for pain before heavy lifting; the assistant must discourage aggressive loading and avoid writing plan/log data.
- Add a Feishu loop verification requirement for onboarding safety gate and pain-boundary eval coverage.
- Do not change runtime tools, storage, dependencies, or Feishu bot code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `feishu-fitness-user-loop`: Require deterministic eval coverage for onboarding injury clarification and pain-before-heavy-lifting safety boundaries.

## Impact

- `packages/coding-agent/evals/tasks/session/feishu-plan-missing-injury-gate.yaml`
- `packages/coding-agent/evals/tasks/session/feishu-pain-heavy-lift-boundary.yaml`
- `openspec/changes/add-safety-onboarding-evals/*`
