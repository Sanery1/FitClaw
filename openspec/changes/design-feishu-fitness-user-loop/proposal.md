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
