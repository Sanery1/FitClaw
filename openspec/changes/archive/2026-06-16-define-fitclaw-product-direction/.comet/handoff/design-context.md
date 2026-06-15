# Comet Design Handoff

- Change: define-fitclaw-product-direction
- Phase: design
- Mode: compact
- Context hash: 8b40afdf3c4810a978ac1bf9c8e58e545ca8851183d7040b0da9f37d8f8d5d19

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/define-fitclaw-product-direction/proposal.md

- Source: openspec/changes/define-fitclaw-product-direction/proposal.md
- Lines: 1-39
- SHA256: ff2febcbb632458f104f85ee22105a613fa4117745926e2184e242ffc1982f8a

```md
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
```

## openspec/changes/define-fitclaw-product-direction/design.md

- Source: openspec/changes/define-fitclaw-product-direction/design.md
- Lines: 1-162
- SHA256: e77301a33a1097c8ab0a8a0ba828e60c53c93ede3eaa69c12e0c4fda01dfff03

[TRUNCATED]

```md
## Context

FitClaw 是一个 TypeScript monorepo，底层有通用 Agent runtime，上层有多个应用入口。当前文档同时把它描述为“AI 运动私教”和“智能编程助手”，代码结构也确实体现了这种双重身份：

- `packages/ai` 和 `packages/agent` 提供可复用的 LLM 抽象层和 Agent runtime。
- `packages/coding-agent` 提供主 CLI/TUI 开发入口、Skill 加载、Skill data 工具和 eval harness。
- `packages/mom` 将 Agent 接入飞书。
- `.fitclaw/skills/bodybuilding` 已经包含健身领域 Skill，包括 800+ 动作、用户 onboarding 指南、训练计划资料、查询脚本和持久化数据 namespace。
- `.fitclaw/skills/swimming-coach` 已存在，但当前产品讨论重点是健身教练闭环，而不是多运动平台。
- `packages/web-ui` 和 `packages/pods` 已存在，但第一阶段健身助手体验并不依赖它们。

用户当前动机是：以学习心态理解和搭建 Agent，并选择健身这个适合长期记忆和个性化的具体场景来推进。因此第一阶段产品方向需要同时承认两件事：

1. 它目前仍然是学习项目。
2. 这个学习项目应该围绕一个真实、可能有用的产品闭环来组织。

## Goals / Non-Goals

**Goals:**

- 定义清晰的第一阶段产品身份：一个通过长期记忆和 Skill 工作流逐步变得更了解用户的个人 AI 健身教练。
- 将飞书作为第一阶段最实际的用户触达面，因为它天然适合 check-in、提醒和日常习惯形成，而且不需要先做完整 App。
- 保留 Agent 学习价值：runtime、工具调用、Skill 加载、记忆、eval 和飞书集成都应该继续可观察、可理解。
- 明确哪些事情不是第一阶段工作，降低范围模糊。
- 给后续 change 提供判断标准，让实现保持小而一致。

**Non-Goals:**

- 本 change 不构建或重设计 UI。
- 本 change 不删除 `web-ui`、`pods`、`tui` 或 coding-agent 代码。
- 不宣称具备医疗、康复或认证私教资质。
- 第一阶段不和 Keep、Fitbod、Hevy、Future 这类产品拼完整 App 广度。
- 不引入支付、账号系统、多用户 SaaS 运营或模型市场能力。
- 不为了产品方向本身新增数据库或外部服务。

## Decisions

### Decision 1: 将 FitClaw 定位为学习优先的产品原型

FitClaw 应该被定义为一个有产品纪律的严肃学习项目，而不是一个已经完全生产化的健身商业产品。这样更容易诚实评估当前代码：粗糙之处可以接受，只要它服务 Agent 设计学习；但后续工作仍然应该服务一个具体用户闭环。

第一阶段产品句子：

> FitClaw 是一个个人 AI 健身教练原型，通过 Skill、持久化记忆和飞书对话，帮助单个用户记录训练、保留上下文，并获得越来越个性化的训练建议。

### Decision 2: 将第一阶段用户循环收窄

第一阶段循环应该是：

```text
用户 check-in
  -> 读取用户画像 / 当前计划 / 近期训练记录
  -> 只追问缺失的高价值信息
  -> 给出安全训练建议或记录已完成训练
  -> 立即持久化新事实
  -> 在后续建议中使用累计历史
