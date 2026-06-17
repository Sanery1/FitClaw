## ADDED Requirements

### Requirement: Feishu Skill tool runtime alignment
FitClaw SHALL keep Mom's active `data_<skill>_read/write` tools aligned with the Skill declarations loaded for the current Feishu message run.

#### Scenario: Refreshing Skill data tools after workspace Skill changes
- **WHEN** a Feishu channel runner already exists and workspace-level Skill declarations change before a later message
- **THEN** FitClaw SHALL refresh the active Mom tool list so newly loaded Skill data namespaces have matching `data_<skill>_read/write` tools available for that message
