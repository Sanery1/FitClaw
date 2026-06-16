## Why

FitClaw 现在已经有比较明确的第一阶段产品规格，并且为核心飞书健身流程补充了确定性 eval。但下一步进入实现时，还需要一个单一 checklist 来说明 MVP 到底包含什么、哪些明确不做、每个切片如何验收。否则运行时代码很容易重新漂移到过宽的产品探索。

## What Changes

- 新增一个简洁的第一阶段 MVP checklist 文档，用于约束飞书健身助手实现。
- 将 MVP 工作映射到现有第一阶段闭环：onboarding、计划、记录、复盘、下一练建议、安全、记忆和手机端回复格式。
- 明确非目标，避免第一阶段扩张成完整消费者 App、Web UI、支付、多用户 SaaS 或存储迁移。
- 在 product-direction spec 中增加要求：第一阶段实现工作必须映射到 MVP checklist。
- 不修改运行时工具、存储、依赖或飞书 Bot 代码。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `product-direction`：要求第一阶段实现工作按照 MVP checklist 进行评估。

## Impact

- `docs/FIRST_STAGE_MVP_CHECKLIST.md`
- `openspec/changes/define-first-stage-mvp-checklist/*`
