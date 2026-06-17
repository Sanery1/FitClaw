## Design

Add one synthetic Feishu session eval:

- Seed `training_plan` with an existing four-day hypertrophy plan.
- Prompt the user to ask for a temporary adjustment because legs are tired, explicitly saying not to save the plan.
- Require `data_bodybuilding_read` for `training_plan`.
- Require no `data_bodybuilding_write` calls.
- Assert the persisted plan is unchanged with JSON-path checks.
- Keep tool-call and turn limits tight to catch unnecessary writes or wandering.

This mirrors the existing `skills` suite no-save adjustment coverage, but validates the Feishu session/tool boundary.

## Risk

Low. This change only adds deterministic eval/spec/report artifacts. The eval checks durable behavior and a few stable response cues instead of overfitting the exact coaching text.
