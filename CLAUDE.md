# CLAUDE.md — FitClaw 项目指南

> **Claude Code 专属入口** — 项目上下文、架构、配置、文件速查。
> 通用开发规则（所有 AI Agent 共享）→ [AGENTS.md](./AGENTS.md)

## 一句话定位

**FitClaw = AI 运动私教 + 智能编程助手**，全栈 AI Agent 平台。

## 项目来历

| 时间 | 事件 |
|------|------|
| 2026-04 | 项目初始化，基于 TypeScript monorepo 架构 |
| 2026-04 | 全部 7 个包统一使用 `@fitclaw/*` 命名空间 |
| 2026-04 | 新增运动私教功能（11 个 Agent 工具 + 动作数据库 + 知识库） |
| 2026-05 | bodybuilding Skill 集成（800+ 动作），fitness-coach 删除，全面迁移到 Model B 纯 Skill 架构 |
| 2026-04 | 新增飞书 Bot 适配器 |
| 2026-04 | 配置系统统一到 `.fitclaw/` |
| 2026-04 | 推送到 [Sanery1/FitClaw](https://github.com/Sanery1/FitClaw) |

## 架构概览

7 个 npm 包，monorepo 结构：

| 包 | npm 名 | 职责 |
|----|--------|------|
| `packages/ai` | `@fitclaw/ai` | 多厂商 LLM API 统一层 |
| `packages/agent` | `@fitclaw/agent-core` | Agent 运行时：工具调用、状态管理 |
| `packages/coding-agent` | `@fitclaw/claw` | **主 CLI 应用**（交互式 TUI） |
| `packages/tui` | `@fitclaw/tui` | 终端 UI 组件库 |
| `packages/mom` | `@fitclaw/mom` | 飞书 Bot |
| `packages/web-ui` | `@fitclaw/web-ui` | Web 聊天 UI 组件 |
| `packages/pods` | `@fitclaw/pods` | GPU Pod 管理 CLI |

AI 接手速读 → [docs/PROJECT_UNDERSTANDING.md](./docs/PROJECT_UNDERSTANDING.md)
架构学习、问答与风险记录 → [docs/QNA.md](./docs/QNA.md)

## 近期完成

- **Bot Skill 完整修复 (2026-05-03)**: 修复 6 个问题打通 Bot 本地数据库查询链路：
  1. `.env.example` Provider 名 `MiniMax`→`minimax`（匹配内置 Provider）
  2. `docker/entrypoint.sh` 中 `node -e`→`node -p`（修复 auth.json/models.json 空文件）
  3. Skill 文件从 `.fitclaw/skills/` 同步到 `feishu-workspace/skills/`（Bot volume 可访问）
  4. `agent.ts` `buildSystemPrompt` 重写 Fitness Tools 为 "How to Use Skills"（LLM 不再幻觉工具名）
  5. `system-prompt.ts` 删除 custom prompt 路径中重复的 skills 嵌入
  6. `Dockerfile` 安装 Python 3.11（支持 `scripts/query_exercises.py`）
  7. bodybuilding SKILL.md description 添加 MUST-use 触发器
- Docker 容器化部署 (2026-05-01, f42f70d2): Dockerfile + docker-compose.yml + .env 统一配置
- pi-mono/fork 引用清理 (2026-05-01, be21ba30): 文档去 fork 化 + 根目录 .pi/ 删除
- PI_ 向后兼容彻底移除 (2026-05-02, c7d6ba52): 26 个源文件中所有 `process.env.PI_*` fallback 全部移除
- Slack 代码全部删除 (2026-05-02): mom 包纯飞书化，删除 slack.ts/download.ts/events.ts，移除 `@slack/*` 依赖
- **Model B 纯 Skill 架构 (2026-05-02)**: 删除 fitness-coach (Model A)、删除 11 个 AgentTool + jiti 动态加载、删除 fitnessMode 标志。改为 `data:` frontmatter 声明 + 框架自动注册 `data_<skill>_read/write` 工具。新增 bodybuilding skill (800+ 动作 Python 数据库)。swimming-coach 同步迁移
- **Skill 数据边界加固 (2026-05-07)**: `data_<skill>_read/write` 统一拒绝未声明 namespace；`FileSportDataStore` 校验 namespace 字符集和路径边界，JSON 损坏/权限/写入失败会返回工具错误；Bot bash 增加危险命令拦截

项目接手速读维护在 [docs/PROJECT_UNDERSTANDING.md](./docs/PROJECT_UNDERSTANDING.md)。完整历史、技术问答与风险说明统一维护在 [docs/QNA.md](./docs/QNA.md)。

## 待完成

1. **Web UI 运动界面** — `packages/web-ui` 目前只有通用聊天界面
2. **飞书图片上传** — `packages/mom/src/main.ts` `uploadFile` 是空 stub，即使 `read` 工具能读图片也无法发送给用户。动作图片在数据库中存在但 Bot 无法传递

## 运动数据架构（Model B 纯 Skill）

### 设计原则

Skill 作者**不接触任何框架类型**。Skill = SKILL.md + references/ + scripts/ + assets/。
框架通过 `data:` frontmatter 声明自动提供持久化能力，并在工具层与存储层同时强校验 namespace。

### 数据存储位置

| 数据类型 | 来源 | 存储 |
|---------|------|------|
| 动作数据库 | `free-exercise-db/` (bodybuilding skill 内嵌) | 磁盘，永久（800+ 动作 JSON + 图片） |
| 用户画像 / 训练记录 / 计划 | LLM 通过 `data_<skill>_read/write` 工具 | `<dataDir>/sport-data/{skillName}/{namespace}.json` |
| 对话历史 | 消息记录 | `<channelDir>/context.jsonl` + `log.jsonl` |

### 数据写入流程 (Model B)

```
用户消息 → LLM 结合 SKILL.md 指令决策
  → LLM 调用 data_bodybuilding_write("training_log", {...}, "append")
    → FileSportDataStore.save("bodybuilding/training_log", data)
      → {dataDir}/sport-data/bodybuilding/training_log.json
```

### Skill 系统（2026-05-02 Model B 改造后）

Skill 目录结构：
- `SKILL.md` — 必须，frontmatter + 正文（可含 `data:` 声明）
- `references/*.md` — 可选，渐进式知识库
- `scripts/*` — 可选，任意语言脚本（Python/bash/Node），LLM 通过 bash 调用
- `assets/*` — 可选，静态数据

**安装位置**：`~/.fitclaw/agent/skills/`（用户级）或 `.fitclaw/skills/`（项目级）

### `data:` 声明（Model B 持久化）

在 SKILL.md frontmatter 中声明 namespace，框架自动注册 `data_<skillName>_read` 和 `data_<skillName>_write` Agent Tool：

```yaml
---
name: bodybuilding
data:
  user_profile: {}             # object 类型，write 默认 replace
  training_log: {type: array}  # array 类型，write 默认 append
---
```

框架自动行为：
1. 初始化 namespace JSON 文件（`{dataDir}/sport-data/{skillName}/{namespace}.json`）
2. 注册 `data_<skillName>_read` / `data_<skillName>_write` Agent Tool
3. 设置 `FITCLAW_DATA_DIR` 环境变量 → `{dataDir}/sport-data`

### 已安装 Skill

| Skill | 位置（CLI） | 位置（Bot） | 工具 | 数据 |
|-------|------------|------------|------|------|
| bodybuilding | `.fitclaw/skills/bodybuilding/` | `feishu-workspace/skills/bodybuilding/` | `data_bodybuilding_read/write` + bash 脚本 | 6 个 namespace + 800+ 动作数据库 |
| swimming-coach | `.fitclaw/skills/swimming-coach/` | `feishu-workspace/skills/swimming-coach/` | `data_swimming-coach_read/write` | 3 个 namespace |

> **注意**：CLI 从 `.fitclaw/skills/` 加载，Bot 从 `feishu-workspace/skills/` 加载。
> 安装新 skill 需要同步到两个位置。`feishu-workspace/` 是 Docker volume 挂载，文件放入后立即可见。

### 添加新 Skill 的步骤

1. 在 `.fitclaw/skills/<name>/` 创建目录
2. 编写 `SKILL.md`（含 `data:` 声明 + 精准 `description`，描述应包含触发场景和为什么必须用 skill）
3. 可选：添加 `references/`、`scripts/`、`assets/`
4. **同步到 Bot**：`cp -r .fitclaw/skills/<name> feishu-workspace/skills/`（如果要让飞书 Bot 使用）
5. 框架自动发现并注册 data 工具

## 如何启动

```bash
npm install
npm run build                          # 构建全部包

# CLI 启动（开发模式）
node packages/coding-agent/dist/cli.js
# 或使用启动脚本（从 ~/.claude/settings.json 读取环境变量）
./start.sh

# Bot 部署（推荐 Docker，生产环境）
cp .env.example .env && docker compose up -d --build

# Bot 部署（裸机）
pm2 start ecosystem.config.cjs         # 需 PM2
```

## 配置系统

FitClaw 配置目录：`~/.fitclaw/agent/`

| 文件 | 用途 |
|------|------|
| `settings.json` | 默认 Provider、模型、主题 |
| `auth.json` | API Key 存储 |
| `models.json` | 自定义 Provider baseUrl |

配置方式 → 参考早前对话或查看 `packages/coding-agent/src/config.ts`

## 关键文件速查

| 需求 | 路径 |
|------|------|
| Skill data 工具实现 | `packages/coding-agent/src/core/tools/skill-data-tools.ts` |
| SportDataStore 接口 | `packages/coding-agent/src/core/tools/fitness/sport-data-store.ts` |
| bodybuilding Skill | `.fitclaw/skills/bodybuilding/` (SKILL.md + 800+ 动作数据库 + 9 份 references) |
| swimming-coach Skill | `.fitclaw/skills/swimming-coach/` (SKILL.md + 3 份 references) |
| Skill 加载与解析 | `packages/coding-agent/src/core/skills.ts` |
| data 工具注册 | `packages/coding-agent/src/core/sdk.ts` `createAgentSession()` |
| fitclaw-data CLI | `packages/coding-agent/src/cli/fitclaw-data.ts` |
| MOM Bot 工具注册 | `packages/mom/src/agent.ts` `createRunner()` |
| MOM Bot 系统提示词 | `packages/mom/src/agent.ts` `buildSystemPrompt()` |
| 系统提示词 | `packages/coding-agent/src/core/system-prompt.ts` |
| Docker 镜像 | `Dockerfile` + `docker-compose.yml` |
| Bot 入口脚本 | `docker/entrypoint.sh` |
| Bot 环境配置 | `.env.example` |
| 启动界面 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` |
| 配置文件 | `packages/coding-agent/src/config.ts` |
| CLI 参数解析 | `packages/coding-agent/src/cli/args.ts` |
| 设置管理 | `packages/coding-agent/src/core/settings-manager.ts` |
| 模型注册 | `packages/coding-agent/src/core/model-registry.ts` |
