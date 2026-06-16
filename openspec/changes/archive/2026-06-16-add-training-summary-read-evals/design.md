## Context

Training summaries are only useful if they are grounded in the user's saved workout history. A summary that guesses trends from thin context is worse than saying there is not enough data.

The eval harness already supports `data_bodybuilding_read`, so this change can verify read-before-answer behavior without runtime changes.

## Approach

- Add one positive-path session eval:
  - seed `training_log` with two workouts;
  - require reading `training_log`;
  - verify the answer includes only seeded exercises and values;
  - verify no durable write happens.
- Add one empty-history session eval:
  - leave `training_log` missing;
  - require reading `training_log`;
  - verify the answer states no available training records or insufficient data;
  - verify the answer avoids invented exercise names and durable writes.

## Non-Goals

- No runtime orchestration changes.
- No new grader type.
- No Feishu bot integration changes.
- No trend analysis algorithm.
