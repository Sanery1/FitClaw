## ADDED Requirements

### Requirement: Feishu plan-adjustment save eval coverage
FitClaw SHALL protect confirmed Feishu training-plan adjustment saves with deterministic eval coverage.

#### Scenario: Saving a confirmed plan adjustment
- **WHEN** deterministic Feishu session evals cover a user explicitly confirming that an adjusted plan should be saved as the current plan
- **THEN** they SHALL verify FitClaw reads `training_plan`, replaces `training_plan` with the adjusted structured plan, and confirms the save concisely
