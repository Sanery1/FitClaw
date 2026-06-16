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
