## ADDED Requirements

### Requirement: Feishu plan-adjustment no-save eval coverage
FitClaw SHALL protect temporary Feishu training-plan adjustment requests with deterministic eval coverage.

#### Scenario: Suggesting a temporary plan adjustment without saving
- **WHEN** deterministic Feishu session evals cover a user asking to adjust an existing plan temporarily and explicitly not save the change
- **THEN** they SHALL verify FitClaw reads `training_plan`, gives a minimal adjustment, does not call `data_bodybuilding_write`, and leaves the persisted plan unchanged
