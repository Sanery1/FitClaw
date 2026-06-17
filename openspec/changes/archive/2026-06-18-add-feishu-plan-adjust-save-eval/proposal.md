## Problem

Feishu session eval coverage protects temporary no-save plan adjustments, but it does not yet protect the opposite path where the user explicitly confirms that an adjusted plan should become the current saved plan.

## Root Cause

The session suite lacks a deterministic eval that requires FitClaw to read the current `training_plan` before replacing it after explicit user confirmation.

## Goal

Add deterministic Feishu session eval coverage for confirmed training-plan adjustment saves.

## Non-Goals

- Do not change runtime behavior, storage contracts, or Skill APIs.
- Do not add new graders or dependencies.
- Do not redesign the training-plan schema.
