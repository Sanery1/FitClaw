# Comet Design Handoff

- Change: design-feishu-fitness-user-loop
- Phase: design
- Mode: compact
- Context hash: 5a8750374ded251aa49b9d62a7e40265c3fac7c40c50d6304f396e12d181623e

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/design-feishu-fitness-user-loop/proposal.md

- Source: openspec/changes/design-feishu-fitness-user-loop/proposal.md
- Lines: 1-40
- SHA256: f5fcf3a24851fe4cc7ed4623702c0a200ed787d4213b52d6d651a1b5150b72f8

```md
## Why

`product-direction` 已经确定 FitClaw 第一阶段聚焦飞书、Skill、长期记忆和训练闭环，但还没有定义用户在飞书里每天到底怎么用。这个 change 将飞书健身助手从“入口选择”推进到“可评审的用户流程”，让后续实现、eval 和 Skill 改进都有共同目标。

当前项目已有飞书 Bot、bodybuilding Skill、Skill data namespace 和 10 个飞书 session eval baseline。下一步不应该直接写功能，而应该先明确第一阶段飞书用户闭环、状态读写、成功标准和不做的交互。

## What Changes

- 定义第一阶段飞书健身用户闭环：身份确认、首次建档、训练计划生成/调整、训练记录、训练总结、明日训练安排、伤病/疼痛处理和范围外问题处理。
- 明确飞书只作为第一 adapter：用户流程应能通过飞书运行，但核心教练逻辑不应绑定到飞书消息代码。
- 定义每个用户场景应该读取/写入哪些 Skill data namespace，包括 `user_profile`、`training_log`、`training_plan`、`body_metrics`、`progression`、`personal_records`。
- 定义第一阶段回复风格：移动端可读、短、明确、不过度解释，不依赖 HTML/图片/附件上传。
- 明确不做：完整 App UI、支付/账号系统、多用户运营、复杂提醒系统、图片动作教学发送、完整日历/排课系统。
- 将现有飞书 session eval baseline 作为后续验证起点，而不是一次性人工体验。
- 本 change 只定义流程和规格，不修改运行时代码。

## Capabilities

### New Capabilities

- `feishu-fitness-user-loop`: 定义 FitClaw 第一阶段通过飞书承载的健身用户流程、状态读写、体验边界和验证场景。

### Modified Capabilities

- `product-direction`: 补充“飞书第一入口”下的具体用户闭环要求，使后续 change 必须能映射到可验证的飞书健身场景。

## Impact

- 受影响的 OpenSpec artifact：
  - `openspec/changes/design-feishu-fitness-user-loop/proposal.md`
  - `openspec/changes/design-feishu-fitness-user-loop/design.md`
  - `openspec/changes/design-feishu-fitness-user-loop/specs/feishu-fitness-user-loop/spec.md`
  - `openspec/changes/design-feishu-fitness-user-loop/specs/product-direction/spec.md`
  - `openspec/changes/design-feishu-fitness-user-loop/tasks.md`
- 方向上影响：
  - `packages/mom`: 飞书 Bot adapter 和消息呈现边界。
  - `.fitclaw/skills/bodybuilding`: 用户 onboarding、训练计划、训练记录、安全处理流程。
  - `packages/coding-agent/evals/tasks/session`: 飞书 session baseline 后续应围绕本用户闭环扩展。
- 不新增依赖。
- 不引入破坏性变更。
```

## openspec/changes/design-feishu-fitness-user-loop/design.md

- Source: openspec/changes/design-feishu-fitness-user-loop/design.md
- Lines: 1-128
- SHA256: 556896b02a303cf4b04d76fd3a10107a68987a0a6d4624d8aed63500d5c207c7

[TRUNCATED]

