## Design

Add one synthetic Feishu session eval:

- Seed `training_plan` with an existing four-day hypertrophy plan.
- Prompt the user to explicitly save a lighter lower-day adjustment as the current plan.
- Require `data_bodybuilding_read` for `training_plan` before writing.
- Require `data_bodybuilding_write` to `training_plan` with `mode: replace`.
- Assert persisted fields changed to the adjusted plan through JSON-path graders.
- Keep tool and turn limits tight to catch unnecessary extra writes or wandering.

This complements the no-save adjustment eval by covering the explicit confirmation path.

## Risk

Low. This change only adds deterministic eval/spec/report artifacts. The eval checks stable contract fields rather than a full plan snapshot.
