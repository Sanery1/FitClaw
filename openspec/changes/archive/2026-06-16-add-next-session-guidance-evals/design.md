## Context

Next-session guidance is a high-value Feishu flow because it is where the assistant turns long-term memory into concrete coaching. If it answers without reading the plan or recent logs, it can produce plausible but ungrounded training advice.

The eval harness already has `data_bodybuilding_read`, so this change can protect the behavior without runtime changes.

## Approach

- Add a positive-path session eval:
  - seed `training_plan` and `training_log`;
  - require `data_bodybuilding_read` for `training_plan`;
  - require `data_bodybuilding_read` for `training_log`;
  - verify final answer references the expected next day and exercises;
  - verify no durable write happens.
- Add a missing-plan session eval:
  - seed recent `training_log` but no `training_plan`;
  - require reading `training_plan` before answering;
  - verify final answer states uncertainty or missing plan data;
  - verify no durable write happens.

## Non-Goals

- No runtime orchestration changes.
- No new grader type.
- No Feishu bot integration changes.
- No migration or schema validation.
