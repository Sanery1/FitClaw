## Problem

Feishu first-stage eval coverage protects profile capture, missing injury gating, logging, summaries, next-session guidance, and safety boundaries. It does not yet protect the positive path where the user already has enough saved profile context and asks FitClaw to create the first durable training plan.

## Root Cause

The existing session eval suite covers `training_plan` reads for next-session guidance and missing-injury refusal before plan generation, but no session eval asserts that FitClaw reads `user_profile` and writes a concrete `training_plan` when profile and safety inputs are complete.

## Goal

Add deterministic Feishu session eval coverage for first-plan generation from a complete saved profile, without changing runtime behavior.

## Non-Goals

- Do not change Mom runtime, Feishu channel code, Skill runtime, or storage semantics.
- Do not introduce new eval graders or dependencies.
- Do not redesign the training plan schema.
