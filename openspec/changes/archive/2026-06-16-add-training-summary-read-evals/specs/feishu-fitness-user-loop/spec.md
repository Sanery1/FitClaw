## ADDED Requirements

### Requirement: Training summary read eval coverage
FitClaw SHALL protect recent-training summaries with deterministic eval coverage that verifies saved-log reads and empty-history uncertainty.

#### Scenario: Summarizing saved training records
- **WHEN** deterministic evals cover recent-training summaries and `training_log` contains saved records
- **THEN** they SHALL verify FitClaw reads `training_log` before answering, summarizes only available records, and avoids durable writes

#### Scenario: Summarizing with no saved training records
- **WHEN** deterministic evals cover recent-training summaries and `training_log` is missing or empty
- **THEN** they SHALL verify FitClaw states that no saved training records are available instead of inventing training history
