## ADDED Requirements

### Requirement: Training plan confirmation eval coverage
FitClaw SHALL protect `training_plan` confirmation boundaries with deterministic eval coverage.

#### Scenario: Suggesting a tentative plan adjustment
- **WHEN** a deterministic eval suggests a temporary or tentative training plan adjustment
- **THEN** the eval SHALL verify `training_plan` is not replaced unless the user clearly asks to save or apply the change

#### Scenario: Saving a confirmed plan
- **WHEN** a deterministic eval saves a generated or adjusted training plan after clear user confirmation
- **THEN** the eval SHALL verify `training_plan` is written with `mode: "replace"` and includes key current-plan fields
