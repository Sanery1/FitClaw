## 1. 飞书用户闭环 Artifacts

- [x] 1.1 在 `proposal.md` 中定义为什么需要飞书健身用户闭环，以及本 change 不做运行时代码实现。
- [x] 1.2 在 `design.md` 中定义第一阶段飞书用户流程、读写契约、移动端回复边界和 eval 矩阵。
- [x] 1.3 新增 `feishu-fitness-user-loop` capability spec，覆盖 onboarding、planning、logging、review、next-session guidance、safety、mobile format 和 verification。
- [x] 1.4 修改 `product-direction` delta spec，让第一阶段用户体验必须映射到可验证的飞书用户闭环。

## 2. 评审与验证

- [x] 2.1 使用 `openspec validate design-feishu-fitness-user-loop` 验证 OpenSpec change artifacts。
- [x] 2.2 和用户一起评审飞书用户闭环：确认哪些场景是第一阶段必须做，哪些推迟到后续。
- [x] 2.3 用户确认后，进入 design 阶段，细化技术设计和后续实现切片。
