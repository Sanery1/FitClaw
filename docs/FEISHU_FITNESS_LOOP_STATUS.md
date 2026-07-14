# FitClaw 飞书健身闭环阶段状态

最后更新：2026-07-14

## 当前定位

FitClaw 第一阶段应继续被视为学习优先的个人 AI 健身教练原型。当前重点不是做完整健身 App，也不是把所有入口都产品化，而是验证一个 Agent 是否能通过飞书、Skill、长期记忆和确定性 eval 形成稳定的健身助手闭环。

飞书是第一入口，但不是护城河本身。护城河应来自更稳定的用户记忆、可回归验证的教练行为、领域 Skill 能力包，以及后续能跨入口复用的 coaching loop。

## 当前第一阶段闭环

当前飞书闭环可以按这条链路理解：

```text
用户飞书消息
  -> apps/coach-bot adapter
  -> packages/coach-core policy
  -> packages/runtime Skill data tools
  -> AgentRunner
  -> bodybuilding Skill
  -> data_bodybuilding_read/write
  -> sport-data/bodybuilding/*.json
  -> 简短移动端回复
```

第一阶段已经形成的用户流程：

1. 新用户提供目标、经验、器械、训练频率和伤病限制。
2. FitClaw 将长期事实保存到 `user_profile`。
3. 用户资料和安全信息足够时，生成并保存 `training_plan`。
4. 用户可请求临时调整计划但不保存。
5. 用户明确确认时，才替换保存当前 `training_plan`。
6. 用户记录已完成训练，追加到 `training_log`。
7. 用户明确报告 PR 时，同时记录训练日志和 `personal_records`。
8. 用户请求近期总结时，只基于已保存 `training_log`。
9. 用户请求下一练时，优先读取 `training_plan` 和近期 `training_log`。
10. 伤病、疼痛、高风险负重和非健身实时问题保持保守边界。

## 当前 eval 护栏

当前 session eval 已覆盖核心飞书路径：

| 能力 | 代表 eval |
| --- | --- |
| 身份和基本飞书对话 | `feishu-2026-05-08-identity`, `feishu-2026-05-08-checkin` |
| 用户画像写入 | `feishu-2026-05-08-profile-capture` |
| 缺少伤病信息时不生成计划 | `feishu-plan-missing-injury-gate` |
| 资料完整后生成并保存首个计划 | `feishu-first-plan-from-profile` |
| 临时调整计划但不保存 | `feishu-plan-adjust-no-save` |
| 明确保存调整后的计划 | `feishu-plan-adjust-save` |
| 训练记录写入 | `feishu-2026-05-08-training-log` |
| 训练记录缺动作时追问 | `feishu-training-log-ambiguous-exercise` |
| PR 同时写训练日志和个人记录 | `feishu-personal-record-log` |
| 读取训练日志做总结 | `feishu-training-summary-with-log`, `feishu-2026-05-08-training-summary` |
| 没有训练日志时不编造历史 | `feishu-training-summary-empty-log` |
| 有计划和日志时给下一练建议 | `feishu-next-session-with-context`, `feishu-2026-05-08-tomorrow-plan` |
| 没有计划时说明不确定性 | `feishu-next-session-missing-plan` |
| 疼痛和大重量安全边界 | `feishu-pain-heavy-lift-boundary`, `feishu-2026-05-08-deadlift-safety` |
| 非健身实时问题边界 | `feishu-2026-05-08-weather-boundary` |
| 动作替代和游泳问答基线 | `feishu-2026-05-08-shoulder-substitution`, `feishu-2026-05-08-swimming-breathing` |

当前 session suite 已达到 21 个任务。它们主要是 faux-response contract eval，保护工具调用顺序、参数、文件写入和关键回复边界。它们不等价于 live model 表现评估。

## 已完成的关键收敛

- 第一入口明确为飞书。
- 第一领域能力明确为 `bodybuilding` Skill。
- 第一阶段记忆接口明确为 Skill data namespace。
- 核心长期数据集中在 `user_profile`、`training_plan`、`training_log`、`personal_records`、`body_metrics`、`progression`。
- 计划写入边界已成对覆盖：临时调整不写，确认保存才 replace。
- 总结和下一练建议已开始保护“先读已保存上下文”的行为。
- 安全边界已覆盖疼痛、大重量和缺伤病信息时的保守处理。

## 仍需谨慎的地方

当前确定性 eval 证明的是合同链路，不证明真实模型在飞书里每次都会自然做对。

尚未充分验证的点：

- live model 在真实飞书消息下是否稳定触发同样的 read/write。
- 多轮 onboarding 是否足够自然，是否会一次问太多。
- 体重、围度、体脂等 `body_metrics` 在飞书 session 中的写入路径。
- `progression` 在真实训练周期中的触发时机。
- 保存计划前的结构化 schema 校验。
- 飞书端真实移动阅读体验。
- 长期数据增长后的查询、摘要和迁移策略。

## 推荐下一阶段

建议下一阶段不要继续无差别堆 eval，而是做三件事：

1. 写一份真实飞书手动 smoke 脚本。
   - 覆盖新用户画像、计划生成、训练记录、总结、下一练、安全边界。
   - 记录每一步期望读写的 namespace。
   - 当前脚本见 [FEISHU_FITNESS_SMOKE_SCRIPT.md](./FEISHU_FITNESS_SMOKE_SCRIPT.md)。

2. 做一次 live Feishu run 审计。
   - 用真实模型跑 smoke 脚本。
   - 对照 session eval，记录哪些行为靠 faux response 能过、真实模型却不稳定。
   - 优先修第一个真实不一致点。

3. 补 session eval 中仍缺的 `body_metrics` 和 `progression`。
   - 这两个是第一阶段 checklist 里仍主要停留在 skills suite 的能力。
   - 只有当真实飞书 smoke 暂时不方便时，才优先继续补这些 eval。

## 不建议下一步做什么

- 不建议马上做完整移动 App。
- 不建议先接商业化、支付或多用户 SaaS。
- 不建议把 JSON backend 过早迁移到数据库。
- 不建议继续扩大非核心包范围，例如 GPU pod 管理或通用 Web UI。
- 不建议用更长 prompt 替代 schema、eval 和真实飞书 smoke。

## 验证命令

常用回归命令：

```bash
cd packages/coding-agent
npm run eval -- --suite session
```

项目级检查：

```bash
npm run check
npx openspec validate --specs
```

如果后续改动影响 Skill 记忆行为，还应运行：

```bash
cd packages/coding-agent
npm run eval -- --suite skills
```