```

这个循环比增加页面、平台或更多运动品类更重要。它直接锻炼最有学习价值的 Agent 能力：记忆、工具调用、Skill 触发、数据写入和行为评估。

### Decision 3: 飞书是第一触达面，不是护城河本身

飞书有价值，是因为它以很低产品构建成本提供了一个日常对话入口。但飞书本身不是最终护城河。真正可能形成壁垒的是这些东西的组合：

- 个人训练历史；
- 结构化 Skill 数据；
- 可重复执行的教练工作流；
- eval 保护的行为契约；
- 适合日常习惯形成的消息入口。

如果未来飞书成为限制，架构应允许迁移到其他入口。第一阶段应避免把产品逻辑硬编码进飞书专属代码；能沉淀到 Skill 或工作流契约的行为，应尽量放在更通用的位置。

设计原则：

```text
Core Coaching Loop
  ├─ Feishu Bot adapter
  ├─ CLI/TUI debug adapter
  ├─ future Web dashboard
  └─ future mobile/PWA or other bot adapter
```

Full source: openspec/changes/define-fitclaw-product-direction/design.md

## openspec/changes/define-fitclaw-product-direction/tasks.md

- Source: openspec/changes/define-fitclaw-product-direction/tasks.md
- Lines: 1-11
- SHA256: 14d3857f5dba69b3a617fe6b47159cee8a8faaad91f15836625cb92507ae3e9e

```md
## 1. 产品方向 Artifacts

- [ ] 1.1 在 `proposal.md` 中定义第一阶段产品定位、目标用户循环、范围、非目标和影响。
- [ ] 1.2 在 `design.md` 中沉淀设计理由、关键取舍，以及包/入口边界。
- [ ] 1.3 添加 `product-direction` capability spec，并写清可测试的 requirements 和 scenarios。

## 2. 评审与验证

