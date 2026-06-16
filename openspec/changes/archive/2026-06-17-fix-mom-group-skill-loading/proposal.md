## Why

飞书群聊消息会按 `workingDir/chatId/openId` 创建用户隔离目录。`packages/mom/src/agent.ts` 当前在 `loadMomSkills()` 中固定使用 `channelDir/..` 推断 Bot workspace；这对 DM 的 `workingDir/chatId` 目录成立，但对群聊用户目录会变成 `workingDir/chatId`，从而找不到真正的 `workingDir/skills`。

影响是群聊入口可能看不到 `bodybuilding` Skill，也不会注册 `data_bodybuilding_read/write`，导致第一阶段飞书健身闭环在群聊中无法稳定使用 Skill 记忆能力。

## Root Cause

`getState()` 为群聊创建的 `channelDir` 是三层路径：`workingDir/chatId/openId`。但 `loadMomSkills(channelDir, workspacePath)` 将 `join(channelDir, "..")` 当作 host workspace，所以群聊场景会把 `workingDir/chatId` 错当 workspace。

## What Changes

- 让 Mom runner 显式区分 workspace 目录和 channel/user 目录。
- 确保群聊用户目录仍从真实 Bot workspace 的 `skills/` 加载 workspace-level Skill。
- 增加回归测试覆盖群聊用户目录加载 workspace Skill 的路径。

## Non-Goals

- 不改变飞书消息分流规则。
- 不改变 sport-data 存储结构。
- 不新增依赖。
- 不重构 Mom runner 架构。
