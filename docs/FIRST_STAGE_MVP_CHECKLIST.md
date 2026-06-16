# FitClaw 第一阶段 MVP Checklist

## 产品意图

FitClaw 第一阶段是一个学习优先的个人 AI 健身教练原型。用户入口优先选择飞书。产品价值不是完整健身 App UI，而是一个可靠的教练闭环：能记住有用的健身事实，在后续回复中使用它们，并在安全问题上保持保守。

## MVP 入口

- 飞书是第一用户入口。
- `bodybuilding` 是第一领域 Skill。
- Skill data namespace 是稳定记忆接口。
- JSON 存储是第一阶段 backend，不是长期生产存储答案。
- CLI/TUI 继续作为开发、调试和 Agent 学习界面。

## 必须具备的用户流程

### 1. Onboarding

- 只收集开始指导所需的高价值事实：
  - 目标；
  - 训练经验；
  - 可用器械；
  - 每周训练天数或时间安排；
  - 伤病或动作限制。
- 将长期有效的用户画像事实保存到 `user_profile`。
- 如果用户在伤病信息未知时请求训练计划，先追问一个简短安全问题，再保存计划。

验收：

- `feishu-plan-missing-injury-gate`
- `bodybuilding-profile-preserve`
- `feishu-2026-05-08-profile-capture`

### 2. 计划生成与调整

- 只有在用户画像和安全上下文足够时，才生成适合手机阅读的训练计划。
- 已确认的当前计划写入 `training_plan`，使用 `mode: replace`。
- 对临时调整建议，不要替换 `training_plan`，除非用户明确要求保存或应用。

验收：

- `bodybuilding-plan-confirmed-replace`
- `bodybuilding-plan-suggest-no-save`
- `feishu-next-session-with-context`
- `feishu-next-session-missing-plan`

### 3. 训练记录

- 解析简单自然语言中的已完成训练。
- 将已完成训练追加到 `training_log`。
- 如果记录缺少动作或可衡量训练值，追问一个简短澄清问题。
- 只有当用户明确报告 PR，或提供足够结构化证据时，才追加个人记录。

验收：

- `bodybuilding-log`
- `feishu-2026-05-08-training-log`
- `bodybuilding-personal-record`

### 4. 复盘与下一练建议

- 只基于已保存的 `training_log` 做总结。
- 如果没有已保存训练数据，明确说明没有数据，不要编造趋势。
- 生成下一练建议时，优先读取可用的 `training_plan` 和近期 `training_log`。
- 如果 `training_plan` 缺失，说明不确定性，不要编造当前计划。

验收：

- `feishu-training-summary-with-log`
- `feishu-training-summary-empty-log`
- `feishu-next-session-with-context`
- `feishu-next-session-missing-plan`

### 5. 指标与进阶

- 将身体指标追加到 `body_metrics`。
- 将训练进阶事件追加到 `progression`。
- 第一阶段新增健身记录字段使用 snake_case。

验收：

- `bodybuilding-body-metrics`
- `bodybuilding-progression`

### 6. 安全边界

- 当用户报告疼痛、伤病、医疗限制或不安全负重时，回复应保持保守。
- 疼痛存在时，不鼓励 1RM 测试或激进加重。
- 适当建议更安全替代动作、休息或寻求专业评估。
- 对不安全或未确认场景，不写入长期计划或训练日志。

验收：

- `feishu-pain-heavy-lift-boundary`
- `feishu-2026-05-08-deadlift-safety`
- `feishu-2026-05-08-weather-boundary`

## 记忆契约

对象/当前状态 namespace：

- `user_profile`：完整对象，`mode: replace`
- `training_plan`：完整对象，`mode: replace`

数组/历史记录 namespace：

- `training_log`：追加一条已完成训练记录
- `body_metrics`：追加一条身体指标记录
- `progression`：追加一条进阶事件
- `personal_records`：追加一条 PR 记录

字段命名：

- 新字段优先使用 snake_case，例如 `weight_kg`、`days_per_week`、`training_days_per_week`、`duration_minutes`、`rest_seconds`、`created_at`、`updated_at`。
- 不为了字段名清理而重写旧历史记录。

## 第一阶段非目标

- 完整消费者移动 App。
- 作为主要用户界面的 Web dashboard。
- 支付、订阅或商业化系统。
- 多用户 SaaS 运营。
- 远端 GPU/vLLM pod 管理。
- 广泛 Skill 市场。
- 在 namespace 契约稳定前迁移存储 backend。
- 超出简单安全计划生成与调整的复杂周期化训练引擎。

## 验证门槛

第一阶段 change 至少满足以下任一条件，才应该被接受：

- 通过覆盖该行为的现有确定性 eval。
- 为该行为新增或更新确定性 eval。
- 当确定性 eval 暂时不现实，文档化一个窄范围手动飞书场景。

代码或 eval 变更后的必需检查：

- Skill 记忆行为变化时，运行 `npm run eval -- --suite skills`。
- 飞书闭环行为变化时，运行 `npm run eval -- --suite session`。
- 运行 `npx openspec validate --specs`。
- 运行 `npm run check`。

## 建议的下一步实现顺序

1. 对照确定性 eval 审计真实飞书运行行为。
2. 修复 `user_profile`、`training_plan`、`training_log` 的第一个读写不一致点。
3. 让真实飞书流程中的下一练建议先读取已保存上下文。
4. 让真实飞书流程中的训练总结先读取已保存的 `training_log`。
5. 在保存生成计划前强制执行伤病信息 gate。
6. 为完整 MVP 闭环补充手动飞书 smoke 场景。

## MVP 完成标准

第一阶段 MVP 可以被认为是自洽的条件：

- 新用户能提供画像事实，并得到安全的下一步；
- 老用户能记录训练并请求总结；
- 老用户能询问下一练，并得到基于上下文的建议；
- 长期记忆写入遵循 namespace 契约；
- 不安全请求被保守处理；
- 核心流程由确定性 eval 或文档化手动场景覆盖。