```md
## Context

上一轮 `define-fitclaw-product-direction` 已经把 FitClaw 第一阶段定位为：学习优先的个人 AI 健身教练原型，第一入口是飞书，第一领域能力是 bodybuilding Skill，Skill data namespace 是长期记忆接口。

现有代码与资料已经支持这个方向：

- `packages/mom/src/main.ts` 将飞书消息转换为 `BotContext`，再交给 `AgentRunner`。
- `packages/mom/src/agent.ts` 构建 FitCoach 系统提示词、加载 Skill、注册 `data_<skill>_read/write` 工具，并按 channel/user 维护 runner。
- `BotContext` 已抽象出消息、用户、频道、回复、附件和工作状态，不是完全绑定飞书结构。
- bodybuilding Skill 已声明 `user_profile`、`training_log`、`training_plan`、`body_metrics`、`progression`、`personal_records`。
- `packages/coding-agent/evals/tasks/session` 已有飞书真实场景 baseline，覆盖身份、建档、训练记录、训练总结、明日计划、伤病替换、硬拉安全边界等。

这个 change 不实现代码，而是把飞书用户流程定成产品/工程共同契约。

## Goals / Non-Goals

**Goals:**

- 定义第一阶段飞书用户闭环，让“用户怎么用”变得具体。
- 明确每类对话场景对应的读写动作和 namespace。
- 明确飞书移动端回复限制：短、直接、可读，不依赖外部 HTML、图片文件或复杂卡片。
- 明确哪些场景应该进入 eval baseline。
- 保持核心教练逻辑可迁移：飞书是 adapter，不是业务逻辑归宿。

**Non-Goals:**

- 不实现飞书代码。
- 不新增提醒调度、日历系统或主动推送。
- 不实现动作图片上传，现有 `uploadFile` stub 不在本 change 修复。
- 不设计完整 Web/App UI。
- 不解决多用户 SaaS、账号、计费或权限后台。
- 不重构 `packages/mom`。

## Decisions

### Decision 1: 第一阶段用户闭环采用“日常对话 + 状态读写”

第一阶段不做复杂产品界面，而是让用户通过飞书自然完成这些核心动作：

```text
首次使用
  -> 识别缺少 user_profile
  -> 询问 P0 信息：目标、经验、器械
  -> 逐步补 P1 信息：训练天数、时长、伤病
  -> 写入 user_profile

日常训练
  -> 读取 user_profile / training_plan / recent training_log
  -> 给当天建议或调整
  -> 记录完成训练到 training_log
  -> 必要时更新 progression / personal_records

周期复盘
  -> 读取 training_log / body_metrics / progression
  -> 总结趋势
  -> 给下阶段调整建议
```

这个闭环应该优先服务单个真实用户的连续使用，而不是一次性问答。

### Decision 2: 用户场景分成 8 类

第一阶段飞书用户流程分为：

1. 身份确认：用户问“你是谁/能干什么”。
2. 首次建档：收集目标、经验、器械、频率、伤病。
3. 生成计划：基于画像和器械生成可执行训练计划。
4. 调整计划：根据时间、伤病、器械变化调整已有计划。
5. 记录训练：把用户自然语言训练记录写入 `training_log`。
6. 查询/总结：读取历史并输出近期训练总结。
7. 明日/今日安排：基于计划和近期训练安排下一次训练。
8. 安全边界：疼痛、伤病、极端饮食、范围外问题必须保守处理。

这些场景应作为后续 eval 和 Skill workflow 优化的主轴。

### Decision 3: 每类场景都要定义读写契约

飞书消息不应该只产生一段回复。只要用户提供长期有效事实，就应该写入对应 namespace：

| 场景 | 读取 | 写入 |
```

Full source: openspec/changes/design-feishu-fitness-user-loop/design.md

## openspec/changes/design-feishu-fitness-user-loop/tasks.md

- Source: openspec/changes/design-feishu-fitness-user-loop/tasks.md
- Lines: 1-12
- SHA256: 83aa8b4cdc90641a009f79be96231924910b90c9a05907f3eb89861d5f901d8e

