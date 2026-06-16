---
comet_change: harden-fitness-memory-contract
role: technical-design
canonical_spec: openspec
---

# Design: Harden Fitness Memory Contract

## Context

This design doc refines the OpenSpec change `harden-fitness-memory-contract`. OpenSpec remains the canonical requirements source.

The current fitness loop depends on six `bodybuilding` Skill data namespaces:

- `user_profile`
- `training_log`
- `training_plan`
- `body_metrics`
- `progression`
- `personal_records`

The current implementation already provides useful persistence mechanics:

- `.fitclaw/skills/bodybuilding/SKILL.md` declares the six namespaces.
- `createSkillDataReadTool` and `createSkillDataWriteTool` validate namespace names and reject undeclared namespaces.
- object namespaces default to `mode: "replace"`.
- array namespaces default to `mode: "append"`.
- `FileSportDataStore` persists JSON under `sport-data/<skill>/<namespace>.json`.

The implementation does not currently enforce field-level schemas, merge object namespaces, migrate older records, or validate fitness semantics.

## Technical Approach

The first implementation slice should harden the contract at the Skill and eval layer, not the storage layer.

The recommended approach is:

1. Treat OpenSpec as the product and engineering contract.
2. Mirror the contract into bodybuilding Skill documentation or a focused reference file.
3. Add deterministic evals for the riskiest write behaviors.
4. Keep the runtime data tools unchanged unless later evidence shows prompt and eval guidance are insufficient.

This keeps the change low-risk and aligned with the current architecture.

## Namespace Rules

Object namespaces represent current state:

| Namespace | Meaning | Write mode |
| --- | --- | --- |
| `user_profile` | current durable profile | `replace` |
| `training_plan` | current active plan | `replace` |

Array namespaces represent history or events:

| Namespace | Meaning | Write mode |
| --- | --- | --- |
| `training_log` | completed workout history | `append` |
| `body_metrics` | dated body metric records | `append` |
| `progression` | dated progression events | `append` |
| `personal_records` | dated personal records | `append` |

When updating an object namespace, the agent should read existing data first if old facts may exist, construct a complete replacement object, and preserve still-valid fields.

When writing an array namespace, the agent should append one event record and avoid replacing the full array.

## Field Conventions

New records should use `snake_case` field names.

Preferred examples:

- `weight_kg`
- `height_cm`
- `duration_minutes`
- `training_days_per_week`
- `rest_seconds`
- `created_at`
- `updated_at`
- `schema_version`

Older data shapes should not be rewritten solely for naming cleanup. A migration should be a separate approved change.

## Minimum Shapes

The contract defines minimum useful shapes, not exhaustive product schemas.

`user_profile` should hold durable profile facts such as goal, experience, equipment, schedule, injury limitations, and body basics.

`training_log` records should include a date and at least one exercise with a name plus measurable training data such as sets, reps, weight, duration, or RPE.

`training_plan` should represent the current active plan and include enough structure to answer next-session questions.

`body_metrics` records should include a date and at least one metric.

`progression` records should include date, type, and reason.

`personal_records` records should include date, exercise, metric, value, and unit.

## Runtime Boundary

This change should not add runtime field validation yet.

Reasons:

- the current tool API accepts `Type.Any` data and has no schema registry;
- schema validation would need decisions about partial records, migration, error messages, and backward compatibility;
- current risk can be reduced with clearer Skill instructions and evals first.

Runtime schema validation remains a valid later change if evals show repeated invalid writes.

## Verification Strategy

This spec-only change should be verified with OpenSpec validation.

Follow-up implementation changes should add eval coverage for:

- profile read-modify-replace;
- workout append without replacing existing history;
- plan replace only when the user asks to save or apply the plan;
- metrics append;
- progression append;
- personal record append;
- ambiguous workout logs asking for clarification before writing.

Useful existing evidence:

- `feishu-2026-05-08-profile-capture.yaml` already checks `user_profile` fields.
- `feishu-2026-05-08-training-log.yaml` already checks `training_log` append behavior and `weight_kg`.
- `bodybuilding-log.yaml` shows older `weightKg` usage, which explains the need for field naming guidance.

## Risks And Trade-Offs

The main risk is that a contract without runtime enforcement may still be ignored by the model. The low-risk mitigation is to add targeted evals before adding validators.

Another risk is accidental overwrite of object namespaces. The contract mitigates this by requiring read-modify-replace for updates to existing current-state objects.

The contract intentionally does not solve historical migration. This avoids surprising changes to existing user data.

## Implementation Slices

Recommended next slices:

1. Document the contract inside the bodybuilding Skill or a dedicated reference file.
2. Add evals for read-modify-replace and append-only behavior.
3. Review eval results before deciding whether runtime schema validation is worth the added complexity.
