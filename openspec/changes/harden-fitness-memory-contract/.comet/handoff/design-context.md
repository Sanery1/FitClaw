# Comet Design Handoff

- Change: harden-fitness-memory-contract
- Phase: design
- Mode: compact
- Context hash: e3b0da9fad37484918204bc7d64904b4ad63039d0735e01540b570f70ae06ed8

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/harden-fitness-memory-contract/proposal.md

- Source: openspec/changes/harden-fitness-memory-contract/proposal.md
- Lines: 1-41
- SHA256: bf69aea4df8d13f361a3e5c2186d9ab8fb41d6668252132ec4185c98f8132c73

```md
## Why

`feishu-fitness-user-loop` 已经明确第一阶段飞书健身助手依赖长期记忆，但当前 `bodybuilding` 只声明了 namespace 名称和 object/array 类型，没有定义最小字段、写入模式、样例或兼容策略。继续做 onboarding、训练记录和计划调整前，需要先把记忆契约固定下来，避免 Agent 写入的数据形状漂移。

现有 `data_bodybuilding_read/write` 工具已经支持 namespace 校验、object 默认 `replace`、array 默认 `append` 和 JSON 文件后端。这个 change 应该利用现有能力定义契约，而不是马上替换存储层。

## What Changes

- 定义 `bodybuilding` 第一阶段 6 个 namespace 的最小数据契约：`user_profile`、`training_log`、`training_plan`、`body_metrics`、`progression`、`personal_records`。
- 明确每个 namespace 的写入模式：object namespace 使用完整对象 `replace`；array namespace 使用单条记录 `append`。
- 明确 first-stage 必填字段和可选字段，允许渐进补全，但禁止把互相冲突或不可解析的格式写成长期事实。
- 定义兼容策略：当前 JSON backend 保持不变；schema version 可以作为数据字段出现，但不引入新数据库或新验证依赖。
- 定义样例数据和验证要求，让后续 eval 可以检查 Agent 是否读旧数据、写新事实、避免覆盖数组历史。
- 本 change 不实现运行时代码，不修改 `FileSportDataStore` 或 data tool 行为。

## Capabilities

### New Capabilities

- `fitness-memory-contract`: 定义第一阶段健身长期记忆 namespace 的数据形状、写入模式、兼容策略和验证要求。

### Modified Capabilities

- `feishu-fitness-user-loop`: 补充飞书用户闭环依赖的长期记忆契约，要求后续 Feishu 行为按该 contract 读写数据。
- `product-direction`: 补充第一阶段长期记忆改进必须优先保持 Skill data namespace 稳定，而不是直接绑定某个存储后端。

## Impact

- 受影响的 OpenSpec artifact：
  - `openspec/changes/harden-fitness-memory-contract/proposal.md`
  - `openspec/changes/harden-fitness-memory-contract/design.md`
  - `openspec/changes/harden-fitness-memory-contract/specs/fitness-memory-contract/spec.md`
  - `openspec/changes/harden-fitness-memory-contract/specs/feishu-fitness-user-loop/spec.md`
  - `openspec/changes/harden-fitness-memory-contract/specs/product-direction/spec.md`
  - `openspec/changes/harden-fitness-memory-contract/tasks.md`
- 方向上影响：
  - `.fitclaw/skills/bodybuilding/SKILL.md` 后续应按契约补充字段说明和样例。
  - `packages/coding-agent/evals/tasks/session` 后续应按契约补充 memory 读写 eval。
  - `packages/coding-agent/src/core/tools/skill-data-tools.ts` 当前不改；后续如需 runtime schema validation，应单独开 change。
- 不新增依赖。
- 不引入破坏性运行时代码变更。
```

## openspec/changes/harden-fitness-memory-contract/design.md

- Source: openspec/changes/harden-fitness-memory-contract/design.md
- Lines: 1-226
- SHA256: 9da4751bd9c78eb5c2c98ab5e2ab1a2caa9bf9ef9ed2d8d271ff6d40ee42f5e0

[TRUNCATED]

