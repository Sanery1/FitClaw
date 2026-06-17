## MODIFIED Requirements

### Requirement: Training summary read eval coverage
FitClaw SHALL protect recent-training summaries with deterministic eval coverage that verifies saved-log reads and empty-history uncertainty across synthetic and captured Feishu session evals.

#### Scenario: Summarizing saved training records
- **WHEN** deterministic evals cover recent-training summaries and `training_log` contains saved records
- **THEN** they SHALL verify FitClaw reads `training_log` before answering, summarizes only available records, and avoids durable writes

#### Scenario: Summarizing captured Feishu summary sessions with saved records
- **WHEN** deterministic evals replay a captured Feishu recent-training summary session and seed `training_log` with saved records
- **THEN** they SHALL verify FitClaw calls `data_bodybuilding_read` with namespace `training_log` before answering, limits tool calls to the required read, and avoids durable writes

#### Scenario: Summarizing with no saved training records
- **WHEN** deterministic evals cover recent-training summaries and `training_log` is missing or empty
- **THEN** they SHALL verify FitClaw states that no saved training records are available instead of inventing training history
