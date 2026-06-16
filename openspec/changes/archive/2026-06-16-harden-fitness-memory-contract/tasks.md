## 1. Memory Contract Artifacts

- [x] 1.1 在 `proposal.md` 中说明为什么需要先加固健身记忆契约，以及本 change 不改 runtime 存储。
- [x] 1.2 在 `design.md` 中定义 namespace 写入模式、字段命名、最小样例和风险取舍。
- [x] 1.3 新增 `fitness-memory-contract` capability spec，覆盖 6 个 bodybuilding namespace 的数据形状、写入模式、兼容策略和验证要求。
- [x] 1.4 修改 `feishu-fitness-user-loop` delta spec，让飞书闭环必须按 memory contract 读写长期事实。
- [x] 1.5 修改 `product-direction` delta spec，让后续长期记忆演进保持 Skill data namespace 接口稳定。

## 2. Review And Verification

- [x] 2.1 使用 `openspec validate harden-fitness-memory-contract` 验证 OpenSpec change artifacts。
- [x] 2.2 和用户确认第一阶段 memory contract 只定义契约，不引入 runtime schema validator、数据库替换或旧数据迁移。
- [x] 2.3 用户确认后进入 design 阶段，细化技术设计和后续实现切片。
