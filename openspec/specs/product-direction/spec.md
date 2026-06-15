## Purpose

定义 FitClaw 第一阶段产品方向：学习优先的个人 AI 健身教练原型，聚焦飞书入口、Skill 能力包、稳定记忆接口、安全边界和证据驱动路线图。

## Requirements

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
- **WHEN** 用户询问极端饮食、不安全补剂或有害捷径
- **THEN** FitClaw SHALL 拒绝或转向更安全、基于证据的建议

### Requirement: Evidence-based roadmap decisions
FitClaw SHALL 在扩大范围前使用仓库证据和用户闭环证据，包括现有 Skill 能力、持久化数据行为、飞书交互质量和 eval 覆盖。

#### Scenario: Considering expansion beyond bodybuilding and Feishu
- **WHEN** 后续 change 提出新运动品类、新 UI 入口、生产部署层或商业功能
- **THEN** proposal SHALL 说明当前哪些证据支持扩展，以及哪些假设仍未验证

#### Scenario: Accepting first-stage implementation work
- **WHEN** 在这个产品方向下提出第一阶段实现工作
- **THEN** 该工作 SHALL 包含可独立验证的结果，例如文档化工作流、确定性 eval、手动飞书场景或窄范围测试
