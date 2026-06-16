## ADDED Requirements

### Requirement: History stream append eval coverage
FitClaw SHALL protect first-stage append-only fitness history streams with deterministic eval coverage.

#### Scenario: Appending body metrics through Skill evals
- **WHEN** deterministic Skill evals cover `body_metrics` writes
- **THEN** they SHALL verify the `body_metrics` namespace, append mode, and key metric fields such as `date` and `weight_kg`

#### Scenario: Appending progression through Skill evals
- **WHEN** deterministic Skill evals cover `progression` writes
- **THEN** they SHALL verify the `progression` namespace, append mode, and key fields such as `date`, `type`, and `reason`

#### Scenario: Appending personal records through Skill evals
- **WHEN** deterministic Skill evals cover `personal_records` writes
- **THEN** they SHALL verify the `personal_records` namespace, append mode, and key fields such as `date`, `exercise`, `metric`, `value`, and `unit`
