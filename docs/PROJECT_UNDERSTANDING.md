# FitClaw Project Understanding

> 面向后续 AI Agent 的项目速读。目标是让接手者在 5-10 分钟内理解 FitClaw 是什么、为什么这样设计、当前做到哪里、改动时该看哪些文件。
> 人类可读的深入问答见 [QNA.md](./QNA.md)。飞书第一阶段健身闭环当前状态见 [FEISHU_FITNESS_LOOP_STATUS.md](./FEISHU_FITNESS_LOOP_STATUS.md)。

最后更新：2026-07-14

---

## 一句话定位

FitClaw 是一个飞书优先、具有结构化长期记忆的个人 AI 健身教练。它通过 Skill 提供训练计划、动作查询、训练记录、体测数据和长期进度分析。

Coding CLI、TUI、多 Provider LLM 和通用 Agent loop 是内部基础设施，不是与健身教练并列的产品。第一阶段只以飞书健身闭环作为主要用户体验。

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
| 2026-05-08 | 增加 Skill 同步命令与 eval harness | `fitclaw skill sync` 同步 CLI/Bot Skill；`npm run eval` 用 faux 模型跑确定性 Skill 回归评估 |
| 2026-05-08 | 补强 eval 与拆分核心大文件边界 | eval 支持 `--suite` / `--task` 过滤和 tool policy grader；`interactive-mode.ts` 抽出 Provider 登录策略，`agent-session.ts` 抽出 Skill block parser |
| 2026-05-08 | 补齐 agent eval pass 指标与 Feishu session 基线 | eval 报告输出 `pass@1` / `pass@k` / `pass^k`；新增 10 个真实 Feishu 交互 baseline；grader 增加内容变体、禁止文本和工具参数匹配 |
| 2026-06-16 至 2026-06-18 | 收敛第一阶段飞书健身闭环 | 定义产品方向、飞书用户闭环和健身记忆契约；补齐 onboarding safety、首计划生成、计划调整保存/不保存、训练总结、下一练建议、模糊训练记录、PR 记录等 session eval 护栏 |
| 2026-07-14 | 重构产品与运行时边界 | 飞书主应用迁入 `apps/coach-bot`；新增 `coach-core` 和 `runtime`；移除 `MEMORY.md` 健身事实源 |

核心演进方向：从“框架内置健身逻辑”转向“框架只负责 Agent runtime、安全边界和数据工具，领域能力由 Skill 包承载”。

---

## Monorepo 包边界

| 包 | npm 名 | 职责 |
|----|--------|------|
| `apps/coach-bot` | `@fitclaw/coach-bot` | 主产品：飞书接入、卡片渲染、channel session、工具和部署 |
| `packages/coach-core` | `@fitclaw/coach-core` | FitCoach 产品行为、移动端回复规则和长期数据策略 |
| `packages/runtime` | `@fitclaw/runtime` | 共享 auth/model/settings、JSONL session、压缩/重试生命周期，以及 Skill 发现和 data tools |
| `packages/ai` | `@fitclaw/ai` | 多厂商 LLM 抽象层：统一 `Message`、`Context`、`Model`、流式事件和工具参数校验 |
| `packages/agent` | `@fitclaw/agent-core` | Agent 运行时：ReAct 推理循环、工具执行、事件系统、before/after tool hook |
| `packages/coding-agent` | `@fitclaw/claw` | 开发/调试 CLI：TUI、CLI 专用 AgentSession、命令和扩展系统 |
| `packages/tui` | `@fitclaw/tui` | 终端 UI 组件和渲染 |
| `packages/web-ui` | `@fitclaw/web-ui` | 非核心 Web UI 组件，第一阶段冻结扩张 |
| `packages/pods` | `@fitclaw/pods` | 非核心 GPU Pod 工具，第一阶段冻结扩张 |