- [ ] 2.1 使用 `openspec validate define-fitclaw-product-direction` 验证 OpenSpec change artifacts。
- [ ] 2.2 和用户一起评审 artifacts，在进入实现计划前修正产品方向。
- [ ] 2.3 用户确认后，识别第一个实现切片：它应改善飞书健身教练闭环，并避免大规模重构。
```

## openspec/changes/define-fitclaw-product-direction/specs/product-direction/spec.md

- Source: openspec/changes/define-fitclaw-product-direction/specs/product-direction/spec.md
- Lines: 1-93
- SHA256: 7ef4c8efb873d88d1006370f60e9833752e3042b27ec1bc2518aa866c429c6b8

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: First-stage positioning
FitClaw SHALL 将第一阶段产品身份定义为学习优先的个人 AI 健身教练原型，重点关注长期记忆、Skill 支撑的教练工作流，以及基于飞书的日常交互。

#### Scenario: Evaluating a proposed feature
- **WHEN** 后续 change 提出一项新能力
- **THEN** 该能力 SHALL 根据它是否改善个人健身教练闭环、Agent 学习价值，或必要的安全/可靠性边界来评估

#### Scenario: Describing the product
- **WHEN** 在项目规划 artifact 中描述 FitClaw
- **THEN** 描述 SHALL 避免宣称 FitClaw 已经是生产可用的消费者健身 App

### Requirement: Core user loop
FitClaw SHALL 优先服务一个收窄的第一阶段循环：读取用户上下文、追问缺失的高价值信息、提供安全训练建议或记录已完成训练、持久化新事实，并在后续回复中使用已保存历史。

#### Scenario: New user onboarding
- **WHEN** 用户还没有完整健身画像
- **THEN** FitClaw SHALL 只收集开始有效指导所需的最小高价值信息，包括目标、经验、器械、可训练时间和伤病限制

#### Scenario: Returning user interaction
- **WHEN** 老用户请求训练建议或记录一次训练
- **THEN** 如果用户画像、当前计划和近期训练历史存在，FitClaw SHALL 使用这些持久化数据

#### Scenario: New information is learned
- **WHEN** 用户提供目标、器械、伤病限制、训练完成情况、身体数据或个人记录等长期有效训练事实
- **THEN** FitClaw SHALL 通过合适的 Skill data namespace 持久化这些信息，而不是只依赖当前对话上下文

### Requirement: First-stage surface boundary
FitClaw SHALL 将飞书视为第一阶段健身助手最实际的用户触达面，并 SHALL 将 CLI/TUI 视为第一阶段的开发、调试和学习界面。

#### Scenario: Choosing where to implement user-facing fitness behavior
- **WHEN** 某个行为属于第一阶段日常健身助手体验
- **THEN** 该行为 SHALL 被设计为可通过飞书 Bot 运行，而不要求专门的 Web UI

#### Scenario: Keeping coaching logic portable
- **WHEN** 实现用户画像读取、训练记录写入、计划调整、安全判断或周期复盘等核心教练行为
- **THEN** 这些行为 SHALL 避免绑定到飞书消息适配代码，并优先沉淀在 Skill、Agent workflow、data contract 或可复用服务边界中

#### Scenario: Evaluating TUI work
- **WHEN** 后续 change 提出 TUI 相关工作
- **THEN** 该工作 SHALL 被解释为支持开发、调试、Agent 学习或既有 coding-agent 运行，而不是作为主要健身产品界面

### Requirement: Skill capability package boundary
FitClaw SHALL 将 bodybuilding Skill 视为第一阶段领域能力包，而不是单纯自然语言 prompt；后续增强 SHALL 优先增加结构化约束、权限声明、确定性脚本和 eval 覆盖。

#### Scenario: Extending bodybuilding behavior
- **WHEN** 后续 change 增强 bodybuilding Skill 的训练计划、训练记录、动作查询或安全建议能力
- **THEN** 该 change SHALL 优先评估是否需要补充 schema、manifest、script 或 eval，而不是只增加更长的提示词说明

#### Scenario: Adding another sport skill
- **WHEN** 后续 change 增加新的运动 Skill
- **THEN** 该 Skill SHALL 复用领域能力包思路，至少说明触发条件、数据 namespace、核心工作流和可验证场景

### Requirement: Memory backend portability
FitClaw SHALL 将 Skill data namespace 视为稳定记忆接口，并 SHALL 将当前 JSON 文件存储视为第一阶段 backend，而不是不可替换的最终存储方案。

#### Scenario: Persisting durable fitness facts
- **WHEN** 用户提供目标、伤病、器械、训练日志、计划、身体数据或个人记录等持久事实
- **THEN** FitClaw SHALL 优先写入结构化 Skill data namespace，而不是只写入自由文本记忆或向量索引

#### Scenario: Evolving storage backend
- **WHEN** 后续 change 需要引入 schema version、append-only log、SQLite、PostgreSQL 或语义检索
- **THEN** 该 change SHALL 尽量保持 `data_<skill>_read/write` namespace 接口稳定，并将底层存储演进作为 backend 替换处理

### Requirement: Scope exclusions
FitClaw SHALL 在第一阶段产品方向中明确排除完整消费者 App 广度、支付系统、多用户 SaaS 运营、远端 GPU/vLLM 管理，以及成熟 web/mobile 健身 UI，除非后续 approved change 扩大范围。

#### Scenario: Requesting a first-stage roadmap item
- **WHEN** 某个路线图条目依赖支付、账号、完整移动端 UX、GPU pod 管理或广泛 Skill 市场
- **THEN** 除非它被单独论证并批准，否则该条目 SHALL 被归类为第一阶段范围外

### Requirement: Fitness safety boundary
FitClaw SHALL 为健身指导保持保守安全边界，包括考虑伤病限制、避免极端饮食或补剂建议，并在医疗问题上引导用户咨询专业医疗人员。

#### Scenario: User reports pain or injury
- **WHEN** 用户报告疼痛、伤病、医疗限制，或不确定某个动作是否安全
- **THEN** FitClaw SHALL 避免激进进阶，在需要时追问澄清，并在合适时建议寻求专业医疗或教练帮助

#### Scenario: User asks for extreme diet or supplementation advice
```

Full source: openspec/changes/define-fitclaw-product-direction/specs/product-direction/spec.md

