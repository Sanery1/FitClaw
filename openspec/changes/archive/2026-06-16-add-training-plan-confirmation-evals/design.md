## Context

`training_plan` is an object/current-state namespace. Replacing it too eagerly would make a temporary suggestion become the user's durable active plan. The main spec already defines both sides of this boundary:

- confirmed generated or adjusted plans use `mode: "replace"`;
- temporary or tentative adjustments do not replace `training_plan` unless the user clearly asks to save or apply the change.

## Approach

- Add one negative-path skills eval for tentative plan advice:
  - seed an existing `training_plan`;
  - return a suggestion-only final response;
  - verify `data_bodybuilding_write` is not called and the existing JSON remains unchanged.
- Add one positive-path skills eval for confirmed plan saving:
  - seed an empty or old `training_plan`;
  - call `data_bodybuilding_write` with `namespace: training_plan` and `mode: replace`;
  - verify key plan fields in the tool args and final JSON.

## Non-Goals

- No runtime behavior changes.
- No new namespace or schema validator.
- No Feishu workflow changes.
- No migration of existing plan data.
