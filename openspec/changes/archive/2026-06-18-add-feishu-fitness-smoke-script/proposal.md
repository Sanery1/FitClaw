## Motivation

The Feishu fitness loop now has deterministic session eval coverage, but the project still needs a small, repeatable way to check real Feishu/live-model behavior. Without a manual smoke script, it is hard to tell whether a passing faux-response contract eval also works as a natural user conversation in Feishu.

## Goals

- Add a concise manual smoke script for the first-stage Feishu fitness loop.
- Cover onboarding, first-plan creation, training logging, summary, next-session guidance, and safety boundary checks.
- Make expected Skill data namespace reads/writes explicit for each step.
- Link the script from the current Feishu loop status document.

## Scope

- Documentation only.
- No runtime behavior changes.
- No new eval tasks.
- No dependency, build, package, or deployment changes.
