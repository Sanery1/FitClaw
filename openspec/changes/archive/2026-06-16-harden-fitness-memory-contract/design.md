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

后续 eval 应优先检查 snake_case。已有旧字段不在本 change 迁移。

### Decision 4: schema_version 可选但推荐

每个 object namespace 和每条 array record 可以包含 `schema_version: 1`。第一阶段不强制 runtime validation，但推荐新写入数据带上版本号，方便后续迁移。

### Decision 5: 不把自由文本 memory 当长期事实来源

`MEMORY.md` 可以保留偏好、上下文摘要或非结构化备注，但健身闭环里的长期事实应优先写入 Skill data namespace。后续回答如果需要训练历史、计划或 PR，应先读结构化数据。

## Proposed Minimum Shapes

### `user_profile`

```json
{
  "schema_version": 1,
  "goal": "hypertrophy",
  "experience": "beginner",
  "equipment": ["dumbbell", "bench"],
  "training_days_per_week": 3,
  "duration_minutes": 60,
  "injuries": [],
  "body": {
    "height_cm": 178,
    "weight_kg": 75
  },
  "updated_at": "2026-06-16"
}
```

Minimum useful fields: at least one of `goal`, `experience`, `equipment`, `training_days_per_week`, `injuries`.

### `training_log`

```json
{
  "schema_version": 1,
  "date": "2026-06-16",
  "source": "feishu",
  "session_name": "Push day",
  "exercises": [
    {
      "name": "杠铃卧推",
      "exercise_id": "Barbell_Bench_Press",
      "sets": 5,
      "reps": 5,
      "weight_kg": 60,
      "rpe": 8
    }
  ],
  "notes": "状态不错"
}
```

Minimum useful fields: `date` and at least one exercise with `name` plus one measurable training value.

### `training_plan`

```json
{
  "schema_version": 1,
  "name": "3-day PPL",
  "goal": "hypertrophy",
  "days_per_week": 3,
  "days": [
    {
      "name": "Push",
      "exercises": [
        {
          "name": "上斜哑铃卧推",
          "exercise_id": "Incline_Dumbbell_Press",
          "sets": 4,
          "reps": "8-12",
          "rest_seconds": 90
        }
      ]
    }
  ],
  "created_at": "2026-06-16",
  "updated_at": "2026-06-16"
}
```

Minimum useful fields: `name`, `days`, and at least one day with at least one exercise.

### `body_metrics`

```json
{
  "schema_version": 1,
  "date": "2026-06-16",
  "weight_kg": 75,
  "body_fat_percent": 18,
  "waist_cm": 82,
  "notes": "早晨空腹"
}
```

Minimum useful fields: `date` and at least one metric.

### `progression`

```json
{
  "schema_version": 1,
  "date": "2026-06-16",
  "type": "load_increase",
  "exercise": "杠铃卧推",
  "from": { "weight_kg": 60, "reps": 5 },
  "to": { "weight_kg": 62.5, "reps": 5 },
  "reason": "连续两周完成目标次数"
}
```

Minimum useful fields: `date`, `type`, and a human-readable `reason`.

### `personal_records`

```json
{
  "schema_version": 1,
  "date": "2026-06-16",
  "exercise": "杠铃卧推",
  "metric": "estimated_1rm",
  "value": 75,
  "unit": "kg",
  "source_training_log_date": "2026-06-16"
}
```

Minimum useful fields: `date`, `exercise`, `metric`, `value`, and `unit`.

## Risks / Trade-offs

- **风险：schema 太细会压低 Agent 灵活性。** 所以本 change 只定义最小字段和样例，不做强 validator。
- **风险：没有 merge mode，画像更新可能覆盖旧字段。** 通过契约要求 read-modify-replace 来降低风险，runtime merge 以后单独讨论。
- **风险：旧 eval 字段命名不一致。** 本 change 不迁移旧数据，但后续新增 eval 应以 snake_case 为准。
- **风险：模型仍可能写出不合约数据。** 后续需要通过 Skill 文档、eval 和可选 runtime validation 逐步加强。

## Follow-up Slices

1. 把契约写回 `.fitclaw/skills/bodybuilding/SKILL.md` 或 references 文档。
2. 补充 session eval：profile read-modify-replace、training log append、plan replace、metrics/PR/progression append。
3. 如 eval 仍不稳定，再考虑 runtime schema validation 或 helper scripts。
