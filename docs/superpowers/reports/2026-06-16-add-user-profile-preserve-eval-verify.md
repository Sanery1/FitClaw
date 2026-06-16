---
change: add-user-profile-preserve-eval
status: pass
verified-at: 2026-06-16
---

# Verify: Add User Profile Preserve Eval

## Result

PASS.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Eval harness focused test | PASS | `npx tsx ../../node_modules/vitest/dist/cli.js --run test/eval-harness.test.ts` passed 10 tests |
| Skills eval suite | PASS | `npm run eval -- --suite skills` passed 3/3 tasks |
| Tools eval suite | PASS | `npm run eval -- --suite tools` passed 1/1 task |
| OpenSpec change validation | PASS | `npx openspec validate add-user-profile-preserve-eval` |
| Main specs validation | PASS | `npx openspec validate --specs` reported 3 passed, 0 failed |
| Project check | PASS | Sequential `npm run check` completed successfully |

## Notes

One parallel verification run of `npm run check` produced unrelated model ID type errors after touching `packages/ai/src/models.generated.ts`. That generated-file side effect was restored. A subsequent sequential `npm run check` passed with no file changes.

## Changed Files Reviewed

- `packages/coding-agent/src/evals/eval-tools.ts`
- `packages/coding-agent/test/eval-harness.test.ts`
- `packages/coding-agent/evals/tasks/skills/bodybuilding-profile-preserve.yaml`
- `openspec/changes/add-user-profile-preserve-eval/*`
