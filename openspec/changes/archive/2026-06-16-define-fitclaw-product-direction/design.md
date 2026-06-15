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

飞书只应该负责消息接入、消息格式转换、权限边界和回复发送。用户画像读取、训练记录写入、计划调整、安全判断、复盘逻辑等核心教练行为，应尽量沉淀在 Skill、Agent workflow、data contract 或可复用服务边界中。这样第一阶段可以利用飞书快速验证，但不会把产品锁死在飞书。

### Decision 4: 保留通用 Agent runtime，但不让它定义产品

Agent runtime 是有价值的学习基础设施。但产品方向不应该是“一个顺便做健身的 coding agent”。对第一阶段产品工作，默认问题应该是：

> 这件事是否改善个人健身教练闭环？

如果不能，它就应该被归类为基础设施维护、学习探索，或者暂时不在范围内。

### Decision 5: 暂时把 `tui`、`web-ui`、`pods` 放到次要位置

- `tui` 仍然对学习和调试 coding-agent 架构有用，尤其是 `packages/coding-agent` 的 interactive mode 依赖它。但它不是第一阶段健身用户体验。
- `web-ui` 不是第一阶段要求，除非后续决定构建专门的可视化训练界面。
- `pods` 不是第一阶段要求，除非本地/远端模型服务成为明确学习目标。

这些包不应该在本方向 change 中删除。删除或抽离应作为后续独立清理决策，并基于依赖影响单独评估。

### Decision 6: 扩大范围前先看当前证据

当前仓库证据支持一个收窄方向：

- bodybuilding Skill 已有 onboarding、计划设计、渐进超负荷、安全边界和数据持久化指导。
- Skill data namespaces 已包含 `user_profile`、`training_log`、`training_plan`、`body_metrics`、`progression` 和 `personal_records`。
- 飞书 Bot 已存在，可以作为日常助手入口。
- eval harness 可以保护工具调用和数据写入行为。

仓库目前还不能证明：

- 已具备广泛消费者可用性；
- 真实模型的教练质量稳定可靠；
- 多用户生产环境可靠；
- 用户有付费意愿；
- 已经有成熟健身 UI。

因此第一阶段应先改善已被代码基础支持的闭环，再扩大到商业化或完整 App 叙事。

### Decision 7: 将 bodybuilding Skill 视为第一领域能力包，而不是普通 prompt

bodybuilding Skill 适合作为第一领域能力，因为它已经有动作数据库、查询脚本、onboarding 流程、训练计划资料、安全资料和持久化 namespace。但长期可靠性不能只依赖更长的 `SKILL.md`。

后续演进方向应该是：

```text
Skill Capability Package
  ├─ SKILL.md：触发条件、工作流和边界
  ├─ references：领域知识
  ├─ scripts：确定性查询、校验或计算
  ├─ schemas：用户画像、训练日志、计划等结构约束
  ├─ manifest：权限、可用命令、数据 namespace、版本
  └─ evals：关键行为回归测试
```

因此第一阶段可以继续使用 bodybuilding Skill，但后续改进重点应该是增强结构化约束、权限声明和 eval 覆盖，而不是继续堆叠自然语言提示词。

### Decision 8: 将 Skill data namespace 视为稳定记忆接口，而不是最终存储方案

Skill data namespace 当前适合第一阶段，因为它简单、可读、便于调试，也符合单用户学习项目的规模。但 JSON 文件不是长期生产存储答案。它缺少强 schema、迁移、事务、复杂查询、多实例一致性和完整审计能力。

更稳的策略是保留上层接口，允许替换底层 backend：

```text
data_<skill>_read/write namespace interface
  ├─ phase 1: JSON files
  ├─ phase 2: JSON + schema + version + append-only log
  ├─ phase 3: SQLite
  ├─ phase 4: PostgreSQL
  └─ optional: vector index for semantic recall
```

健身记忆应优先保存结构化事实，例如目标、伤病、器械、训练频率、训练动作、重量、次数、计划和个人记录。向量检索可以作为召回辅助，但不应成为事实源。

## Risks / Trade-offs

- **风险：学习项目被过度产品化。** 缓解方式：第一阶段保持很小，把产品方向作为范围过滤器，而不是生产化承诺。
- **风险：飞书对个人消费者不一定自然。** 缓解方式：因为它已实现，所以作为第一测试入口；但不要让核心教练闭环只能运行在飞书。
- **风险：健身建议可能不安全或过度自信。** 缓解方式：高级教练行为前必须先有安全边界、伤病提示和 Skill 支撑。
- **风险：通用 coding-agent 代码分散健身产品注意力。** 缓解方式：除非它直接改善记忆、工具、eval 或健身闭环，否则归类为学习基础设施。
- **风险：早期护城河不明显。** 缓解方式：先聚焦记忆质量、累计个人上下文、可重复工作流和 eval 支撑的可靠性，而不是广泛 App 功能。
- **风险：第一阶段选择被误解为终局架构。** 缓解方式：明确飞书是 adapter、bodybuilding 是第一能力包、namespace 是稳定接口，底层入口和存储都允许后续替换。
