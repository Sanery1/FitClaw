## ADDED Requirements

### Requirement: Feishu personal record eval coverage
FitClaw SHALL protect Feishu personal-record logging with deterministic eval coverage.

#### Scenario: Recording a clear PR from Feishu
- **WHEN** deterministic Feishu session evals cover a user explicitly reporting a personal record with enough structured data
- **THEN** they SHALL verify FitClaw appends the completed workout to `training_log`, appends the record to `personal_records`, and confirms the save concisely
