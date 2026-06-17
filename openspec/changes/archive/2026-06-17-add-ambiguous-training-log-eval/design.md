## Context

`Feishu training log flow` already says ambiguous workout logs should trigger a short clarification question before writing `training_log`. Existing session evals cover the happy path (`记录今天卧推60kg 5x5，RPE 8`) but not the negative path where the user omits the exercise/action name.

## Goals / Non-Goals

**Goals:**

- Add one focused session eval for an ambiguous training-log prompt.
- Ensure the eval fails if `data_bodybuilding_write` is called.
- Ensure the final answer asks for the missing action/exercise detail.

**Non-Goals:**

- Do not change runtime behavior, prompts, or storage contracts.
- Do not add a new eval framework feature.
- Do not broaden this change to plan generation or personal-record behavior.

## Decisions

- Add a new session eval instead of modifying the successful captured training-log eval.
  - Rationale: the successful-write path and ambiguous-clarification path are distinct behaviors and should remain independently readable.
- Use a short Chinese prompt matching Feishu usage: `记录今天练了 5x5，RPE 8`.
  - Rationale: it includes measurable values but omits the exercise name, matching the existing spec's ambiguity condition.

## Risks / Trade-offs

- The eval uses a synthetic prompt rather than a captured Feishu session. Mitigation: it is deterministic, minimal, and directly maps to an existing spec scenario.
