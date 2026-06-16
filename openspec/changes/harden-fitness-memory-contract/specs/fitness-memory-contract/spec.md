## ADDED Requirements

### Requirement: Bodybuilding memory namespaces
FitClaw SHALL define the first-stage bodybuilding memory contract around the existing `user_profile`, `training_log`, `training_plan`, `body_metrics`, `progression`, and `personal_records` Skill data namespaces.

#### Scenario: Using declared namespaces
- **WHEN** a fitness workflow persists durable user facts
- **THEN** it SHALL use one of the declared `bodybuilding` namespaces instead of creating ad hoc namespace names

#### Scenario: Reading existing data
- **WHEN** a workflow updates a namespace that may already contain data
- **THEN** it SHALL read the existing namespace first when needed to avoid losing known facts

### Requirement: Object namespace write contract
FitClaw SHALL treat object namespaces as complete current-state documents written with `mode: "replace"`.

#### Scenario: Updating user profile
- **WHEN** the user provides a new durable profile fact such as goal, equipment, schedule, or injury limitation
- **THEN** FitClaw SHALL write a complete `user_profile` object that preserves still-valid known fields

#### Scenario: Updating current training plan
- **WHEN** the user confirms a generated or adjusted plan should become the current plan
- **THEN** FitClaw SHALL write a complete `training_plan` object with `mode: "replace"`

### Requirement: Array namespace append contract
FitClaw SHALL treat array namespaces as append-only event/history streams for first-stage behavior.

#### Scenario: Logging a workout
- **WHEN** the user records a completed workout
- **THEN** FitClaw SHALL append one structured record to `training_log` and SHALL NOT replace the full history

#### Scenario: Recording body metrics
- **WHEN** the user provides body weight, body fat, circumference, or similar dated metrics
- **THEN** FitClaw SHALL append one structured record to `body_metrics`

#### Scenario: Recording progression
- **WHEN** FitClaw records a load, rep, volume, deload, or plan progression event
- **THEN** it SHALL append one structured record to `progression`

#### Scenario: Recording a personal record
- **WHEN** the user explicitly reports a personal record or FitClaw has enough structured evidence to identify one
- **THEN** FitClaw SHALL append one structured record to `personal_records`

### Requirement: Fitness memory field naming
FitClaw SHALL use snake_case field names for new first-stage fitness memory records.

#### Scenario: Recording load and schedule values
- **WHEN** FitClaw writes weight, duration, schedule, or timestamp fields
- **THEN** it SHALL prefer names such as `weight_kg`, `duration_minutes`, `training_days_per_week`, `created_at`, and `updated_at`

#### Scenario: Encountering older data shapes
- **WHEN** older data uses a different field style such as `weightKg`
- **THEN** FitClaw SHALL avoid rewriting the full history solely for naming cleanup unless a migration change is explicitly approved

### Requirement: User profile minimum shape
FitClaw SHALL define `user_profile` as the current durable profile object for goals, experience, equipment, schedule, injury limits, body basics, and update metadata.

#### Scenario: Capturing first useful profile facts
- **WHEN** the user provides goal, experience, equipment, schedule, or injury data
- **THEN** the stored `user_profile` SHOULD include the provided fields and MAY include `schema_version: 1` and `updated_at`

#### Scenario: Avoiding partial overwrite
- **WHEN** a user provides one new profile fact after a profile already exists
- **THEN** FitClaw SHALL preserve still-valid existing profile fields in the replacement object

### Requirement: Training log minimum shape
FitClaw SHALL define `training_log` records as dated completed workout records with one or more structured exercise entries.

#### Scenario: Recording measurable training
- **WHEN** the user logs a workout with exercise name and measurable training values
- **THEN** a `training_log` record SHOULD include `date`, `exercises`, and per-exercise values such as `sets`, `reps`, `weight_kg`, or `rpe`

#### Scenario: Handling incomplete logs
- **WHEN** the user provides an incomplete workout log that cannot identify an exercise or any measurable value
- **THEN** FitClaw SHALL ask a short clarification question before writing long-term training history

### Requirement: Training plan minimum shape
FitClaw SHALL define `training_plan` as the current active plan object, not a history of all previous plans.

#### Scenario: Saving a generated plan
- **WHEN** FitClaw saves a generated training plan
- **THEN** the plan SHOULD include `name`, `goal`, `days_per_week`, `days`, and per-exercise prescription fields such as `sets`, `reps`, and `rest_seconds`

#### Scenario: Plan adjustment without confirmation
- **WHEN** FitClaw suggests a temporary or tentative plan adjustment
- **THEN** it SHALL NOT replace `training_plan` unless the user clearly asks to save or apply the change

### Requirement: Metrics, progression, and personal record shapes
FitClaw SHALL define `body_metrics`, `progression`, and `personal_records` as dated append-only records with enough context to interpret the value later.

#### Scenario: Appending body metrics
- **WHEN** FitClaw writes `body_metrics`
- **THEN** the record SHOULD include `date` and at least one metric such as `weight_kg`, `body_fat_percent`, or `waist_cm`

#### Scenario: Appending progression
- **WHEN** FitClaw writes `progression`
- **THEN** the record SHOULD include `date`, `type`, and `reason`

#### Scenario: Appending personal records
- **WHEN** FitClaw writes `personal_records`
- **THEN** the record SHOULD include `date`, `exercise`, `metric`, `value`, and `unit`

### Requirement: Memory contract verification
FitClaw SHALL verify future changes that modify fitness memory behavior with deterministic evals or documented manual scenarios.

#### Scenario: Changing data write behavior
- **WHEN** a later change modifies onboarding, training logging, plan saving, metrics, progression, or personal record behavior
- **THEN** it SHALL include an eval or manual scenario showing the expected namespace, write mode, and key fields