依赖方向保持单向：应用层依赖 `@fitclaw/runtime`、Agent 框架层和 LLM 抽象层；共享包不反向依赖 CLI/Bot 具体实现。`apps/coach-bot` 已不再依赖 `@fitclaw/claw`。

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
| Skill eval | `cd packages/coding-agent && npm run eval` | 跑确定性 faux eval，输出到 ignored 的 `eval-results/` |
| Skill eval 过滤 | `cd packages/coding-agent && npm run eval -- --suite skills --task bodybuilding-log` | 只跑指定 suite / task |
| 全量 eval 多轮报告 | `cd packages/coding-agent && npm run eval -- --tasks evals\tasks --out eval-results --runs 3` | 跑所有 YAML eval task，每个任务 3 轮，生成 `eval-results/summary.md`，包含 `pass@1` / `pass@3` / `pass^3` |

开发规则见根目录 [AGENTS.md](../AGENTS.md)。已完成的 feature/bug fix 需要验证、提交并推送；提交时只暂存本轮修改文件。

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
| Skill block parser | `packages/coding-agent/src/core/skill-block.ts` |
| 系统提示词 | `packages/coding-agent/src/core/system-prompt.ts` |
| Skill 加载 | `packages/runtime/src/skills.ts` |
| CLI 会话 | `packages/coding-agent/src/modes/interactive/` |
| Coach policy | `packages/coach-core/src/system-prompt.ts` |
| Bot runner | `apps/coach-bot/src/agent.ts` |
| Bot Skill/runtime 组装 | `apps/coach-bot/src/runtime/skills.ts`、`events.ts` |
| 共享会话生命周期 | `packages/runtime/src/session/managed-agent-session.ts` |
| Bot 会话组装 | `apps/coach-bot/src/runtime/session.ts` |

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

注意：CLI 和 Bot 现在仍是两个 Skill 安装位置。新增或修改 Skill 后，用 `fitclaw skill sync` 将 `.fitclaw/skills/` 同步到 `feishu-workspace/skills/`，避免 CLI 和 Bot 行为漂移。

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
- `FileSkillDataStore` 会校验 resolved path 必须留在对应 skill 数据目录内。
- `load()` 只有文件不存在时返回 `null`；JSON 损坏、权限错误、路径越界会抛错。
- `save()` 写入失败会抛错，调用方不会再误以为保存成功。
- array namespace 的 append 使用不可变更新。

关键文件：

| 需求 | 文件 |
|------|------|
| data tool | `packages/runtime/src/data-tools.ts` |
| 文件存储 | `packages/runtime/src/data-store.ts` |
| data tool 注册 | `packages/coding-agent/src/core/sdk.ts` |
| Skill prompt 注入 | `packages/runtime/src/skills.ts` |

---

## 飞书 Bot 现状

`apps/coach-bot` 是主产品入口。它把飞书消息转换成 Agent 输入，并把 Agent 事件流回写到飞书。FitCoach 行为和长期数据策略位于 `packages/coach-core`，不再由 adapter 内联维护。

已知状态：

- Docker 部署是推荐路径。
- `.env.example` 使用小写 provider 名，例如 `minimax`。
- Docker 镜像需要 Python 以运行 Skill 脚本。
- Bot 从 `feishu-workspace/skills/` 加载 Skill。
- Bot 默认只暴露 `read` 与 Skill data 工具；只有有效 `permissions.commands.allow` 的 Skill 才会启用受限 `bash`。
- 受限 `bash` 只执行声明的本地脚本前缀，参数直接传给单个进程，不再解析任意 shell 字符串。
- `agent.ts` 已拆分为 runner、Skill 组装、会话组装和事件翻译；会话组装直接使用 `@fitclaw/runtime`，不依赖开发 CLI 包。
- 第一阶段飞书健身闭环已经有确定性 session eval 护栏，当前状态见 [FEISHU_FITNESS_LOOP_STATUS.md](./FEISHU_FITNESS_LOOP_STATUS.md)。

仍需注意：

- `apps/coach-bot/src/main.ts` 的 `uploadFile` 仍是空 stub，动作图片目前无法通过 Bot 发送给用户。
- Bot 场景比 CLI 风险高，群聊中用户可能诱导工具调用。命令白名单已落地，后续仍应补 read 路径边界和子进程网络隔离。

---

