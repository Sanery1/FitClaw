## Why

The Feishu loop spec requires recent-training summaries to read `training_log` and summarize only available records, but the existing session eval checks final wording without verifying the saved-context read. Deterministic read coverage reduces the risk of plausible but invented summaries.

## What Changes

- Add a session eval that reads `training_log` before summarizing existing records.
- Add a session eval that reads an empty/missing `training_log`, states no records are available, and avoids invented trends.
- Add a Feishu loop verification requirement for training-summary read eval coverage.
- Do not change runtime tools, storage, dependencies, or Feishu bot code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `feishu-fitness-user-loop`: Require deterministic eval coverage for training-summary reads and empty-history handling.

## Impact

- `packages/coding-agent/evals/tasks/session/feishu-training-summary-with-log.yaml`
- `packages/coding-agent/evals/tasks/session/feishu-training-summary-empty-log.yaml`
- `openspec/changes/add-training-summary-read-evals/*`
