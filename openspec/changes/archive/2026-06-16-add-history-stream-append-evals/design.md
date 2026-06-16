## Context

The first-stage memory contract separates current-state object namespaces from append-only history namespaces. `training_log` already has skills eval coverage, but the other history streams do not. That leaves `body_metrics`, `progression`, and `personal_records` vulnerable to future regressions where a write could replace history instead of appending one record.

## Approach

- Add one deterministic skills eval per missing history namespace.
- Seed each namespace with an existing record to prove the new write appends to index 1 instead of replacing index 0.
- Verify each write uses `data_bodybuilding_write` with the expected namespace and `mode: append`.
- Verify key snake_case fields in final JSON:
  - `body_metrics`: `date`, `weight_kg`, optional `waist_cm`
  - `progression`: `date`, `type`, `reason`
  - `personal_records`: `date`, `exercise`, `metric`, `value`, `unit`

## Non-Goals

- No runtime behavior changes.
- No new namespace or schema validator.
- No migration of existing data.
- No Feishu workflow changes.
