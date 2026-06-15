---
comet_change: design-feishu-fitness-user-loop
role: technical-design
canonical_spec: openspec
---

# Design: Feishu Fitness User Loop

## Context

This design doc refines the OpenSpec change `design-feishu-fitness-user-loop`. OpenSpec remains the canonical source of requirements.

The current project already has the main pieces needed for the first-stage fitness loop:

- `packages/mom/src/main.ts` adapts Feishu events into `BotContext` and sends final card/text replies.
- `packages/mom/src/types.ts` defines `BotContext`, keeping the IM adapter boundary separate from agent orchestration.
- `packages/mom/src/agent.ts` loads skills, registers `data_<skill>_read/write` tools, builds the FitCoach system prompt, and keeps one runner per channel/user.
- `.fitclaw/skills/bodybuilding/SKILL.md` declares the fitness workflow and data namespaces: `user_profile`, `training_log`, `training_plan`, `body_metrics`, `progression`, and `personal_records`.
- `packages/coding-agent/evals/tasks/session` already contains Feishu session eval baselines for identity, profile capture, training log, training summary, tomorrow plan, safety, substitution, and out-of-scope handling.

This change is still spec/design-only. It should not modify runtime behavior.

## Technical Approach

The first-stage product loop should be implemented as a conversational coaching loop reachable through Feishu, while keeping coaching logic portable.

The preferred boundary is:

```text
Feishu event
  -> packages/mom adapter
  -> BotContext
  -> AgentRunner
  -> bodybuilding Skill and data tools
  -> concise Feishu response
```

Feishu should remain an adapter. It may format the message and handle Feishu API constraints, but it should not own onboarding rules, training plan policy, progression rules, or safety policy.

Core coaching behavior should live in one of these places:

- bodybuilding Skill instructions and references, when the behavior is domain guidance.
- data namespace contracts, when the behavior concerns durable user facts.
- Agent workflow prompts or reusable orchestration, when the behavior concerns tool sequencing.
- evals, when the behavior must be protected from regression.

## User Loop Model

The first-stage loop has eight scenario families:

1. Identity confirmation.
2. First-time profile capture.
3. Training plan generation.
4. Training plan adjustment.
5. Workout logging.
6. Training query and summary.
7. Today, tomorrow, or next-session guidance.
8. Safety and out-of-scope handling.

These scenarios should be treated as the product surface area for the first phase. Future work that claims to improve the first-stage user experience should map to one or more of these scenario families.

## Data Flow

The coaching loop should read saved facts before answering and write durable facts as soon as they are learned.

| Scenario | Reads | Writes |
| --- | --- | --- |
| First-time profile capture | `user_profile` | `user_profile` |
| Training plan generation | `user_profile` | `training_plan` |
| Training plan adjustment | `user_profile`, `training_plan`, recent `training_log` | `training_plan` only after clear user confirmation or request |
| Workout logging | `user_profile`, `training_plan` | append `training_log`; optionally append `progression` or `personal_records` |
| Training summary | `training_log`, `body_metrics`, `progression` | usually none |
| Next-session guidance | `user_profile`, `training_plan`, recent `training_log` | usually none |
| Injury or pain handling | `user_profile`, `training_plan` | optional `user_profile` update for durable limitations |

The current JSON-backed data store is acceptable for phase one. The stable interface is the Skill data namespace, not the JSON backend itself.

## Feishu Response Boundary

First-stage Feishu responses should optimize for mobile readability:

- short direct text;
- grouped bullets for plans or summaries;
- key numbers emphasized in text;
- no HTML files, image files, attachments, ASCII diagrams, or large tables;
- uncertainty stated clearly when saved context is missing.

This matches the existing `packages/mom/src/agent.ts` system prompt and avoids depending on unsupported Feishu file or image flows.

## Safety Boundary

Safety should take priority over plan completeness.

When the user reports pain, injury, medical limitation, unsafe loading, extreme diet, unsafe supplementation, or non-fitness real-time requests, FitClaw should:

- avoid aggressive progression;
- ask one short clarifying question when needed;
- suggest safer substitutions or conservative loading;
- recommend professional medical or coaching assessment when appropriate;
- avoid fabricating real-time non-fitness facts.

## Verification Strategy

This change itself should be verified with OpenSpec validation.

Runtime implementation changes that follow this spec should add or update deterministic evals, or document a manual Feishu scenario when deterministic eval is not yet practical.

Existing eval coverage:

- identity;
- profile capture;
- training log;
- training summary;
- tomorrow plan;
- shoulder substitution;
- deadlift safety;
- weather boundary;
- check-in;
- swimming breathing.

Important gaps for later changes:

- first training plan generation;
- training plan adjustment after schedule, equipment, pain, or recovery changes;
- body metric capture;
- personal record update;
- multi-turn onboarding that writes only P0 facts first and continues later.

## Risks And Trade-Offs

Feishu is not as expressive as a native fitness app. This is acceptable in phase one because the learning goal is to validate an agentic coaching loop, not to compete on full UI polish.

Natural-language workout parsing can be unstable. The low-risk path is to first define namespace contracts and eval coverage, then harden schema and parsing behavior in small changes.

The current Skill instructions are stronger than a generic prompt, but they are not yet a complete domain engine. The next improvements should prefer structured data contracts, deterministic scripts, and evals over longer prompt text.

The Feishu adapter can become a dumping ground for product logic if boundaries are not protected. Future implementation should keep `packages/mom` focused on transport and presentation concerns.

## Implementation Slices

Recommended follow-up changes:

1. Harden the fitness memory contract for `bodybuilding` namespaces.
2. Add eval coverage for missing loop scenarios, especially plan generation and plan adjustment.
3. Improve onboarding and logging tool-use behavior using the existing Skill data tools.
4. Add a small documented manual Feishu test script for end-to-end smoke testing.

Each slice should be independently verifiable and should avoid broad runtime refactors.
