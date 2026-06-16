---
change: fix-mom-group-skill-loading
status: pass
verified-at: 2026-06-17
---

# 验证报告：修复 Mom 群聊 Skill 加载

## 结论

通过。

## 根因确认

飞书群聊会为每个用户创建 `workingDir/chatId/openId` 隔离目录。原实现用 `channelDir/..` 推断 workspace，导致群聊场景把 `workingDir/chatId` 错当 workspace，从而可能找不到 `workingDir/skills` 下的 `bodybuilding` Skill 和对应 `data_bodybuilding_read/write` 工具。

## 检查项

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 回归测试 RED/GREEN | 通过 | `npx vitest --run test/agent-skill-loading.test.ts` 先因缺少 `resolveMomHostWorkspacePath` 失败，修复后通过 |
| Mom 相关测试 | 通过 | `npx vitest --run test/agent-skill-loading.test.ts test/context-window.test.ts test/card-renderer.test.ts`：3 个文件、17 个测试通过 |
| OpenSpec change 校验 | 通过 | `npx openspec validate fix-mom-group-skill-loading` |
| 主规格校验 | 通过 | `npx openspec validate --specs`：3 passed, 0 failed |
| 项目检查 | 通过 | `npm run check` 完成，无自动修复 |

## 影响范围

- 修复 `packages/mom/src/agent.ts` 中 Mom runner 的 workspace 路径推断。
- 新增 `packages/mom/test/agent-skill-loading.test.ts` 覆盖群聊用户目录读取 workspace-level Skill，以及 channel/user Skill 覆盖 workspace Skill。
- 不改变飞书消息分流、sport-data 存储结构或依赖。
