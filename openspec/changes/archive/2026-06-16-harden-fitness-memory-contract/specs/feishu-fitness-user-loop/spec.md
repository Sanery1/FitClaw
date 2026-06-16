## MODIFIED Requirements

### Requirement: Feishu first-stage user loop
FitClaw SHALL define the first-stage Feishu experience as a conversational fitness coaching loop covering onboarding, planning, logging, review, next-session guidance, and safety handling. Durable facts learned through the Feishu loop SHALL follow the `fitness-memory-contract` namespace and write-mode requirements.

#### Scenario: User starts from no profile
- **WHEN** 飞书用户首次请求健身帮助且没有完整 `user_profile`
- **THEN** FitClaw SHALL 优先收集目标、经验和可用器械，并避免一次性询问过多信息

#### Scenario: User returns with saved context
- **WHEN** 飞书用户已有 `user_profile`、`training_plan` 或 `training_log`
- **THEN** FitClaw SHALL 在给训练建议、记录训练或安排下一次训练前使用这些已保存上下文

#### Scenario: Persisting facts from Feishu
- **WHEN** 飞书对话产生长期有效的健身事实
- **THEN** FitClaw SHALL 按 `fitness-memory-contract` 选择 namespace、字段形状和 `replace` / `append` 写入模式

### Requirement: Feishu training log flow
FitClaw SHALL parse natural-language workout logs in Feishu and persist completed training to `training_log` using the append-only record contract.

#### Scenario: User logs a workout
- **WHEN** 用户说“记录今天卧推60kg 5x5，RPE 8”或等价训练记录
- **THEN** FitClaw SHALL append structured data to `training_log` and confirm the saved record in concise text

#### Scenario: User mentions a personal record
- **WHEN** 用户明确表示某个动作创造个人记录
- **THEN** FitClaw SHALL append the workout to `training_log` and update `personal_records` when enough data is available

#### Scenario: User gives an ambiguous workout log
- **WHEN** 用户的训练记录缺少动作名称或任何可衡量训练值
- **THEN** FitClaw SHALL ask a short clarification question before writing `training_log`
