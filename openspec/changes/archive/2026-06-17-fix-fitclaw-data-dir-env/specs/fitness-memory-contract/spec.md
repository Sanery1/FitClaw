## ADDED Requirements

### Requirement: Skill data root environment alignment
FitClaw SHALL expose `FITCLAW_DATA_DIR` as the root directory used by `FileSportDataStore`, so Agent data tools and `fitclaw-data` CLI access resolve to the same `sport-data/<skill>/<namespace>.json` files.

#### Scenario: Script reads data written by Agent data tool
- **WHEN** `data_bodybuilding_write` persists `bodybuilding/training_log` for a session or Feishu channel
- **THEN** a script using `fitclaw-data read --namespace bodybuilding/training_log` with `FITCLAW_DATA_DIR` from that runtime SHALL read the same JSON file rather than a nested `sport-data/sport-data` path