```md
## Context

上一轮 `design-feishu-fitness-user-loop` 已经把飞书第一阶段用户闭环定义为 onboarding、planning、logging、review、next-session guidance 和 safety handling。这个闭环依赖 6 个 `bodybuilding` Skill data namespace：

- `user_profile`
- `training_log`
- `training_plan`
- `body_metrics`
- `progression`
- `personal_records`

现有代码和文档显示：

- `.fitclaw/skills/bodybuilding/SKILL.md` 已声明这些 namespace，但只有 object/array 类型和用途说明。
- `packages/coding-agent/src/core/tools/skill-data-tools.ts` 会校验 namespace 是否声明，并根据 declaration 决定默认写入模式：object 默认 `replace`，array 默认 `append`。
- `FileSportDataStore` 将数据持久化为 `{dataDir}/sport-data/{skill}/{namespace}.json`。
- 当前工具不做字段级 schema validation，也没有 merge 模式。
- 现有 eval 已检查 `user_profile` 和 `training_log` 的部分字段，但字段命名还不完全统一，例如 `weight_kg` 与 `weightKg` 同时出现过。

这个 change 的核心是把“应该写什么”定义成契约，为后续 Skill 文档、eval 和 runtime validation 提供基线。

## Goals / Non-Goals

**Goals:**

- 定义第一阶段每个 namespace 的最小稳定字段。
- 明确 `replace`、`append` 的使用边界。
- 允许用户画像和训练计划渐进补全，但避免不可预测的自由格式。
- 让后续 Feishu eval 可以基于契约检查数据读写。
- 保持当前 JSON 文件后端和 data tool 接口稳定。

**Non-Goals:**

- 不实现 runtime schema validator。
- 不新增 SQLite/PostgreSQL/向量库。
- 不修改 `FileSportDataStore`。
- 不新增 merge mode。
- 不迁移已有用户数据。
- 不设计完整训练计划算法。
- 不把所有健身知识结构化成领域数据库。

## Decisions

### Decision 1: 契约先定义“最小可用字段”，不是完整数据模型

第一阶段不追求覆盖所有健身 App 字段，只定义能支撑闭环的最小结构：

- 用户是谁、目标是什么、有什么器械、每周能练几天、有什么伤病限制。
- 做过哪次训练、日期、动作、重量、组数、次数、RPE。
- 当前计划是什么、每周结构、训练日、动作处方。
- 身体指标记录的日期和关键数值。
- 渐进超负荷事件的触发原因和调整。
- 个人记录的动作、数值、日期和单位。

这样能避免一开始把 schema 设计成产品大后台。

### Decision 2: Object namespace 使用完整对象 replace，array namespace 使用单记录 append

现有工具没有 merge mode，因此契约必须适配当前能力：

| Namespace | Type | Write mode |
| --- | --- | --- |
| `user_profile` | object | `replace` 完整画像对象 |
| `training_plan` | object | `replace` 当前计划对象 |
| `training_log` | array | `append` 单次训练记录 |
| `body_metrics` | array | `append` 单次体测记录 |
| `progression` | array | `append` 单次进阶事件 |
| `personal_records` | array | `append` 单条 PR 记录 |

如果要更新 `user_profile` 的单个字段，Agent 应先 read 旧对象，在回复内构造合并后的完整对象，再 replace。不要把局部 patch 当成完整画像写入。

### Decision 3: 字段命名采用 snake_case

当前中文 session eval 已使用 `weight_kg`，英文 skills eval 曾使用 `weightKg`。为了减少长期漂移，第一阶段契约应统一使用 snake_case：

- `weight_kg`
- `training_days_per_week`
- `duration_minutes`
- `created_at`
- `updated_at`
```

Full source: openspec/changes/harden-fitness-memory-contract/design.md

## openspec/changes/harden-fitness-memory-contract/tasks.md

- Source: openspec/changes/harden-fitness-memory-contract/tasks.md
- Lines: 1-13
- SHA256: d2ab3f7df3eb88d1adb8bc00ec9bb0259e95f3b0cc0a1d8980ac34202add2bb0

```md
## 1. Memory Contract Artifacts

- [ ] 1.1 在 `proposal.md` 中说明为什么需要先加固健身记忆契约，以及本 change 不改 runtime 存储。
- [ ] 1.2 在 `design.md` 中定义 namespace 写入模式、字段命名、最小样例和风险取舍。
- [ ] 1.3 新增 `fitness-memory-contract` capability spec，覆盖 6 个 bodybuilding namespace 的数据形状、写入模式、兼容策略和验证要求。
- [ ] 1.4 修改 `feishu-fitness-user-loop` delta spec，让飞书闭环必须按 memory contract 读写长期事实。
- [ ] 1.5 修改 `product-direction` delta spec，让后续长期记忆演进保持 Skill data namespace 接口稳定。

## 2. Review And Verification

- [ ] 2.1 使用 `openspec validate harden-fitness-memory-contract` 验证 OpenSpec change artifacts。
- [ ] 2.2 和用户确认第一阶段 memory contract 只定义契约，不引入 runtime schema validator、数据库替换或旧数据迁移。
- [ ] 2.3 用户确认后进入 design 阶段，细化技术设计和后续实现切片。
```

