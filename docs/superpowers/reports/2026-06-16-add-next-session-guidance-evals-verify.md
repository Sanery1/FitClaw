---
change: add-next-session-guidance-evals
status: pass
verified-at: 2026-06-16
---

# Verify: Add Next-Session Guidance Evals

## Result

PASS.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Focused next-session evals | PASS | `npm run eval -- --suite session --task feishu-next-session-with-context` and `--task feishu-next-session-missing-plan` both passed |
| Session eval suite | PASS | `npm run eval -- --suite session` passed 12/12 tasks |
| OpenSpec change validation | PASS | `npx openspec validate add-next-session-guidance-evals` |
| Main specs validation | PASS | `npx openspec validate --specs` reported 3 passed, 0 failed |
| Project check | PASS | `npm run check` completed successfully |

## Notes

This change adds deterministic coverage for next-session guidance:

- with saved plan and recent logs, the assistant reads `training_plan` and `training_log` before answering;
- without a saved plan, the assistant reads available context, states uncertainty, and avoids durable writes.

No runtime tools, storage, dependencies, or Feishu bot code changed.

## Changed Files Reviewed

- `packages/coding-agent/evals/tasks/session/feishu-next-session-with-context.yaml`
- `packages/coding-agent/evals/tasks/session/feishu-next-session-missing-plan.yaml`
- `openspec/changes/add-next-session-guidance-evals/*`
