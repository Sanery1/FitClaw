# FitClaw Project Understanding

> 面向后续 AI Agent 的项目速读。目标是让接手者在 5-10 分钟内理解 FitClaw 是什么、为什么这样设计、当前做到哪里、改动时该看哪些文件。
> 人类可读的深入问答见 [QNA.md](./QNA.md)。

最后更新：2026-05-07

---

## 一句话定位

FitClaw 是一个 TypeScript monorepo AI Agent 平台，把两类能力放在同一套运行时上：

- AI 运动私教：通过 Skill 提供训练计划、动作查询、训练记录、体测数据和长期进度分析。
- 智能编程助手：通过 CLI/TUI、工具调用、会话持久化和多 Provider LLM 接入提供类似 Claude Code 的开发体验。

它不是单纯健身应用，也不是单纯聊天 Bot。更准确地说，它是一个通用 Agent runtime，加上可安装、可发现、按需加载的领域 Skill。

---

## 项目来龙去脉

| 日期 | 事件 | 影响 |
|------|------|------|
| 2026-04 | 项目初始化为 TypeScript monorepo | 形成 `packages/*` 多包结构 |
| 2026-04 | 统一包名到 `@fitclaw/*` | 形成 `ai / agent / coding-agent / tui / mom / web-ui / pods` 七包边界 |
| 2026-04 | 增加运动私教能力，早期是 11 个硬编码 AgentTool | 能跑，但领域能力耦合在框架代码里 |
| 2026-05-02 | 迁移到 Model B 纯 Skill 架构 | 删除 fitness-coach Model A、删除 11 个硬编码工具、删除 `fitnessMode`，改为 `SKILL.md + data:` 声明 |
| 2026-05-03 | 修复飞书 Bot 使用 Skill 的链路 | Bot 能访问 `feishu-workspace/skills/`，Docker 镜像内安装 Python，系统提示词降低工具名幻觉 |
| 2026-05-07 | 加固 Skill data 与 Bot bash 安全边界 | data read/write 拒绝未声明 namespace，存储层阻止路径越界，写入失败显式报错，Bot bash 拦截危险命令 |

核心演进方向：从“框架内置健身逻辑”转向“框架只负责 Agent runtime、安全边界和数据工具，领域能力由 Skill 包承载”。

---

## Monorepo 包边界

| 包 | npm 名 | 职责 |
|----|--------|------|
| `packages/ai` | `@fitclaw/ai` | 多厂商 LLM 抽象层：统一 `Message`、`Context`、`Model`、流式事件和工具参数校验 |
| `packages/agent` | `@fitclaw/agent-core` | Agent 运行时：ReAct 推理循环、工具执行、事件系统、before/after tool hook |
| `packages/coding-agent` | `@fitclaw/claw` | 主 CLI 应用：TUI、配置、会话、Skill 加载、系统提示词、数据工具 |
| `packages/tui` | `@fitclaw/tui` | 终端 UI 组件和渲染 |
| `packages/mom` | `@fitclaw/mom` | 飞书 Bot 适配层：WebSocket 接入、消息转换、Bot 工具、Docker 部署 |
| `packages/web-ui` | `@fitclaw/web-ui` | Web 聊天 UI 组件，目前不是运动界面主战场 |
| `packages/pods` | `@fitclaw/pods` | GPU Pod 管理 CLI |

依赖方向应保持单向：应用层依赖 Agent 框架层，Agent 框架层依赖 LLM 抽象层；底层包不应反向依赖 CLI/Bot 具体实现。

---

## 运行入口

| 场景 | 命令 | 说明 |
|------|------|------|
| 安装依赖 | `npm install` | 根目录 workspaces |
| 构建 | `npm run build` | 按包依赖顺序构建 |
| CLI | `node packages/coding-agent/dist/cli.js` | 终端交互式 Agent |
| Bot Docker | `cp .env.example .env && docker compose up -d --build` | 推荐飞书 Bot 部署方式 |
| Bot 裸机 | `pm2 start ecosystem.config.cjs` | 需要 PM2 |
| 检查 | `npm run check` | Biome + tsgo + browser smoke + web-ui check |
| 测试 | `npm run test` | 全 workspace 测试 |