## openspec/changes/harden-fitness-memory-contract/specs/feishu-fitness-user-loop/spec.md

- Source: openspec/changes/harden-fitness-memory-contract/specs/feishu-fitness-user-loop/spec.md
- Lines: 1-31
- SHA256: 11ef586be816dee4625ff3a5c4472f73ca99420fd1eba492b1f8e2e85a351d71

```md
## MODIFIED Requirements

### Requirement: Feishu first-stage user loop
FitClaw SHALL define the first-stage Feishu experience as a conversational fitness coaching loop covering onboarding, planning, logging, review, next-session guidance, and safety handling. Durable facts learned through the Feishu loop SHALL follow the `fitness-memory-contract` namespace and write-mode requirements.

#### Scenario: User starts from no profile
- **WHEN** 飞书用户首次请求健身帮助且没有完整 `user_profile`
- **THEN** FitClaw SHALL 优先收集目标、经验和可用器械，并避免一次性询问过多信息

#### Scenario: User returns with saved context
- **WHEN** 飞书用户已有 `user_profile`、`training_plan` 或 `training_log`
- **THEN** FitClaw SHALL 在给训练建议、记录训练或安排下一次训练前使用这些已保存上下文

#### Scenario: Persisting facts from Feishu
- **WHEN** 飞书对话产生长期有效的健身事实
- **THEN** FitClaw SHALL 按 `fitness-memory-contract` 选择 namespace、字段形状和 `replace` / `append` 写入模式

### Requirement: Feishu training log flow
FitClaw SHALL parse natural-language workout logs in Feishu and persist completed training to `training_log` using the append-only record contract.

#### Scenario: User logs a workout
- **WHEN** 用户说“记录今天卧推60kg 5x5，RPE 8”或等价训练记录
- **THEN** FitClaw SHALL append structured data to `training_log` and confirm the saved record in concise text

#### Scenario: User mentions a personal record
- **WHEN** 用户明确表示某个动作创造个人记录
- **THEN** FitClaw SHALL append the workout to `training_log` and update `personal_records` when enough data is available

#### Scenario: User gives an ambiguous workout log
- **WHEN** 用户的训练记录缺少动作名称或任何可衡量训练值
- **THEN** FitClaw SHALL ask a short clarification question before writing `training_log`
```

## openspec/changes/harden-fitness-memory-contract/specs/fitness-memory-contract/spec.md

- Source: openspec/changes/harden-fitness-memory-contract/specs/fitness-memory-contract/spec.md
- Lines: 1-108
- SHA256: 497dfb75d303def0ce7e929088074258796f70f4a5719b8b20edf5017a26aded

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: Bodybuilding memory namespaces
FitClaw SHALL define the first-stage bodybuilding memory contract around the existing `user_profile`, `training_log`, `training_plan`, `body_metrics`, `progression`, and `personal_records` Skill data namespaces.

#### Scenario: Using declared namespaces
- **WHEN** a fitness workflow persists durable user facts
- **THEN** it SHALL use one of the declared `bodybuilding` namespaces instead of creating ad hoc namespace names

#### Scenario: Reading existing data
- **WHEN** a workflow updates a namespace that may already contain data
- **THEN** it SHALL read the existing namespace first when needed to avoid losing known facts

### Requirement: Object namespace write contract
FitClaw SHALL treat object namespaces as complete current-state documents written with `mode: "replace"`.

#### Scenario: Updating user profile
- **WHEN** the user provides a new durable profile fact such as goal, equipment, schedule, or injury limitation
- **THEN** FitClaw SHALL write a complete `user_profile` object that preserves still-valid known fields

#### Scenario: Updating current training plan
- **WHEN** the user confirms a generated or adjusted plan should become the current plan
- **THEN** FitClaw SHALL write a complete `training_plan` object with `mode: "replace"`

### Requirement: Array namespace append contract
FitClaw SHALL treat array namespaces as append-only event/history streams for first-stage behavior.

