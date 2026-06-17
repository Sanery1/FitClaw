## Problem

Feishu session evals cover first-plan generation and next-session guidance, but they do not yet protect the case where a user asks for a temporary adjustment to an existing plan and explicitly does not want the current plan saved or replaced.

## Root Cause

The existing no-save adjustment coverage lives in the `skills` suite. The Feishu session suite does not assert the channel-level behavior: read the saved `training_plan`, answer with a minimal temporary adjustment, and avoid `data_bodybuilding_write`.

## Goal

Add deterministic Feishu session eval coverage for temporary plan adjustment without saving durable plan changes.

## Non-Goals

- Do not change runtime behavior, storage contracts, or Skill APIs.
- Do not add new graders or dependencies.
- Do not define a new plan-adjustment schema.
