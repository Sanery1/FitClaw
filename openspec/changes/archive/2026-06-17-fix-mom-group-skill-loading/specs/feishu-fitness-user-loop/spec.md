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

#### Scenario: Loading fitness skills in isolated group conversations
- **WHEN** 飞书群聊为每个用户创建隔离会话目录
- **THEN** FitClaw SHALL 仍从 Bot workspace 加载 workspace-level Skill，并注册对应的 `data_<skill>_read/write` 工具
