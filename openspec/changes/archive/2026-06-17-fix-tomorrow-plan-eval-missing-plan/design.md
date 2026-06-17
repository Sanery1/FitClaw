## Context

`feishu-2026-05-08-tomorrow-plan` replays a captured Feishu prompt asking for tomorrow's workout. It only seeds `training_log`, not `training_plan`, but its faux response gives a specific Day 2 Lower A plan and its graders require `max_tool_calls: 0`.

The current main spec already requires next-session guidance to use saved `training_plan` and recent `training_log` when available, and to state uncertainty when plan data is missing.

## Goals / Non-Goals

**Goals:**

- Make the captured eval fail when no saved context is read.
- Make the captured eval fail when a specific next-session plan is invented without a saved `training_plan`.
- Keep the eval focused on read-before-answer and no durable writes.

**Non-Goals:**

- Do not change Mom runtime behavior, Skill storage, prompts, or provider logic.
- Do not add a new eval framework feature.
- Do not alter the synthetic next-session evals that already cover this behavior.

## Decisions

- Update the existing captured eval instead of adding a duplicate.
  - Rationale: the regression is in the captured scenario itself; fixing it preserves the real Feishu prompt while aligning it with current product rules.
- Mirror the newer `feishu-next-session-missing-plan` pattern.
  - Rationale: that eval already expresses the intended behavior: read both namespaces, mention missing plan uncertainty, and avoid writes.

## Risks / Trade-offs

- The captured answer no longer matches the historical captured response. Mitigation: this is intentional because the captured response is now known to violate the current missing-plan contract.
