## ADDED Requirements

### Requirement: User profile preserve eval coverage
FitClaw SHALL protect `user_profile` read-modify-replace behavior with deterministic eval coverage.

#### Scenario: Updating one profile field
- **WHEN** a deterministic eval updates one durable `user_profile` fact while existing profile fields are present
- **THEN** the eval SHALL require reading `user_profile` before writing and SHALL verify the replacement object preserves still-valid existing fields
