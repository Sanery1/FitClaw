## Why

`fitness-memory-contract` already defines the first-stage bodybuilding memory contract, but the active `bodybuilding` Skill instructions and one existing skill eval still allow drift from that contract. Before improving runtime memory behavior, the prompt-facing Skill contract and eval fixtures should reflect the same namespace, write-mode, and field-naming rules.

## What Changes

- Update the `bodybuilding` Skill instructions to describe object namespaces as complete `replace` documents and array namespaces as append-only records.
- Add concrete first-stage field guidance and examples for `user_profile`, `training_log`, and related namespaces.
- Align the existing `bodybuilding-log` eval with snake_case field naming and explicit append-mode expectations.
- Do not change runtime storage, data tools, dependencies, or database behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `fitness-memory-contract`: Require the bodybuilding Skill guidance and deterministic evals to stay aligned with the memory contract.

## Impact

- `.fitclaw/skills/bodybuilding/SKILL.md`
- `packages/coding-agent/evals/tasks/skills/bodybuilding-log.yaml`
- OpenSpec change artifacts under `openspec/changes/align-bodybuilding-memory-contract/`
- No runtime code changes and no new dependencies.
