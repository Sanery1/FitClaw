## Context

Object namespaces such as `user_profile` use `replace`, because the runtime data tool does not provide merge mode. That makes read-modify-replace behavior important: the agent must read the existing object, construct a complete updated object, and replace it without dropping still-valid facts.

The eval harness currently has `data_bodybuilding_write` only. A YAML task can check the final JSON file, but it cannot verify that the agent read first. Adding an eval-only `data_bodybuilding_read` fixture makes the intended sequence testable without changing runtime tools.

## Approach

- Add `data_bodybuilding_read` to `createEvalTools`.
- Reuse the same namespace allow-list and workspace path safety as write.
- Return persisted JSON data or `null` when no namespace file exists.
- Add a harness unit test that requires read before write and verifies the final profile preserves old fields.
- Add a skills eval using the same read -> write sequence.

## Non-Goals

- No runtime behavior changes.
- No schema validator.
- No new data namespaces.
- No migration of existing data.
- No broad Feishu workflow changes.