开发规则见根目录 [AGENTS.md](../AGENTS.md)。不要自动提交，除非用户明确要求。

---

## Agent 执行模型

FitClaw 内部是标准 ReAct 风格：

1. 应用层组装 `Context`、系统提示词、工具列表和历史消息。
2. `@fitclaw/agent-core` 调用 LLM stream。
3. LLM 返回文本或 tool call。
4. Agent runtime 并行或顺序执行工具。
5. 工具结果进入上下文，继续下一轮推理。
6. 事件流输出给 CLI TUI 或飞书 Bot。

关键文件：

| 需求 | 文件 |
|------|------|
| Agent loop | `packages/agent/src/agent-loop.ts` |
| Agent SDK/session | `packages/coding-agent/src/core/sdk.ts` |
| 系统提示词 | `packages/coding-agent/src/core/system-prompt.ts` |
| Skill 加载 | `packages/coding-agent/src/core/skills.ts` |
| CLI 会话 | `packages/coding-agent/src/modes/interactive/` |
| Bot runner | `packages/mom/src/agent.ts` |

---

## Skill 系统的本质

FitClaw 的运动能力现在走 Model B 纯 Skill 架构。Skill 是文件夹，不是 TypeScript 插件：

```text
<skill>/
  SKILL.md          # 必须：frontmatter + 指令
  references/*.md   # 可选：按需读取的领域知识
  scripts/*         # 可选：Python/bash/Node 脚本
  assets/*          # 可选：静态资源
```

启动时，框架只解析 `SKILL.md` 的 frontmatter，不把全文塞进系统提示词。`formatSkillsForPrompt()` 会注入：

- `name`
- `description`
- `location`
- 若声明了 `data:`，还会注入 `<data_tools>`，包括 `data_<skill>_read` / `data_<skill>_write` 和 namespace 清单

LLM 看到 Skill 元数据后自行判断是否需要读取某个 `SKILL.md`。没有 `selectSkill()`、没有关键词匹配、没有向量检索。这是 progressive disclosure：先给目录，需要时再读正文和资源。

---

## 当前已安装 Skill

| Skill | CLI 位置 | Bot 位置 | 作用 |
|-------|----------|----------|------|
| `bodybuilding` | `.fitclaw/skills/bodybuilding/` | `feishu-workspace/skills/bodybuilding/` | 训练计划、动作查询、训练记录、体测、渐进超负荷 |
| `swimming-coach` | `.fitclaw/skills/swimming-coach/` | `feishu-workspace/skills/swimming-coach/` | 游泳技术、训练计划、配速建议 |

注意：CLI 和 Bot 现在仍是两个 Skill 安装位置。新增或修改 Skill 时需要同步两边，否则 CLI 和 Bot 行为会漂移。

---

## 运动数据持久化

Skill 通过 `SKILL.md` frontmatter 的 `data:` 声明 namespace。框架自动注册：

- `data_<skill>_read`
- `data_<skill>_write`

数据落盘到：

```text
<dataDir>/sport-data/<skillName>/<namespace>.json
```

2026-05-07 后的安全边界：

- read/write 都拒绝未声明 namespace。
- namespace 必须匹配安全字符集，不能包含路径分隔符、绝对路径或 `..`。
- `FileSportDataStore` 会校验 resolved path 必须留在对应 skill 数据目录内。
- `load()` 只有文件不存在时返回 `null`；JSON 损坏、权限错误、路径越界会抛错。
- `save()` 写入失败会抛错，调用方不会再误以为保存成功。
- array namespace 的 append 使用不可变更新。

