## ADDED Requirements

### Requirement: Ambiguous training log eval coverage
FitClaw SHALL protect ambiguous Feishu workout-log handling with deterministic eval coverage.

#### Scenario: Asking for missing exercise before writing a log
- **WHEN** deterministic evals cover a Feishu workout-log prompt that includes measurable training values but omits the exercise or action name
- **THEN** they SHALL verify FitClaw asks a short clarification question and does not call `data_bodybuilding_write`
