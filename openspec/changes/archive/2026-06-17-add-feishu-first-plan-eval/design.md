## Design

Add one synthetic Feishu session eval for the positive first-plan path:

- Seed `sport-data/bodybuilding/user_profile.json` with enough durable context: goal, experience, weekly availability, equipment, and no injuries.
- Prompt the assistant to generate the user's first plan.
- Require a `data_bodybuilding_read` call for `user_profile` before durable writes.
- Require a `data_bodybuilding_write` call to `training_plan` with `mode: replace`.
- Assert persisted plan fields through existing JSON-path graders.
- Keep tool-call limits tight enough to catch unnecessary writes or wandering conversation.

The eval is deliberately deterministic and uses faux responses. It protects the intended agent/tool contract rather than introducing new model behavior.

## Risk

Low. This change adds eval/spec/documentation artifacts only. The main risk is making the expected plan shape too rigid; to keep it maintainable, graders assert stable contract fields and one representative exercise/rest field rather than a full plan snapshot.
