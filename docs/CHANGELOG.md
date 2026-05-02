# FitClaw Changelog

> Historical completed items archived from CLAUDE.md.
> For current state, see [CLAUDE.md](../CLAUDE.md).

## 2026-05-02

- **Model B 纯 Skill 架构**: 删除 fitness-coach (Model A) — 删除 11 个 Agent Tool + jiti 动态加载 + `fitnessMode` 标志（散落 5 个文件）
- 新增 `data:` SKILL.md frontmatter 声明，框架自动注册 `data:{skill}:read` / `data:{skill}:write` Agent Tool
- 新增 `skill-data-tools.ts` — 通用 Skill 数据持久化工具工厂
- 新增 `fitclaw-data` CLI — 脚本桥接 read/write/append 子命令
- bodybuilding Skill 集成：从 Sanery1/skill-bodybuilding 引入（800+ 动作 + Python 查询脚本）
- fitness-coach 的 8 份 reference 文档合并进 bodybuilding
- swimming-coach 迁移到 Model B（删除空的 scripts/tools.ts）
- `createMomTools` 签名简化：移除 dataDir 参数，不再硬编码 createFitnessTools
- MOM Bot 系统提示词改为 formatSkillsForPrompt 动态生成知识索引
- 保留 `sport-data-store.ts` 作为通用持久化引擎
- Remove all Slack support from mom package: delete slack.ts, download.ts, events.ts
- Remove `@slack/socket-mode` and `@slack/web-api` dependencies

## 2026-05-01

- Security fix: Bash dangerous command interception + path traversal protection (f09e06cd)
- Risk checklist: `docs/RISK_ISSUES.md` (#2 #3 fixed)
- User guide: `docs/USER_GUIDE.md`
- Bot loads knowledge base: switched to `.fitclaw/skills/fitness-coach/references/` progressive indexing
- Fitness data JSON file persistence, isolated by channel (P0)
- System prompt tool descriptions include trigger words (P1)
- Fitness tools integrated into Bot (`createMomTools` includes `createAllFitnessTools()`)

## 2026-04

- Docs archived to `docs/` directory
- Code pushed to [Sanery1/FitClaw](https://github.com/Sanery1/FitClaw)
- Config directory migrated from `~/.pi/` to `~/.fitclaw/`
- `.gitignore` updated, `README.md` completely rewritten
- Feishu Bot full implementation `packages/mom/src/feishu.ts` (WebSocket persistent connection mode)
- Knowledge base system `.fitclaw/skills/` (progressive index references/ + SKILL.md)
- 50-exercise complete database `.fitclaw/skills/fitness-coach/assets/exercises.json` (CN/EN), source retained at `packages/coding-agent/data/exercises.json`
- 11 fitness Agent tools (exercise database / workout records / body measurements / training plans / progress analysis)
- Package rename: 200+ source file import paths, tsconfig, vitest aliases all updated
- Project initialized, TypeScript monorepo architecture, all 7 packages under `@fitclaw/*` namespace
