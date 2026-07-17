# Verification Report: Feishu Fitness Live Smoke

Date: 2026-07-17

## Result

PASS with one non-blocking observation.

The Docker deployment, real Feishu entry point, live model, Skill data persistence, and image upload path were exercised end to end. No secrets or personal identifiers are included in this report.

## Environment

- Model: `deepseek/deepseek-v4-flash`
- Deployment: Docker Compose
- Bot: `fitclaw-bot`
- Isolated Skill executor: `fitclaw-skill-runner`

## Smoke Results

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Profile capture | PASS | `user_profile.json` was replaced with the declared profile fields. |
| 2. First plan | PASS after script correction | The original prompt did not explicitly request persistence, so the runtime correctly did not save. After adding “save as my current plan”, `training_plan.json` was replaced. The smoke script now matches the save-confirmation contract. |
| 3. Temporary adjustment | PASS | The Bot described a temporary 20-minute plan and the saved plan timestamp and size remained unchanged. |
| 4. Save adjustment | PASS | The saved plan was replaced with three sessions and the updated 20-minute current plan. |
| 5. Training log | PASS | `training_log.json` increased from 4 to 5 entries; the current plan was not rewritten. |
| 6. Personal record | PASS | `personal_records.json` increased from 1 to 2 entries. |
| 7. Recent summary | PASS | The reply summarized only persisted training history and the new record. |
| 8. Next session | PASS | The reply matched the saved plan and recent training state. |
| 9. Pain and heavy lifting | PASS after fix | The initial reply rejected heavy squats but still suggested normal B-session work. The global Coach safety boundary was strengthened; the final live regression stopped the normal plan, allowed only pain-free light activity, and recommended professional assessment for persistent pain. |
| 10. Weather boundary | PASS | The Bot stated that it had no real-time weather access and did not invent a forecast. |
| 11. Exercise image | PASS after fix | The image was visible in Feishu and `attach` succeeded. The first run recovered from guessed shell arguments; the final regression used only documented `--name` and `--id --detailed` calls with no validation error. |

## Final Data Shape

| Namespace | Result |
| --- | --- |
| `user_profile` | Object with 7 profile fields |
| `training_plan` | Object with 3 sessions |
| `training_log` | Array with 5 entries |
| `personal_records` | Array with 2 entries |

## Verification

| Check | Result |
| --- | --- |
| `npx tsx ../../node_modules/vitest/dist/cli.js --run test/system-prompt.test.ts` | PASS, 3/3 |
| `npm run check` | PASS |
| `npm run eval -- --suite session` | PASS, 23/23 |
| `docker compose up -d --build` | PASS |
| `docker compose ps` | PASS; Bot running and Skill Runner healthy |
| Feishu WebSocket startup | PASS |
| Final pain-boundary live regression | PASS |
| Final image-query live regression | PASS |

## Non-blocking Observation

In the same long-running conversation, the live model sometimes answered current-plan questions from recent conversation context without emitting `data_bodybuilding_read`. The answer remained consistent with persisted state and no unintended write occurred. The global prompt now requires current-turn reads for plan changes, next-session advice, and summaries, but model-independent enforcement would require an intent-routing or automatic-preload layer. That broader architecture is not justified by a user-facing failure in this run and was not added.

## Changed Files Reviewed

- `.fitclaw/skills/bodybuilding/SKILL.md`
- `docs/FEISHU_FITNESS_SMOKE_SCRIPT.md`
- `packages/coach-core/src/system-prompt.ts`
- `packages/coach-core/test/system-prompt.test.ts`
