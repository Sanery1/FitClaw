## Why

The `fitness-memory-contract` requires `user_profile` updates to preserve still-valid existing fields when replacing the object, but the current skills eval suite only checks read-only profile behavior and new profile capture. A deterministic eval should protect the read-modify-replace path before deeper Feishu memory work builds on it.

## What Changes

- Add a read fixture tool to the eval harness so skills evals can verify `data_bodybuilding_read` before profile replacement.
- Add a focused `bodybuilding-profile-preserve` skills eval that reads an existing `user_profile`, writes a complete replacement object, and checks old fields remain.
- Update the memory contract spec to require deterministic coverage for partial profile updates.
- Do not change runtime skill data tools, storage, or dependencies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `fitness-memory-contract`: Add deterministic eval coverage for preserving existing `user_profile` fields during replacement.

## Impact

- `packages/coding-agent/src/evals/eval-tools.ts`
- `packages/coding-agent/test/eval-harness.test.ts`
- `packages/coding-agent/evals/tasks/skills/bodybuilding-profile-preserve.yaml`
- `openspec/changes/add-user-profile-preserve-eval/*`
