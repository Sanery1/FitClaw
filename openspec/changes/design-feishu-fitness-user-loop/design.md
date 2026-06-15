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
| --- | --- | --- |
| 首次建档 | `user_profile` | `user_profile` |
| 生成计划 | `user_profile` | `training_plan` |
| 记录训练 | `user_profile`, `training_plan` | `training_log`, 可选 `progression` / `personal_records` |
| 训练总结 | `training_log`, `body_metrics`, `progression` | 通常不写 |
| 明日安排 | `user_profile`, `training_plan`, `training_log` | 通常不写，除非用户确认调整计划 |
| 伤病处理 | `user_profile`, `training_plan` | 可写入 `user_profile.injuries` 或计划调整 |

后续 `harden-fitness-memory-contract` 会细化字段 schema。本 change 只定义“什么时候读写什么”。

### Decision 4: 飞书回复先适配移动端文本

当前 `packages/mom/src/agent.ts` 已要求：

- 简短；
- 1-3 句优先；
- 移动端窄屏可读；
- 不生成 HTML/图片文件；
- 不依赖 attach。

因此第一阶段体验应优先使用短文本、分组 bullet 和关键数字高亮，不要求复杂卡片、表格、图片动作教学或下载文件。

### Decision 5: eval baseline 从“已有零散场景”升级为“闭环场景矩阵”

现有 session eval 已覆盖多个真实飞书场景，但它们还没有被产品流程组织起来。后续应按本 change 建立矩阵：

- identity；
- profile capture；
- training log write；
- training summary read；
- tomorrow plan；
- injury substitution；
- deadlift safety；
- out-of-scope boundary；
- future: plan generation；
- future: plan adjustment；
- future: body metrics capture；
- future: personal record update。

这能防止产品方向只停留在文档。

## Risks / Trade-offs

- **风险：飞书体验不如原生 App。** 接受这个取舍，因为第一阶段目标是验证 Agent 闭环，而不是做完整 UI。
- **风险：LLM 对自然语言训练记录解析不稳定。** 后续通过 memory contract、schema 和 eval 逐步加固。
- **风险：用户信息追问太多。** 只要求 P0 信息即可开始，P1/P2 后续渐进补齐。
- **风险：计划生成和伤病建议不安全。** 安全边界优先于完整性；疼痛/医疗问题保守处理。
- **风险：飞书 Bot 代码吸收太多业务逻辑。** 本 change 明确核心教练逻辑应沉淀在 Skill/workflow/data contract，而不是 adapter。
