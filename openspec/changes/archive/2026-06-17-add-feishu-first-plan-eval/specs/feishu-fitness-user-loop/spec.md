## ADDED Requirements

### Requirement: Feishu first-plan eval coverage
FitClaw SHALL protect first training-plan generation from complete Feishu profile context with deterministic eval coverage.

#### Scenario: Generating and saving a first plan from saved profile
- **WHEN** deterministic Feishu session evals cover a user asking for a first training plan and saved `user_profile` contains goal, experience, equipment, schedule, and no known injury limits
- **THEN** they SHALL verify FitClaw reads `user_profile`, replaces `training_plan` with a structured plan, and confirms the saved plan in mobile-readable text
