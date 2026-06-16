## Context

The previous memory-contract change established the stable behavior for first-stage fitness memory:

- Object/current-state namespaces: `user_profile`, `training_plan`
- Array/history namespaces: `training_log`, `body_metrics`, `progression`, `personal_records`
- Object writes use complete-document `replace`.
- Array writes use single-record `append`.
- New first-stage fields prefer `snake_case`.

The `bodybuilding` Skill is the prompt-facing source of truth the agent reads before using fitness memory, so it needs to carry these rules directly. The existing `bodybuilding-log` eval also uses `weightKg`, which conflicts with the newly archived contract.

## Approach

Make the smallest prompt and eval alignment:

- Add a concise memory contract section to `.fitclaw/skills/bodybuilding/SKILL.md`.
- Keep the existing namespace table, but add write-mode and minimum-shape guidance.
- Update the existing log eval from `weightKg` to `weight_kg`.
- Add grader checks for the `training_log` namespace, `append` mode, and `weight_kg` field.

## Non-Goals

- No runtime schema validator.
- No JSON backend migration.
- No new data namespaces.
- No broad rewrite of bodybuilding coaching content.
- No changes to Feishu session behavior.

## Risks

- Prompt guidance can still be ignored by a model; the eval makes the most important drift visible, but runtime enforcement remains a later change.
- Existing older local data may contain camelCase fields. This change documents that old history should not be rewritten solely for naming cleanup.