#### Scenario: Logging a workout
- **WHEN** the user records a completed workout
- **THEN** FitClaw SHALL append one structured record to `training_log` and SHALL NOT replace the full history

#### Scenario: Recording body metrics
- **WHEN** the user provides body weight, body fat, circumference, or similar dated metrics
- **THEN** FitClaw SHALL append one structured record to `body_metrics`

#### Scenario: Recording progression
- **WHEN** FitClaw records a load, rep, volume, deload, or plan progression event
- **THEN** it SHALL append one structured record to `progression`

#### Scenario: Recording a personal record
- **WHEN** the user explicitly reports a personal record or FitClaw has enough structured evidence to identify one
- **THEN** FitClaw SHALL append one structured record to `personal_records`

### Requirement: Fitness memory field naming
FitClaw SHALL use snake_case field names for new first-stage fitness memory records.

#### Scenario: Recording load and schedule values
- **WHEN** FitClaw writes weight, duration, schedule, or timestamp fields
- **THEN** it SHALL prefer names such as `weight_kg`, `duration_minutes`, `training_days_per_week`, `created_at`, and `updated_at`

#### Scenario: Encountering older data shapes
- **WHEN** older data uses a different field style such as `weightKg`
- **THEN** FitClaw SHALL avoid rewriting the full history solely for naming cleanup unless a migration change is explicitly approved

### Requirement: User profile minimum shape
FitClaw SHALL define `user_profile` as the current durable profile object for goals, experience, equipment, schedule, injury limits, body basics, and update metadata.

#### Scenario: Capturing first useful profile facts
- **WHEN** the user provides goal, experience, equipment, schedule, or injury data
- **THEN** the stored `user_profile` SHOULD include the provided fields and MAY include `schema_version: 1` and `updated_at`

#### Scenario: Avoiding partial overwrite
- **WHEN** a user provides one new profile fact after a profile already exists
- **THEN** FitClaw SHALL preserve still-valid existing profile fields in the replacement object

### Requirement: Training log minimum shape
FitClaw SHALL define `training_log` records as dated completed workout records with one or more structured exercise entries.

#### Scenario: Recording measurable training
- **WHEN** the user logs a workout with exercise name and measurable training values
- **THEN** a `training_log` record SHOULD include `date`, `exercises`, and per-exercise values such as `sets`, `reps`, `weight_kg`, or `rpe`

#### Scenario: Handling incomplete logs
- **WHEN** the user provides an incomplete workout log that cannot identify an exercise or any measurable value
- **THEN** FitClaw SHALL ask a short clarification question before writing long-term training history

### Requirement: Training plan minimum shape
FitClaw SHALL define `training_plan` as the current active plan object, not a history of all previous plans.

#### Scenario: Saving a generated plan
```

Full source: openspec/changes/harden-fitness-memory-contract/specs/fitness-memory-contract/spec.md

## openspec/changes/harden-fitness-memory-contract/specs/product-direction/spec.md

- Source: openspec/changes/harden-fitness-memory-contract/specs/product-direction/spec.md
- Lines: 1-16
- SHA256: 0772e31f05442eb5abe27bb1f5580a761b61836425ccfc6e348f56780178e46d

```md
## MODIFIED Requirements

### Requirement: Memory backend portability
FitClaw SHALL 将 Skill data namespace 视为稳定记忆接口，并 SHALL 将当前 JSON 文件存储视为第一阶段 backend，而不是不可替换的最终存储方案。第一阶段长期记忆改进 SHALL 优先加固 namespace contract、写入模式、样例和 eval，而不是直接替换存储后端。

#### Scenario: Persisting durable fitness facts
- **WHEN** 用户提供目标、伤病、器械、训练日志、计划、身体数据或个人记录等持久事实
- **THEN** FitClaw SHALL 优先写入结构化 Skill data namespace，而不是只写入自由文本记忆或向量索引

#### Scenario: Evolving storage backend
- **WHEN** 后续 change 需要引入 schema version、append-only log、SQLite、PostgreSQL 或语义检索
- **THEN** 该 change SHALL 尽量保持 `data_<skill>_read/write` namespace 接口稳定，并将底层存储演进作为 backend 替换处理

#### Scenario: Hardening memory before changing storage
- **WHEN** 后续 change 改善长期记忆可靠性
- **THEN** 它 SHALL 优先说明 namespace contract、write mode、schema version 或 eval 覆盖是否需要更新
```

