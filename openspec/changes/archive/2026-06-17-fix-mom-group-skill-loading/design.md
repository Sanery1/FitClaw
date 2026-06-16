## Context

Mom 的真实飞书入口使用 `workingDir` 作为 Bot workspace。DM 状态目录是 `workingDir/chatId`，群聊状态目录是 `workingDir/chatId/openId`。两者都应该读取同一个 workspace-level `workingDir/skills`。

## Approach

最小修复是在 `packages/mom/src/agent.ts` 中把“真实 workspace host path”从 `channelDir` 派生逻辑中拆出来：

- `getOrCreateRunner()` 仍接收当前会话目录 `channelDir`。
- 新增可测试的 workspace 推断逻辑，或者在创建 runner 时传入明确 workspace host path。
- `loadMomSkills()` 使用真实 workspace host path 读取 `skills/`，同时继续读取 channel/user 目录下的覆盖 Skill。
- 保持 `workspacePath` 的容器路径转换逻辑不变，避免影响 Docker/host sandbox。

## Verification

- 新增 Mom 单元测试：给定 `workingDir/chatId/openId`，应能从 `workingDir/skills/bodybuilding/SKILL.md` 加载 Skill。
- 运行相关 Mom 测试。
- 运行 `npm run check`。

## Risks

风险主要在路径推断。修复应避免改变 DM 的现有行为，并保持 channel-specific skills 仍可覆盖 workspace-level skills。