关键文件：

| 需求 | 文件 |
|------|------|
| data tool | `packages/coding-agent/src/core/tools/skill-data-tools.ts` |
| 文件存储 | `packages/coding-agent/src/core/tools/fitness/sport-data-store.ts` |
| data tool 注册 | `packages/coding-agent/src/core/sdk.ts` |
| Skill prompt 注入 | `packages/coding-agent/src/core/skills.ts` |

---

## 飞书 Bot 现状

`packages/mom` 是飞书 Bot 适配器。它把飞书消息转换成 Agent 输入，并把 Agent 事件流回写到飞书。

已知状态：

- Docker 部署是推荐路径。
- `.env.example` 使用小写 provider 名，例如 `minimax`。
- Docker 镜像需要 Python 以运行 Skill 脚本。
- Bot 从 `feishu-workspace/skills/` 加载 Skill。
- Bot bash 已增加危险命令拦截。

仍需注意：

- `packages/mom/src/main.ts` 的 `uploadFile` 仍是空 stub，动作图片目前无法通过 Bot 发送给用户。
- Bot 场景比 CLI 风险高，群聊中用户可能诱导工具调用。后续仍应补更严格的工具权限、路径边界和 Skill permission manifest。

---

## 当前主要风险与后续方向

| 优先级 | 项目 | 状态 |
|--------|------|------|
| P0 | Skill data 读写边界 | 2026-05-07 已加固，继续保持测试覆盖 |
| P0 | 数据写入错误显式暴露 | 2026-05-07 已加固 |
| P1 | Skill permissions manifest | 未完成。建议先支持 `permissions.commands.allow` 和 `network: false` |
| P1 | CLI/Bot Skill 同步机制 | 未完成。当前仍需人工同步 `.fitclaw/skills/` 与 `feishu-workspace/skills/` |
| P1 | Bot 默认工具权限 | 部分完成。已拦截危险 bash，但还没有完整 sandbox/allowlist 策略 |
| P2 | Web UI 运动界面 | 未完成。目前 `web-ui` 主要是通用聊天 UI |
| P2 | 飞书图片上传 | 未完成。Bot upload stub 需要补齐 |

---

## 修改项目时的路线图

| 要改什么 | 优先看哪里 |
|----------|------------|
| LLM Provider 或流式格式 | `packages/ai/src/` |
| Agent 推理循环、工具执行、事件 | `packages/agent/src/` |
| CLI/TUI、系统提示词、Skill 加载 | `packages/coding-agent/src/` |
| Skill data read/write | `packages/coding-agent/src/core/tools/skill-data-tools.ts` 和 `sport-data-store.ts` |
| bodybuilding 行为 | `.fitclaw/skills/bodybuilding/SKILL.md`、`references/`、`scripts/` |
| 飞书 Bot | `packages/mom/src/`、`Dockerfile`、`docker-compose.yml`、`.env.example` |
| 项目问答/背景 | `docs/QNA.md` |

原则：框架代码不要重新长出健身知识。运动领域流程、知识、脚本和示例应放在 Skill 目录；框架只提供发现、提示词注入、数据工具、工具执行和安全边界。

---

## 文档约定

- `docs/PROJECT_UNDERSTANDING.md`：给后续 AI Agent 的速读上下文，保持短、准、可接手。
- `docs/QNA.md`：给用户看的详细问答、学习路径、风险解释和技术展开。
- `README.md`：给第一次打开仓库的人，保持入口级。
- `CLAUDE.md`：给 Claude Code/AI coding agent 的项目内操作速查。
- `AGENTS.md`：所有 AI coding agent 的开发规则，优先级高于普通项目文档。

更新规则：如果代码事实改变，至少同步 `PROJECT_UNDERSTANDING.md` 和 `QNA.md`；如果入口、命令、架构边界改变，也同步 `README.md` 和 `CLAUDE.md`。