## 当前主要风险与后续方向

| 优先级 | 项目 | 状态 |
|--------|------|------|
| P0 | Skill data 读写边界 | 2026-05-07 已加固，继续保持测试覆盖 |
| P0 | 数据写入错误显式暴露 | 2026-05-07 已加固 |
| P1 | Skill permissions manifest | 部分完成。`permissions.commands.allow` 已支持；子进程级网络隔离尚未完成，不应仅靠 manifest 声明 `network: false` |
| P1 | CLI/Bot Skill 同步机制 | 2026-05-08 已增加 `fitclaw skill sync`，后续可补 `validate/audit` |
| P1 | Bot 默认工具权限 | 部分完成。默认移除 `edit` / `write` 和任意 shell，仅按 Skill 声明启用本地脚本；read 路径边界仍待加固 |
| P1 | CLI/应用会话生命周期收敛 | 部分完成。Coach 已使用共享 `ManagedAgentSession`；CLI 的大型 `AgentSession` 后续应复用共享持久化、重试和压缩控制器 |
| P2 | Web UI 运动界面 | 未完成。目前 `web-ui` 主要是通用聊天 UI |
| P2 | 飞书图片上传 | 未完成。Bot upload stub 需要补齐 |

---

## Eval harness 当前状态

`packages/coding-agent` 内置确定性 eval harness。当前实现是 **faux-response contract eval**：任务 YAML 定义 prompt、模拟模型响应、初始数据和 graders；runner 用 faux 模型重放响应并验证工具调用、文件状态和最终文本。它适合做回归基线和 pass 指标报告，但还不是 live model eval；如果要评估当前线上模型真实表现，后续需要接入 live model runner。

运行命令：

```bash
cd packages/coding-agent
npm run eval -- --tasks evals\tasks --out eval-results --runs 3
```

输出：

- `eval-results/summary.md`：自动报告 `pass@1`、`pass@k`、`pass^k`，并列出 trial pass rate、grader pass rate、平均工具调用数、平均轮次和 transcript 路径。
- `eval-results/transcripts/`：每个任务每轮的 Agent 事件 JSONL。
- `eval-results/workspaces/`：每个任务的隔离工作区，包含 grader 检查用的写入文件。

已支持 graders：

- 文本：`final_contains`、`final_contains_any`、`final_not_contains`
- 工具：`tool_called`、`tool_not_called`、`tool_sequence`、`tool_args_match`
- 文件/数据：`json_path_equals`、`file_exists`、`file_not_exists`
- 效率边界：`max_tool_calls`、`max_turns`

已沉淀 23 个 Feishu session eval，位于 `packages/coding-agent/evals/tasks/session/`，覆盖身份介绍、用户画像写入、伤病信息 gate、首计划生成、计划调整保存/不保存、训练日志写入、PR 记录、体测写入、渐进超负荷事件、训练总结、明日训练安排、缺计划不编造、肩痛动作替换、天气边界、游泳换气和腰痛硬拉安全边界。

人工只应在新增真实场景、校准 graders、处理 false positive/false negative 或引入 LLM judge 时介入；已确认的任务日常用命令自动跑报告。

---

## 修改项目时的路线图

| 要改什么 | 优先看哪里 |
|----------|------------|
| LLM Provider 或流式格式 | `packages/ai/src/` |
| Agent 推理循环、工具执行、事件 | `packages/agent/src/` |
| CLI/TUI、系统提示词、Skill 加载 | `packages/coding-agent/src/`；Provider 登录策略在 `modes/interactive/provider-login-policy.ts` |
| Skill eval harness | `packages/coding-agent/src/evals/`、`packages/coding-agent/evals/tasks/` |
| Skill data read/write | `packages/runtime/src/data-tools.ts` 和 `data-store.ts` |
| bodybuilding 行为 | `.fitclaw/skills/bodybuilding/SKILL.md`、`references/`、`scripts/` |
| 飞书 Bot | `apps/coach-bot/src/`、`packages/coach-core/src/`、`Dockerfile`、`docker-compose.yml`、`.env.example` |
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
