## Context

项目方向是学习优先，但第一阶段产品闭环已经足够具体，可以开始实现和验证。当前风险不是缺少想法，而是在飞书健身闭环可靠之前，把精力分散到 UI、基础设施和过宽的 Agent 能力上。

这个 checklist 应该是一个小型规划 artifact，而不是新的架构层。

## Approach

- 创建 `docs/FIRST_STAGE_MVP_CHECKLIST.md`。
- 保持内容可执行：
  - 当前产品意图；
  - MVP 入口和非目标；
  - 必须具备的用户流程；
  - 数据/记忆要求；
  - 验证门槛；
  - 推荐的下一步实现顺序。
- 引用现有规格和 eval suite 作为证据。
- 增加一个小的 product-direction requirement，让后续第一阶段工作在实现前先映射到 checklist。

## Non-Goals

- 不做运行时代码变更。
- 不增加新工具或依赖。
- 不迁移存储 backend。
- 不重设计 UI。
- 不扩展商业化路线图。
