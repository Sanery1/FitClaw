---
change: add-safety-onboarding-evals
status: pass
verified-at: 2026-06-17
---

# Verify: Add Safety Onboarding Evals

## Result

PASS.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Focused safety/onboarding evals | PASS | `npm run eval -- --suite session --task feishu-plan-missing-injury-gate` and `--task feishu-pain-heavy-lift-boundary` both passed |
| Session eval suite | PASS | `npm run eval -- --suite session` passed 16/16 tasks |
| OpenSpec change validation | PASS | `npx openspec validate add-safety-onboarding-evals` |
| Main specs validation | PASS | `npx openspec validate --specs` reported 3 passed, 0 failed |
| Project check | PASS | `npm run check` completed successfully |

## Notes

This change adds deterministic coverage for two safety boundaries:

- plan generation asks for injury/movement limitation information before saving a plan;
- pain before heavy lifting is handled conservatively without durable writes.

No runtime tools, storage, dependencies, or Feishu bot code changed.

## Changed Files Reviewed

- `packages/coding-agent/evals/tasks/session/feishu-plan-missing-injury-gate.yaml`
- `packages/coding-agent/evals/tasks/session/feishu-pain-heavy-lift-boundary.yaml`
- `openspec/changes/add-safety-onboarding-evals/*`
