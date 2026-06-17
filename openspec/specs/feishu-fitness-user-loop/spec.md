## Purpose

定义 FitClaw 第一阶段通过飞书承载的健身用户闭环、状态读写、移动端体验边界和验证要求。

## Requirements

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

### Requirement: Feishu onboarding flow
FitClaw SHALL use progressive onboarding in Feishu, collecting only enough high-value information to start coaching and saving durable facts immediately.

#### Scenario: Capturing P0 onboarding facts
- **WHEN** 用户提供训练目标、经验或器械信息
- **THEN** FitClaw SHALL 写入 `data_bodybuilding_write("user_profile", ...)`

#### Scenario: Missing injury information
- **WHEN** 用户请求训练计划但没有伤病/限制信息
- **THEN** FitClaw SHALL 用简短问题确认是否有伤病或动作限制，而不是假设没有风险

### Requirement: Feishu training plan flow
FitClaw SHALL generate or adjust training plans in Feishu using the bodybuilding Skill, saved profile data, available equipment, schedule constraints, and safety limits.

#### Scenario: Generating a first plan
- **WHEN** 用户已提供目标、经验、器械和每周训练天数，并请求训练计划
- **THEN** FitClaw SHALL 生成移动端可读的训练计划，并写入 `training_plan`

#### Scenario: Adjusting an existing plan
- **WHEN** 用户表示时间、器械、疼痛或恢复状态发生变化
- **THEN** FitClaw SHALL 基于当前 `training_plan` 给出最小必要调整，并仅在用户确认或明确请求时更新 `training_plan`

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

### Requirement: Feishu review and next-session flow
FitClaw SHALL use saved training data to summarize recent training and suggest the next session without inventing unavailable history.

#### Scenario: User asks for recent training summary
- **WHEN** 用户请求总结近期训练
- **THEN** FitClaw SHALL read `training_log` and summarize only available records

#### Scenario: User asks what to train tomorrow
- **WHEN** 用户请求安排明天或下一次训练
- **THEN** FitClaw SHALL use `training_plan` and recent `training_log` when available, and state uncertainty if plan data is missing

### Requirement: Feishu safety and boundary flow
FitClaw SHALL handle pain, injury, unsafe requests, and non-fitness questions conservatively in Feishu.

#### Scenario: User reports pain before heavy lifting
- **WHEN** 用户报告疼痛并要求冲大重量或 1RM
- **THEN** FitClaw SHALL discourage aggressive loading, explain risk briefly, and suggest safer alternatives or professional assessment

#### Scenario: User asks a non-fitness real-time question
- **WHEN** 用户询问天气、新闻、股票或其他非健身实时信息
- **THEN** FitClaw SHALL avoid fabricating data and redirect to fitness scope

### Requirement: Feishu mobile response format
FitClaw SHALL optimize first-stage Feishu responses for mobile readability and avoid output formats that cannot be displayed reliably in Feishu.

#### Scenario: Returning a training plan
- **WHEN** FitClaw sends a training plan in Feishu
- **THEN** the response SHALL use concise text sections and bullets instead of HTML files, external images, ASCII diagrams, or large tables

#### Scenario: Returning progress data
- **WHEN** FitClaw summarizes progress in Feishu
- **THEN** the response SHALL emphasize key numbers and trends in plain text

### Requirement: Feishu loop verification
FitClaw SHALL protect the first-stage Feishu user loop with deterministic eval or documented manual scenarios before treating workflow changes as complete.

#### Scenario: Adding a new Feishu workflow behavior
- **WHEN** 后续 change adds or changes onboarding, logging, planning, review, or safety behavior
- **THEN** it SHALL include a deterministic eval or a documented manual Feishu scenario that verifies the behavior

### Requirement: Ambiguous training log eval coverage
FitClaw SHALL protect ambiguous Feishu workout-log handling with deterministic eval coverage.

#### Scenario: Asking for missing exercise before writing a log
- **WHEN** deterministic evals cover a Feishu workout-log prompt that includes measurable training values but omits the exercise or action name
- **THEN** they SHALL verify FitClaw asks a short clarification question and does not call `data_bodybuilding_write`

### Requirement: Next-session guidance eval coverage
FitClaw SHALL protect next-session guidance with deterministic eval coverage that verifies saved-context reads and missing-data uncertainty across synthetic and captured Feishu session evals.

#### Scenario: Answering next-session guidance with saved context
- **WHEN** deterministic evals cover next-session guidance and both `training_plan` and recent `training_log` are available
- **THEN** they SHALL verify FitClaw reads those namespaces before answering and does not write durable data unless the user confirms a plan change

#### Scenario: Answering next-session guidance without a saved plan
- **WHEN** deterministic evals cover next-session guidance and `training_plan` is missing
- **THEN** they SHALL verify FitClaw states uncertainty or missing plan data instead of inventing a current plan

#### Scenario: Replaying captured Feishu next-session sessions without a saved plan
- **WHEN** deterministic evals replay a captured Feishu next-session prompt and only recent `training_log` is seeded
- **THEN** they SHALL verify FitClaw attempts to read `training_plan`, reads recent `training_log`, states that the current plan is missing or uncertain, and avoids durable writes

### Requirement: Training summary read eval coverage
FitClaw SHALL protect recent-training summaries with deterministic eval coverage that verifies saved-log reads and empty-history uncertainty across synthetic and captured Feishu session evals.

#### Scenario: Summarizing saved training records
- **WHEN** deterministic evals cover recent-training summaries and `training_log` contains saved records
- **THEN** they SHALL verify FitClaw reads `training_log` before answering, summarizes only available records, and avoids durable writes

#### Scenario: Summarizing captured Feishu summary sessions with saved records
- **WHEN** deterministic evals replay a captured Feishu recent-training summary session and seed `training_log` with saved records
- **THEN** they SHALL verify FitClaw calls `data_bodybuilding_read` with namespace `training_log` before answering, limits tool calls to the required read, and avoids durable writes

#### Scenario: Summarizing with no saved training records
- **WHEN** deterministic evals cover recent-training summaries and `training_log` is missing or empty
- **THEN** they SHALL verify FitClaw states that no saved training records are available instead of inventing training history

### Requirement: Safety and onboarding eval coverage
FitClaw SHALL protect onboarding safety gates and pain-related safety boundaries with deterministic eval coverage.

#### Scenario: Requesting a plan without injury information
- **WHEN** deterministic evals cover plan generation and the user has not provided injury or movement-limitation information
- **THEN** they SHALL verify FitClaw asks a short clarification question and does not save a training plan before the safety gate is answered

#### Scenario: Reporting pain before heavy lifting
- **WHEN** deterministic evals cover a user reporting pain while asking for aggressive loading or a 1RM attempt
- **THEN** they SHALL verify FitClaw discourages aggressive loading, explains risk briefly, and avoids writing durable plan or log data

### Requirement: Feishu Skill tool runtime alignment
FitClaw SHALL keep Mom's active `data_<skill>_read/write` tools aligned with the Skill declarations loaded for the current Feishu message run.

#### Scenario: Refreshing Skill data tools after workspace Skill changes
- **WHEN** a Feishu channel runner already exists and workspace-level Skill declarations change before a later message
- **THEN** FitClaw SHALL refresh the active Mom tool list so newly loaded Skill data namespaces have matching `data_<skill>_read/write` tools available for that message
