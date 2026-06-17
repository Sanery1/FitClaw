## Context

`feishu-2026-05-08-training-summary` replays a captured Feishu prompt and seeds two saved training records. The current faux response answers directly and the graders require `max_tool_calls: 0`, which conflicts with the Feishu fitness loop requirement that recent-training summaries read `training_log`.

## Goals / Non-Goals

**Goals:**

- Make the captured eval fail when `training_log` is not read.
- Keep the eval focused on read-before-summary behavior and no durable writes.
- Preserve the existing expected user-facing summary content.

**Non-Goals:**

- Do not change Mom runtime behavior, Skill data storage, prompt wording, or model/provider logic.
- Do not add new eval framework features.
- Do not broaden the eval beyond the captured summary scenario.

## Decisions

- Update the existing captured eval instead of adding a parallel duplicate.
  - Rationale: the bug is in the existing regression guard; fixing it directly keeps coverage easier to understand.
  - Alternative considered: rely only on newer synthetic summary evals. That leaves the captured Feishu regression weaker than the intended contract.
- Add a faux `data_bodybuilding_read` tool call before the final text and require matching graders.
  - Rationale: this mirrors the already-correct `feishu-training-summary-with-log` pattern.

## Risks / Trade-offs

- The eval turn count increases from one to two because tool use adds a tool-call turn. Mitigation: keep `max_tool_calls: 1` and `max_turns: 2` so the eval still rejects extra work.
