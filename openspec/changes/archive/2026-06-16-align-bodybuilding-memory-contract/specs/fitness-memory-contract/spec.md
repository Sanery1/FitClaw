## ADDED Requirements

### Requirement: Bodybuilding Skill contract alignment
FitClaw SHALL keep the `bodybuilding` Skill instructions aligned with the first-stage fitness memory contract so agents see namespace, write-mode, and field-shape rules before writing durable fitness data.

#### Scenario: Reading bodybuilding Skill memory guidance
- **WHEN** an agent reads the `bodybuilding` Skill before persisting durable fitness facts
- **THEN** the Skill SHALL describe object namespaces as complete `replace` documents and array namespaces as single-record `append` histories

#### Scenario: Recording a workout through Skill evals
- **WHEN** deterministic Skill evals cover `training_log` writes
- **THEN** they SHALL verify the `training_log` namespace, append mode, and snake_case load fields such as `weight_kg`
