## Context

The Feishu training-log flow already includes a scenario for explicit personal records: append the workout to `training_log` and update `personal_records` when enough data is available. Existing session evals cover a normal training log, and the Skill eval suite covers a `personal_records` write, but no Feishu session eval verifies the combined two-write behavior.

## Goals / Non-Goals

**Goals:**

- Add one focused Feishu session eval for a clear PR log.
- Verify both append operations occur in order: `training_log`, then `personal_records`.
- Verify key fields are persisted in both namespaces.

**Non-Goals:**

- Do not change runtime behavior, prompts, or storage contracts.
- Do not modify existing Skill eval semantics.
- Do not add a new eval framework feature.

## Decisions

- Use a synthetic Feishu prompt: `记录一个 PR：今天深蹲 100kg 做了 5 次。`
  - Rationale: it has enough data to identify the exercise, weight, rep count, and PR metric.
- Require two `data_bodybuilding_write` calls in sequence.
  - Rationale: the Feishu spec explicitly requires both the completed workout record and the personal-record record.

## Risks / Trade-offs

- This eval constrains PR handling more tightly than the existing Skill eval. Mitigation: the scope is Feishu session behavior, which already has the stronger two-write requirement.
