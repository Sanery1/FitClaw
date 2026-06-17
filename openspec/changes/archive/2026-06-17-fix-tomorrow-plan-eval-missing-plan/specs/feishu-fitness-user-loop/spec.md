## MODIFIED Requirements

### Requirement: Next-session guidance eval coverage
FitClaw SHALL protect next-session guidance with deterministic eval coverage that verifies saved-context reads and missing-data uncertainty across synthetic and captured Feishu session evals.

#### Scenario: Answering next-session guidance with saved context
- **WHEN** deterministic evals cover next-session guidance and both `training_plan` and recent `training_log` are available
- **THEN** they SHALL verify FitClaw reads those namespaces before answering and does not write durable data unless the user confirms a plan change

#### Scenario: Answering next-session guidance without a saved plan
- **WHEN** deterministic evals cover next-session guidance and `training_plan` is missing
- **THEN** they SHALL verify FitClaw states uncertainty or missing plan data instead of inventing a current plan

#### Scenario: Replaying captured Feishu next-session sessions without a saved plan
- **WHEN** deterministic evals replay a captured Feishu next-session prompt and only recent `training_log` is seeded
- **THEN** they SHALL verify FitClaw attempts to read `training_plan`, reads recent `training_log`, states that the current plan is missing or uncertain, and avoids durable writes
