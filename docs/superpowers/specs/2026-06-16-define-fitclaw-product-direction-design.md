---
comet_change: define-fitclaw-product-direction
role: technical-design
canonical_spec: openspec
archived-with: 2026-06-16-define-fitclaw-product-direction
status: final
---

# Define FitClaw Product Direction - Technical Design

## 目标

这个设计文档把 `define-fitclaw-product-direction` 的 OpenSpec 方向落到工程决策层。OpenSpec 仍然是需求事实源；本文只说明后续如何按这个方向做技术拆分、边界控制和验证。

第一阶段目标不是做完整商业健身 App，而是用健身这个强记忆场景，系统性学习和验证一个 Agent 如何通过 Skill、工具、长期数据和 eval 变得更稳定、更了解用户。

## 核心架构原则

### 1. 飞书是第一 adapter，不是唯一入口

飞书适合作为第一入口，是因为它已经在项目中存在，且天然适合日常 check-in、训练记录、提醒和复盘。它能让项目先验证 Agent 闭环，而不是先投入完整 App、账号系统、推送系统和移动端 UI。

但飞书不是护城河，也不应该成为核心教练逻辑的绑定点。后续实现中，飞书层应主要负责：

- 接收飞书消息；
- 转换成 Agent 输入；
- 做平台权限和消息格式处理；
- 将 Agent 输出发回飞书。

核心教练行为应尽量沉淀在 Skill、Agent workflow、data contract 或可复用服务边界中，包括：

- 用户画像读取；
- 训练记录写入；
- 计划调整；
- 安全判断；
- 周期复盘。

目标结构：

```text
Core Coaching Loop
  ├─ Feishu Bot adapter
  ├─ CLI/TUI debug adapter
  ├─ future Web dashboard
  └─ future mobile/PWA or other bot adapter
```

### 2. bodybuilding Skill 是第一领域能力包，不是长 prompt

bodybuilding Skill 适合作为第一领域能力，因为它已经包含动作数据库、查询脚本、onboarding 流程、训练计划资料、安全资料和持久化 namespace。

长期可靠性不能只靠继续加长 `SKILL.md`。后续增强应该把 Skill 当作能力包：

```text
Skill Capability Package
  ├─ SKILL.md：触发条件、工作流和边界
  ├─ references：领域知识
  ├─ scripts：确定性查询、校验或计算
  ├─ schemas：用户画像、训练日志、计划等结构约束
  ├─ manifest：权限、可用命令、数据 namespace、版本
  └─ evals：关键行为回归测试
```

这意味着第一阶段改进 bodybuilding 时，优先考虑：

- 补清楚触发条件；
- 约束数据结构；
- 用脚本处理确定性查询和校验；
- 为关键行为补 eval；
- 明确权限边界。

不优先做的事情是继续堆叠大段自然语言提示词。

### 3. Skill data namespace 是稳定记忆接口，JSON 是第一 backend

当前 namespace JSON 文件适合第一阶段：简单、可读、部署成本低、方便调试，也符合单用户学习项目的规模。

但它不是最终生产存储。主要缺口是：

- 缺少强 schema；
- 缺少 version/migration；
- 并发写入能力弱；
- 复杂查询能力弱；
- 多实例部署不可靠；
- 审计和回滚能力有限。

因此后续应稳定上层接口，而不是把 JSON 文件当成不可替换架构：

```text
data_<skill>_read/write namespace interface
  ├─ phase 1: JSON files
  ├─ phase 2: JSON + schema + version + append-only log
  ├─ phase 3: SQLite
  ├─ phase 4: PostgreSQL
  └─ optional: vector index for semantic recall
```

健身记忆应优先保存结构化事实：

- 目标；
- 伤病；
- 器械；
- 训练频率；
- 训练动作、重量、次数；
- 当前计划；
- 近期疲劳；
- 个人记录。

向量检索可以作为辅助召回，但不应该成为事实源。

## 后续 change 顺序

建议后续按这个顺序推进：

1. `design-feishu-fitness-user-loop`
   - 定义首次 onboarding、记录训练、查询训练、生成/调整计划、伤病提醒、每日 check-in。
   - 目标是回答“用户到底怎么用”。

2. `harden-fitness-memory-contract`
   - 定义 `user_profile`、`training_log`、`training_plan`、`body_metrics`、`progression`、`personal_records` 的结构和写入时机。
   - 目标是回答“Agent 怎么真正记住你”。

3. `add-feishu-fitness-baseline-evals`
   - 为关键飞书场景建立回归基线。
   - 目标是回答“怎么证明它没有退化”。

4. `improve-bodybuilding-skill-workflow`
   - 优化 onboarding、训练记录、计划输出、安全边界和动作查询流程。
   - 目标是回答“为什么它比普通大模型更稳定”。

5. `define-agent-evolution-roadmap`
   - 设计短期记忆、长期画像、偏好学习、周期复盘、训练适应和反思机制。
   - 目标是回答“Agent 如何越来越懂用户”。

6. `trim-noncore-package-scope`
   - 评估 `web-ui`、`pods`、`tui` 的保留、降级、隔离或后续移除策略。
   - 目标是回答“项目如何变得更聚焦”。

## 验证策略

本 change 是方向与设计 change，不应修改运行时代码。验证重点是：

- OpenSpec artifact 必须有效；
- design handoff 必须与最新 OpenSpec artifact hash 匹配；
- Design Doc 必须链接当前 change，并声明 OpenSpec 是 canonical spec；
- 后续 change 必须能追溯到 `product-direction` 的判断标准。

建议本 change 使用以下验证：

```bash
openspec validate define-fitclaw-product-direction
bash /mnt/c/Users/likey/.codex/skills/comet/scripts/comet-guard.sh define-fitclaw-product-direction design
```

后续实现类 change 再运行 `npm run check`、相关 eval 或手动飞书场景。

## 风险与处理

- 飞书可能不是最终用户最自然的入口：把它作为 adapter，不把核心逻辑绑死。
- bodybuilding Skill 可能退化成大 prompt：把它演进为能力包，增加 schema、manifest、script、eval。
- JSON namespace 长期能力不足：稳定 namespace 接口，后续替换 backend。
- 产品方向可能停留在文档：后续每个 change 都必须说明自己服务哪个用户闭环、记忆能力、安全边界或 eval 保护。
