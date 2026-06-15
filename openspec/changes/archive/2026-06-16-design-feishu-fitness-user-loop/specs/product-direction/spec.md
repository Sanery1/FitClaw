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
