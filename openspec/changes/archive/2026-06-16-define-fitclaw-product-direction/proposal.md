## Why

FitClaw 目前同时像一个通用 AI coding-agent 平台，也像一个基于 Skill、长期记忆和飞书的 AI 健身助手。这个 change 的目标是先定义第一阶段产品方向，让后续工作能围绕清晰边界判断优先级，而不是因为底层 Agent 框架“能做”就不断扩展功能。

当前代码库已经有一些健身场景的真实资产，包括 bodybuilding Skill、Skill data 持久化 namespace、飞书 Bot 适配器和确定性 eval 任务。下一步更有价值的不是大规模重写产品，而是先形成一个小而明确的契约：FitClaw 想成为哪里、第一阶段刻意不做什么、以及继续实现前哪些能力必须保持一致。

## What Changes

- 将 FitClaw 第一阶段定位为学习驱动的个人 AI 健身教练原型，重点关注长期记忆、训练连续性和 Skill 支撑的教练工作流。
- 将飞书确定为第一阶段最实际的用户触达面；CLI/TUI 保留为开发、调试和学习 Agent 架构的界面，而不是第一阶段主要用户产品。
- 明确 `web-ui`、`pods` 和泛 coding-agent 能力不是第一阶段产品优先级，除非它们直接服务健身教练学习闭环。
- 定义第一阶段产品方向契约，包括目标用户、核心用户循环、非目标、证据来源和后续 change 的判断标准。
- 保留现有架构方向：Agent runtime 继续保持通用，健身领域知识、流程和数据沉淀在 Skill、references、scripts 和 Skill data namespaces 中。
- 本 change 不引入应用行为变化，只作为产品/规格层面的方向定义，指导后续实现。

## Capabilities

### New Capabilities

- `product-direction`: 定义 FitClaw 的产品定位、第一阶段范围、非目标、核心用户循环，以及后续健身助手相关工作的准入标准。

### Modified Capabilities

- 无。当前 `openspec/specs/` 下没有既有 spec。

## Impact

- 受影响的 OpenSpec artifact：
  - `openspec/changes/define-fitclaw-product-direction/proposal.md`
  - `openspec/changes/define-fitclaw-product-direction/design.md`
  - `openspec/changes/define-fitclaw-product-direction/specs/product-direction/spec.md`
  - `openspec/changes/define-fitclaw-product-direction/tasks.md`
- 方向上会影响这些系统的后续判断：
  - `packages/coding-agent`: 开发界面、Skill 加载、Skill data 工具、eval harness。
  - `packages/mom`: 第一阶段飞书用户触达面。
  - `.fitclaw/skills/bodybuilding`: 当前健身领域知识、脚本、动作数据库和持久化 namespace。
  - `docs/PROJECT_UNDERSTANDING.md`、`docs/QNA.md`、`CLAUDE.md`、`README.md`: change 通过后，后续文档可能需要同步这个方向。
- 不新增依赖。
- 不引入破坏性变更。