```md
## 1. 飞书用户闭环 Artifacts

- [ ] 1.1 在 `proposal.md` 中定义为什么需要飞书健身用户闭环，以及本 change 不做运行时代码实现。
- [ ] 1.2 在 `design.md` 中定义第一阶段飞书用户流程、读写契约、移动端回复边界和 eval 矩阵。
- [ ] 1.3 新增 `feishu-fitness-user-loop` capability spec，覆盖 onboarding、planning、logging、review、next-session guidance、safety、mobile format 和 verification。
- [ ] 1.4 修改 `product-direction` delta spec，让第一阶段用户体验必须映射到可验证的飞书用户闭环。

## 2. 评审与验证

- [ ] 2.1 使用 `openspec validate design-feishu-fitness-user-loop` 验证 OpenSpec change artifacts。
- [ ] 2.2 和用户一起评审飞书用户闭环：确认哪些场景是第一阶段必须做，哪些推迟到后续。
- [ ] 2.3 用户确认后，进入 design 阶段，细化技术设计和后续实现切片。
```

## openspec/changes/design-feishu-fitness-user-loop/specs/feishu-fitness-user-loop/spec.md

- Source: openspec/changes/design-feishu-fitness-user-loop/specs/feishu-fitness-user-loop/spec.md
- Lines: 1-85
- SHA256: a118c2518c5068de5f3d93360983db8aba318bd5d19964a9a8f1f4ccc484a993

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: Feishu first-stage user loop
FitClaw SHALL define the first-stage Feishu experience as a conversational fitness coaching loop covering onboarding, planning, logging, review, next-session guidance, and safety handling.

#### Scenario: User starts from no profile
- **WHEN** 飞书用户首次请求健身帮助且没有完整 `user_profile`
- **THEN** FitClaw SHALL 优先收集目标、经验和可用器械，并避免一次性询问过多信息

#### Scenario: User returns with saved context
- **WHEN** 飞书用户已有 `user_profile`、`training_plan` 或 `training_log`
- **THEN** FitClaw SHALL 在给训练建议、记录训练或安排下一次训练前使用这些已保存上下文

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
FitClaw SHALL parse natural-language workout logs in Feishu and persist completed training to `training_log`.

#### Scenario: User logs a workout
- **WHEN** 用户说“记录今天卧推60kg 5x5，RPE 8”或等价训练记录
- **THEN** FitClaw SHALL append structured data to `training_log` and confirm the saved record in concise text

#### Scenario: User mentions a personal record
- **WHEN** 用户明确表示某个动作创造个人记录
- **THEN** FitClaw SHALL append the workout to `training_log` and update `personal_records` when enough data is available

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
```

Full source: openspec/changes/design-feishu-fitness-user-loop/specs/feishu-fitness-user-loop/spec.md

## openspec/changes/design-feishu-fitness-user-loop/specs/product-direction/spec.md

- Source: openspec/changes/design-feishu-fitness-user-loop/specs/product-direction/spec.md
- Lines: 1-20
- SHA256: d29b6a5b391c924bd4756fa24b79d60a70abff15fbcd35d8bcaaf0d40e4b023f

```md
## MODIFIED Requirements

### Requirement: First-stage surface boundary
FitClaw SHALL 将飞书视为第一阶段健身助手最实际的用户触达面，并 SHALL 将 CLI/TUI 视为第一阶段的开发、调试和学习界面。第一阶段飞书体验 SHALL 被定义为可验证的用户闭环，而不是泛泛的聊天入口。

#### Scenario: Choosing where to implement user-facing fitness behavior
- **WHEN** 某个行为属于第一阶段日常健身助手体验
- **THEN** 该行为 SHALL 被设计为可通过飞书 Bot 运行，而不要求专门的 Web UI

#### Scenario: Keeping coaching logic portable
- **WHEN** 实现用户画像读取、训练记录写入、计划调整、安全判断或周期复盘等核心教练行为
- **THEN** 这些行为 SHALL 避免绑定到飞书消息适配代码，并优先沉淀在 Skill、Agent workflow、data contract 或可复用服务边界中

#### Scenario: Mapping work to Feishu user loop
- **WHEN** 后续 change 声称改善第一阶段用户体验
- **THEN** 它 SHALL 说明自己改善的是飞书用户闭环中的 onboarding、planning、logging、review、next-session guidance 或 safety handling 哪一类场景

#### Scenario: Evaluating TUI work
- **WHEN** 后续 change 提出 TUI 相关工作
- **THEN** 该工作 SHALL 被解释为支持开发、调试、Agent 学习或既有 coding-agent 运行，而不是作为主要健身产品界面
```

