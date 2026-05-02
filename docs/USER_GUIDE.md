# FitClaw 使用指南

> AI 健身私教 + 智能编程助手。适用版本：0.70.x

---

## 两个入口，两套程序

FitClaw 包含 **两个独立的可执行程序**，共享底层 Agent 引擎但用途不同：

| | `fitclaw`（CLI） | `mom`（Bot） |
|------|----------|--------|
| **启动命令** | `fitclaw` 或 `node packages/coding-agent/dist/cli.js` | `mom <workspace>` 或 `node packages/mom/dist/main.js <workspace>` |
| **做什么** | 终端里的交互式 AI 编程助手 | 后台服务，把 Agent 接入飞书群聊 |
| **谁用** | 开发者直接在终端里用 | 终端用户通过飞书群聊用 |
| **运行方式** | 前台交互式 TUI | 后台守护进程（通常用 PM2） |
| **健身能力** | 通过已安装的 skill 使用 | 始终开启（加载 skill 的数据工具） |
| **npm 包** | `@fitclaw/claw` | `@fitclaw/mom` |

**输入 `fitclaw` 不会启动飞书 Bot。** 它们是两个命令，互不依赖。

---

## 目录

1. [快速开始](#1-快速开始)
2. [安装与构建](#2-安装与构建)
3. [CLI 命令行使用](#3-cli-命令行使用)
4. [交互模式操作](#4-交互模式操作)
5. [健身私教模式](#5-健身私教模式)
6. [Bot 部署（飞书）](#6-bot-部署飞书)
7. [配置系统](#7-配置系统)
8. [LLM Provider 配置](#8-llm-provider-配置)
9. [知识库 & 技能系统](#9-知识库--技能系统)
10. [扩展系统](#10-扩展系统)
11. [会话管理](#11-会话管理)
12. [常用使用场景](#12-常用使用场景)
13. [环境变量参考](#13-环境变量参考)
14. [故障排查](#14-故障排查)

---

## 1. 快速开始

一分钟体验 FITCLAW：

```bash
# 安装依赖
npm install

# 构建全部包
npm run build

# 启动交互式 CLI（编程助手 + 健身私教）
node packages/coding-agent/dist/cli.js
```

首次运行需要配置 API Key（见 [LLM Provider 配置](#8-llm-provider-配置)）。

---

## 2. 安装与构建

### 2.1 从源码构建

```bash
git clone https://github.com/Sanery1/FitClaw.git
cd FitClaw
npm install
npm run build
```

`npm run build` 会按依赖顺序构建 7 个包：
ai → agent-core → tui → coding-agent → mom → web-ui → pods

### 2.2 开发模式

```bash
# 并行启动所有包的 watch 模式
npm run dev

# 单独运行 coding-agent
cd packages/coding-agent && npx tsx src/cli.ts
```

### 2.3 全局安装

```bash
npm install -g @fitclaw/claw
fitclaw    # 启动
```

---

## 3. CLI 命令行使用

### 3.1 基本语法

```
fitclaw [options] [@files...] [messages...]
```

### 3.2 模式选择

| 模式 | 参数 | 说明 |
|------|------|------|
| 交互式 | 默认 | TUI 终端界面，支持多轮对话 |
| 非交互 | `--print` / `-p` | 处理消息后退出，适合脚本/管道 |
| JSON 输出 | `--mode json` | 结果以 JSON 格式输出 |
| RPC 模式 | `--mode rpc` | JSON-RPC over stdio（IDE 集成用） |

### 3.3 会话控制

```bash
# 继续上次会话
fitclaw --continue

# 选择历史会话恢复
fitclaw --resume

# 指定会话 ID（完整或前缀匹配）
fitclaw --session abc123

# Fork 会话到新分支
fitclaw --fork abc123

# 不保存会话（临时会话）
fitclaw --no-session

# 自定义会话存储目录
fitclaw --session-dir ~/my-sessions
```

### 3.4 模型选择

```bash
# 指定 Provider + 模型
fitclaw --provider openai --model gpt-4o

# 使用 provider/model 简写
fitclaw --model anthropic/claude-sonnet-4-6

# 带 thinking level 的简写
fitclaw --model sonnet:high

# 模型切换热键列表（Ctrl+P 循环）
fitclaw --models "claude-sonnet,gpt-4o,gemini-pro"

# 限制到某个 provider 的所有模型
fitclaw --models "github-copilot/*"

# 查看可用模型
fitclaw --list-models
fitclaw --list-models "sonnet"     # 模糊搜索
```

### 3.5 工具控制

```bash
# 只读模式（禁止 bash/edit/write）
fitclaw --tools read,grep,find,ls

# 禁用所有工具
fitclaw --no-tools

# 禁用内置工具（保留扩展工具）
fitclaw --no-builtin-tools

# 启用特定工具 + 所有默认工具
fitclaw --tools bash,read,write
```

### 3.6 Thinking 控制

```bash
fitclaw --thinking high     # 深度思考（复杂问题）
fitclaw --thinking off      # 关闭思考（快速响应）
fitclaw --thinking low      # 轻量思考
```

可选值：`off`, `minimal`, `low`, `medium`, `high`, `xhigh`

### 3.7 文件参数

```bash
# 把文件内容加入初始消息
fitclaw @README.md "Summarize this"

# 多个文件
fitclaw @prompt.md @image.png "Analyze these"
```

### 3.8 扩展与技能

```bash
# 加载扩展
fitclaw --extension ./my-extension.ts

# 禁用自动发现的扩展
fitclaw --no-extensions

# 加载技能
fitclaw --skill ./my-skill.md

# 禁用技能加载
fitclaw --no-skills

# 加载提示模板
fitclaw --prompt-template ./my-prompt.md
```

### 3.9 导出

```bash
# 导出会话为 HTML
fitclaw --export ~/.fitclaw/agent/sessions/abc/session.jsonl
fitclaw --export session.jsonl output.html
```

---

## 4. 交互模式操作

启动后进入 TUI 终端界面：

### 4.1 基本交互

| 操作 | 方式 |
|------|------|
| 输入消息 | 直接输入，Enter 发送 |
| 多行输入 | `\` + Enter 换行 |
| 中断执行 | `Ctrl+C` |
| 退出 | `Ctrl+D` 或输入 `/exit` |

### 4.2 内置命令

| 命令 | 说明 |
|------|------|
| `/exit` | 退出程序 |
| `/model` | 切换模型 |
| `/thinking` | 调整 thinking level |
| `/compact` | 手动压缩上下文 |
| `/clear` | 清屏 |
| `/help` | 帮助信息 |
| `/share` | 分享会话 |
| `/export` | 导出会话 |

### 4.3 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+P` | 循环切换模型 |
| `Ctrl+L` | 清屏 |
| `Ctrl+C` | 中断当前操作 |
| `Ctrl+D` | 退出（空输入时） |

---

## 5. 健身私教模式（Model B 纯 Skill）

### 5.1 架构

健身功能不再需要 `--fitness` flag。框架自动加载 `.fitclaw/skills/` 中的 skill。每个 skill 声明 `data:` namespaces，框架自动注册 `data:{skill}:read` / `data:{skill}:write` 工具。

### 5.2 已安装的健身 Skill

| Skill | 动作数据库 | 工具 | 功能 |
|-------|-----------|------|------|
| bodybuilding | 800+ 动作（free-exercise-db） | `data:bodybuilding:read/write` | 用户画像 → 训练计划 → 动作教学 → 渐进超负荷 |
| swimming-coach | 泳姿教学 | `data:swimming-coach:read/write` | 泳姿纠正、训练计划、配速追踪 |

### 5.3 使用方式

在 CLI 或 Bot 中自然对话即可。Agent 会自动调用 bodybuilding skill 的 Python 查询脚本和数据持久化工具。

```bash
# 查询动作（Agent 自动调用 scripts/query_exercises.py）
"有哪些哑铃胸部的动作？"
"给我设计一个新手全身训练计划"

# 数据自动持久化到 sport-data/bodybuilding/
"我今天练了卧推 60kg 3x10"
"查看我的训练进度"
```

### 5.4 数据存储

用户数据通过 `data:{skill}:write` 持久化：
- **CLI**：`~/.fitclaw/agent/sessions/<session-id>/sport-data/{skillName}/{namespace}.json`
- **Bot**：`<workingDir>/<channelId>/sport-data/{skillName}/{namespace}.json`

### 5.5 动作查询脚本

bodybuilding skill 自带 Python 查询脚本：

```bash
# 按肌群查询
python .fitclaw/skills/bodybuilding/scripts/query_exercises.py --muscle chest --equipment dumbbell

# 查询单个动作详情
python .fitclaw/skills/bodybuilding/scripts/query_exercises.py --id "Incline_Dumbbell_Press" --detailed

# 列出所有可用肌群
python .fitclaw/skills/bodybuilding/scripts/query_exercises.py --list-muscles
```

---

## 6. Bot 部署（飞书）

### 6.1 架构概述

```
用户消息（飞书）
    ↓
Bot 适配器（FeishuBot）接收 → 创建 BotContext
    ↓
获取/创建 ChannelState（按 channel 隔离）
    ↓
AgentRunner → AgentSession.prompt()
    ↓
通过 BotContext 返回回复
```

### 6.2 启动 Bot（推荐：Docker）

```bash
cp .env.example .env        # 填 key
docker compose up -d --build # 构建+启动
docker compose logs -f       # 查看日志
```

完整步骤（验证、更新、排错）→ [12.4 飞书群聊 Bot（Docker 部署）](#124-飞书群聊-botdocker-部署)

### 6.3 启动 Bot（裸机）

```bash
# 飞书 Bot
MOM_FEISHU_APP_ID="cli_xxxx" \
MOM_FEISHU_APP_SECRET="xxxx" \
node packages/mom/dist/main.js ./feishu-workspace

# 带 sandbox
node packages/mom/dist/main.js --sandbox=docker:sandbox-name ./workspace
```

### 6.4 PM2 持久化部署

```bash
pm2 start ecosystem.config.cjs
pm2 logs --lines 50
pm2 save
```

### 6.5 飞书配置

1. 创建飞书企业自建应用
2. 获取 App ID 和 App Secret
3. 在飞书开放平台开启机器人能力
4. 配置事件订阅（WebSocket 长连接模式）
5. 设置环境变量：
   - `MOM_FEISHU_APP_ID` — 飞书应用 ID
   - `MOM_FEISHU_APP_SECRET` — 飞书应用密钥
   - `MOM_FEISHU_BOT_NAME` — Bot 显示名称（默认 "FitCoach"）

### 6.6 用户隔离

- 单聊：按 `channelId` 隔离
- 群聊 @ 提及：按 `channelId/userId` 隔离
- 每个 channel 有独立的 `AgentRunner` 和 `ChannelStore`
- 健身数据在各 channel 目录下隔离

---

## 7. 配置系统

### 7.1 配置目录

所有配置存储在 `~/.fitclaw/agent/`：

```
~/.fitclaw/agent/
├── settings.json     # 全局设置
├── auth.json         # API Key 存储
├── models.json       # 自定义模型列表
├── sessions/         # 会话文件
│   ├── abc123/
│   │   ├── session.jsonl         # 会话消息
│   │   └── sport-data/            # 运动数据（按 skill/namespace 分文件）
│   └── ...
├── prompts/          # 自定义提示模板
├── themes/           # 自定义主题
├── skills/           # 自定义技能
├── tools/            # 工具配置
└── bin/              # 托管二进制文件
```

### 7.2 settings.json

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-6",
  "defaultThinkingLevel": "medium",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "terminal": {
    "showImages": true,
    "imageWidthCells": 60
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "provider": {
      "timeoutMs": 120000,
      "maxRetries": 3
    }
  },
  "image": {
    "autoResize": true,
    "blockImages": false
  }
}
```

### 7.3 models.json

自定义 Provider：

```json
[
  {
    "id": "my-custom-model",
    "name": "My Custom Model",
    "provider": "openai",
    "baseUrl": "https://my-proxy.example.com/v1",
    "contextWindow": 128000,
    "maxTokens": 4096,
    "input": "text",
    "supportsToolUse": true,
    "supportsImages": true,
    "supportsThinking": false
  }
]
```

### 7.4 auth.json

存储 API Key（也支持环境变量）：

```json
{
  "openai": "sk-proj-...",
  "deepseek": "sk-...",
  "custom_providers": {
    "my-provider": "sk-..."
  }
}
```

---

## 8. LLM Provider 配置

### 8.1 支持的 Provider

| Provider | 环境变量 | 支持的模型系列 |
|----------|----------|---------------|
| Anthropic | `ANTHROPIC_API_KEY` | Claude 4.7 Opus/Sonnet/Haiku, 4.5/4.6 系列 |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, GPT-4.1, o4-mini, o3 系列 |
| Google Gemini | `GEMINI_API_KEY` | Gemini 2.5 Pro/Flash |
| DeepSeek | `DEEPSEEK_API_KEY` | DeepSeek-V3, DeepSeek-R1 |
| xAI Grok | `XAI_API_KEY` | Grok 系列 |
| Groq | `GROQ_API_KEY` | Llama 系列（Groq LPU 加速） |
| Fireworks | `FIREWORKS_API_KEY` | 多模型 |
| OpenRouter | `OPENROUTER_API_KEY` | 多模型聚合 |
| Mistral | `MISTRAL_API_KEY` | Mistral 系列 |
| Cerebras | `CEREBRAS_API_KEY` | Llama 系列（Cerebras 加速） |
| MiniMax | `MINIMAX_API_KEY` | MiniMax 系列 |
| Kimi | `KIMI_API_KEY` | Kimi For Coding |
| Cloudflare | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` | Workers AI |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` + base URL | GPT 系列 |
| AWS Bedrock | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Claude, Llama 等 |
| GitHub Copilot | 自动从 gh CLI 获取 token | GPT-4o, Claude |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | 多模型 |

### 8.2 模型自动发现

启动时会自动从 Provider API 拉取可用模型列表，缓存到 `~/.fitclaw/agent/models.json`。

---

## 9. 知识库 & 技能系统

### 9.1 技能目录结构

Sport Skill 遵循标准化 Skills 格式，对齐 [Agent Skills 规范](https://agentskills.io/specification)：

```
.fitclaw/skills/<skill-name>/
├── SKILL.md          # 【必须】name + description frontmatter + 指令正文
├── scripts/          # 【可选】可执行工具代码
│   └── tools.ts      #   createTools(store): AgentTool[]
├── references/       # 【可选】渐进式知识库文件
│   └── *.md          #   LLM 按需 read，不占 system prompt
└── assets/           # 【可选】静态数据文件
    └── *.json        #   工具代码引用
```

已安装的 Skill 自动被发现（通过 `~/.fitclaw/agent/skills/` 或 `.fitclaw/skills/`）。

### 9.2 Skills（技能）

Skills 定义专门的能力领域。自动渐进式加载：

| 层级 | 内容 | 加载时机 |
|------|------|----------|
| Layer 1 | name + description (~100 tokens) | 始终在 system prompt |
| Layer 2 | SKILL.md 正文 (<5000 tokens) | Skill 激活时 |
| Layer 3 | scripts/tools.ts | Skill 激活时（jiti 动态导入） |
| Layer 3 | references/*.md | LLM 按需 read |

可用 `/skill:name` 在交互中手动激活。

### 9.3 知识库（渐进式加载）

知识库采用**渐进式披露**模式：system prompt 只注入文件名索引（~100 tokens），LLM 在需要具体知识时通过 `read` 工具按需加载对应文件。

旧的知识库位置（`.fitclaw/prompts/`）已废弃，内容已迁移到 `.fitclaw/skills/<skill-name>/references/`。

### 9.4 CLAUDE.md / AGENTS.md

项目根目录的 `CLAUDE.md` 或 `AGENTS.md` 会自动加载到 Agent 上下文中，让 Agent 了解项目背景。

---

## 10. 扩展系统

### 10.1 扩展能力

扩展可以注册以下能力：

| 能力 | API | 说明 |
|------|-----|------|
| 注册命令 | `pi.registerCommand()` | `/xxx` 斜杠命令 |
| 注册工具 | `pi.registerTool()` | 动态添加 Agent 工具 |
| 拦截输入 | `pi.on("input")` | 修改或拦截用户输入 |
| 拦截工具调用 | `pi.on("tool_call")` | 允许/阻止工具调用 |
| 拦截工具结果 | `pi.on("tool_result")` | 修改工具返回结果 |
| 修改请求 | `pi.on("before_provider_request")` | 修改 LLM 请求 payload |
| 会话事件 | `pi.on("session_start"/"session_end")` | 生命周期钩子 |
| 资源发现 | `pi.on("resources_discover")` | 动态加载技能/主题 |

### 10.2 管理扩展

```bash
fitclaw install <source>     # 安装扩展
fitclaw remove <source>      # 移除扩展
fitclaw list                 # 列出已安装扩展
fitclaw update               # 更新 FitClaw 和扩展
fitclaw config               # TUI 配置界面
```

---

## 11. 会话管理

### 11.1 会话文件格式

会话数据以 JSONL 格式存储在 `~/.fitclaw/agent/sessions/`：

```
sessions/
├── <session-id>/
│   ├── session.jsonl      # 主会话文件（消息 + 事件）
│   ├── log.jsonl          # 日志
│   ├── context.jsonl      # 上下文
│   └── sport-data/        # 运动数据（仅健身模式）
│       └── fitness.json
```

### 11.2 上下文压缩（Compaction）

当对话 token 数超过模型上下文窗口时，自动触发压缩：
- 早期对话被 LLM 自动总结
- 保留最近 N tokens 的完整对话
- 可通过 `/compact` 手动触发

相关配置：
```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

### 11.3 分支（Fork）

每次 `/fork` 创建新的对话分支，保留原分支不变。树形结构：

```
Entry (id, parentId, type)
    ├── message (user/assistant/toolResult)
    ├── compaction (摘要)
    ├── branchSummary
    └── model_change / thinking_level_change
```

---

## 12. 常用使用场景

### 12.1 代码审查

```bash
fitclaw -p @src/**/*.ts "Review this code for bugs and security issues"
```

### 12.2 自动化脚本

```bash
echo "List all TODO comments in src/" | npx fitclaw -p
```

### 12.3 健身私教（CLI）

```bash
fitclaw "我想开始健身，帮我设计一个新手训练计划"
fitclaw "今天练了深蹲 3x10 60kg"
fitclaw "查看我的训练进度"
```

### 12.4 飞书群聊 Bot（Docker 部署）

#### 前置条件

- 安装 Docker Desktop 或 Docker Engine
- 已在飞书开放平台创建应用，获取 App ID 和 App Secret

#### 第一步：配置

所有配置统一到 `.env` 一个文件：

```bash
cp .env.example .env
```

编辑 `.env`，填入真实值：

```ini
# 必填 — 飞书
MOM_FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
MOM_FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 必填 — LLM
MOM_LLM_PROVIDER=deepseek
MOM_LLM_MODEL=deepseek-v3
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

#### 第二步：构建并启动

```bash
# 构建镜像 + 后台启动
docker compose up -d --build

# 首次构建约 5-10 分钟（npm install + 编译），后续更新会利用缓存更快
```

#### 第三步：验证

```bash
# 查看启动日志
docker compose logs -f

# 看到类似输出表示成功：
#   Feishu Bot "FitCoach" starting...
#   WebSocket connected

# 去飞书群聊 @Bot 发一条消息，确认回复正常
```

#### 日常运维

```bash
docker compose logs -f          # 实时日志
docker compose logs --tail=100  # 最近 100 行
docker compose restart          # 重启 Bot
docker compose stop             # 暂停（不删容器）
docker compose down             # 停止并删除容器（数据不丢）
```

#### 更新代码

```bash
git pull
docker compose up -d --build    # 重建镜像并重启
# 用户数据（训练记录）在 feishu-workspace/ 不受影响
```

#### 修改配置

```bash
vim .env                             # 改 key 或切换模型
docker compose down && docker compose up -d  # 重建容器使配置生效
```
> 注意：`docker compose restart` 不会重新生成配置文件。必须 `down && up -d` 才能让 entrypoint.sh 重新运行。

#### 数据在哪

```
feishu-workspace/               ← 宿主机目录，删容器不丢
├── <channelId>/
│   ├── sport-data/              ← 运动数据
│   │   └── fitness.json         ← 用户训练记录
│   ├── context.jsonl           ← 对话历史
│   └── log.jsonl               ← 运行日志
```

#### 故障排查

```bash
# 构建失败？
docker compose build --no-cache   # 强制重构建

# 容器反复重启？
docker compose logs --tail=50     # 看错误原因
# 常见：.env 里 key 填错、飞书 app 没开机器人能力

# 镜像太大？
docker system prune -a            # 清理旧镜像和构建缓存
```

配置全部收敛到 `.env` 一个文件——无论是 Docker、PM2 还是手动启动，都读同一个 `.env`。

### 12.5 飞书群聊 Bot（裸机部署）

```bash
# 第一次启动
source .env
node packages/mom/dist/main.js ./feishu-workspace &

# 使用 PM2 持久化（继承当前 shell 环境）
pm2 start ecosystem.config.cjs
```

### 12.6 CI/CD 代码分析

```bash
fitclaw --mode json --model sonnet:high -p \
  "Analyze this PR diff for breaking changes" @diff.txt
```

### 12.7 限制工具的安全模式

```bash
# 只允许只读操作
fitclaw --tools read,grep,find,ls -p "Explore the codebase structure"
```

---

## 13. 环境变量参考

### 13.1 API Keys

| 变量 | Provider |
|------|----------|
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `OPENAI_API_KEY` | OpenAI GPT |
| `GEMINI_API_KEY` | Google Gemini |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq |
| `XAI_API_KEY` | xAI Grok |
| `FIREWORKS_API_KEY` | Fireworks |
| `OPENROUTER_API_KEY` | OpenRouter |
| `MISTRAL_API_KEY` | Mistral |
| `KIMI_API_KEY` | Kimi |
| `CLOUDFLARE_API_KEY` | Cloudflare |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI |
| `AWS_ACCESS_KEY_ID` | AWS Bedrock |
| `AWS_SECRET_ACCESS_KEY` | AWS Bedrock |

### 13.2 Bot 专用

| 变量 | 用途 |
|------|------|
| `MOM_FEISHU_APP_ID` | 飞书应用 ID |
| `MOM_FEISHU_APP_SECRET` | 飞书应用密钥 |
| `MOM_FEISHU_BOT_NAME` | 飞书 Bot 显示名 |
### 13.3 FitClaw 通用

| 变量 | 说明 |
|------|------|
| `FITCLAW_CODING_AGENT_DIR` | 会话存储目录（默认 `~/.fitclaw/agent`） |
| `FITCLAW_OFFLINE` | 设为 `1` 禁用启动联网操作 |
| `FITCLAW_TELEMETRY` | 设为 `1` 启用遥测 |
| `FITCLAW_PACKAGE_DIR` | 覆盖包目录（Nix/Guix 用） |
| `FITCLAW_CACHE_RETENTION` | 设为 `"long"` 延长 prompt cache |
| `FITCLAW_TIMING` | 设为 `1` 打印启动耗时 |
| `FITCLAW_HARDWARE_CURSOR` | 设为 `1` 启用硬件光标 |
| `FITCLAW_CLEAR_ON_SHRINK` | 设为 `1` 清空内容缩小的行 |
| `FITCLAW_DEBUG_REDRAW` | 设为 `1` 记录渲染原因到日志 |
| `FITCLAW_TUI_WRITE_LOG` | TUI 输出日志目录 |
| `FITCLAW_TUI_DEBUG` | 设为 `1` dump 渲染 buffer 到 `/tmp/tui/` |

> 旧版 `PI_*` 前缀仍然兼容（作为 fallback），推荐使用 `FITCLAW_*`。

---

## 14. 故障排查

### 14.1 常见问题

**Q: 启动报 "No API key configured"**

A: 设置对应 Provider 的环境变量，或创建 `~/.fitclaw/agent/auth.json`：
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# 或
mkdir -p ~/.fitclaw/agent
echo '{"anthropic":"sk-ant-..."}' > ~/.fitclaw/agent/auth.json
```

**Q: 构建报错 "tsgo: command not found"**

A: tsgo 是项目使用的 TypeScript 编译器。确保已安装：
```bash
npm install
```

**Q: Bot 连接飞书后无响应**

A: 排查步骤：
1. 检查 `MOM_FEISHU_APP_ID` 和 `MOM_FEISHU_APP_SECRET` 是否正确
2. 确认飞书应用已开启机器人能力
3. 查看 PM2 日志：`pm2 logs --lines 50`
4. 确认 WebSocket 长连接模式已启用

**Q: 会话文件太大**

A: 使用 compaction 机制，或缩短 `keepRecentTokens` 配置。

**Q: Windows 下 bash 工具不可用**

A: 确保系统安装了 Git Bash 或 WSL，并且在 PATH 中。

### 14.2 调试命令

```bash
# 查看工具调用日志
pm2 logs --lines 100 | grep -E "↳|✓|💬"

# 查看会话文件
cat ~/.fitclaw/agent/sessions/<session-id>/session.jsonl | head -20

# 本地开发调试
cd packages/coding-agent && npx tsx src/cli.ts --verbose

# 运行测试
npm run test --workspace @fitclaw/claw

# 运行单个测试文件
npm run test --workspace @fitclaw/claw -- path-utils

# 查看帮助
fitclaw --help
```

### 14.3 日志位置

| 用途 | 路径 |
|------|------|
| 调试日志 | `~/.fitclaw/agent/fitclaw-debug.log` |
| 会话日志 | `~/.fitclaw/agent/sessions/<id>/log.jsonl` |
| PM2 日志 | `pm2 logs` |

---

## 附录：工具速查

### 内置编程工具

| 工具 | 默认 | 说明 |
|------|------|------|
| `read` | 启用 | 读取文件内容 |
| `bash` | 启用 | 执行 shell 命令（有危险命令拦截） |
| `edit` | 启用 | 精确字符串替换编辑 |
| `write` | 启用 | 创建/覆盖文件 |
| `grep` | 关闭 | 搜索文件内容 |
| `find` | 关闭 | 文件名 glob 搜索 |
| `ls` | 关闭 | 列出目录 |

### 健身工具

| 工具 | 类别 |
|------|------|
| `query_exercises` | 动作查询 |
| `get_exercise_detail` | 动作详情 |
| `log_workout` | 训练记录 |
| `get_workout_history` | 训练历史 |
| `log_body_metrics` | 体测记录 |
| `get_body_metrics_history` | 体测历史 |
| `create_training_plan` | 计划生成 |
| `get_current_plan` | 当前计划 |
| `get_today_workout` | 今日训练 |
| `get_progress_summary` | 进度分析 |
| `log_progressive_overload` | 超负荷记录 |

---

> 更多技术细节见 [LEARNING_GUIDE.md](./LEARNING_GUIDE.md)（学习路径与架构文档）。
