# FitClaw 项目中高级风险问题清单

> 由代码审查整理，按风险级别分类。每个问题包含：位置、影响、修复建议。

---

## 🔴 CRITICAL（高）— 必须修复

### 1. AgentSession 上帝类（架构）

| 项目 | 内容 |
|------|------|
| **位置** | `packages/coding-agent/src/core/agent-session.ts` |
| **规模** | 3097 行 |
| **影响** | 单一类承担 10+ 职责（提示词、工具注册、模型管理、会话持久化、压缩、重试、Bash、扩展系统、树导航）。修改任何功能都可能引入副作用，测试覆盖困难，新人理解成本极高 |
| **修复建议** | 拆分为 5-6 个协作类：`PromptManager`、`ToolRegistry`、`SessionPersistence`、`CompactionService`、`RetryService`、`BashExecutor`。AgentSession 仅保留事件协调和状态访问 |

### 2. Bash 工具默认无沙箱（安全） ✅ 已修复 (2026-05-01)

| 项目 | 内容 |
|------|------|
| **位置** | `packages/coding-agent/src/core/tools/bash.ts` |
| **影响** | LLM 调用的 bash 命令直接在 host 执行任意代码。虽然 `--sandbox=docker` 可选，但默认不开启。恶意 prompt 可导致数据删除、信息泄露、安装后门 |
| **修复** | 新增 `validateCommand()` 拦截 12 种危险命令模式（rm -rf /、dd 写磁盘、fork bomb、curl\|sh 等），在 `execute()` 方法中调用。Commit: `f09e06cd` |

### 3. 文件工具无路径遍历防护（安全） ✅ 已修复 (2026-05-01)

| 项目 | 内容 |
|------|------|
| **位置** | `packages/coding-agent/src/core/tools/read.ts`、`edit.ts`、`write.ts` |
| **影响** | 工具接收的 path 参数可包含 `../` 或绝对路径，访问 cwd 以外的文件。LLM 可能被诱导读取 `/etc/passwd`、`.env`、SSH 私钥等敏感文件 |
| **修复** | 在 `resolveToCwd()` 中新增 `validatePathBoundary()` 检查：拒绝包含 `..` 的路径，拒绝解析后超出 cwd 或 home 目录的绝对路径。所有文件工具（read/edit/write）共用此检查。Commit: `f09e06cd` |

### 4. 扩展系统执行任意代码无签名验证（安全）

| 项目 | 内容 |
|------|------|
| **位置** | `packages/coding-agent/src/core/extensions/loader.ts` |
| **影响** | 扩展通过动态 `import()` 加载任意 JS/TS 文件。扩展可注册工具、拦截请求、执行命令。无签名/哈希验证机制，恶意扩展可获得完整系统控制权 |
| **修复建议** | 扩展加载前计算文件哈希并与允许列表比对；或要求扩展清单（manifest）声明权限范围（如 "仅文件读取"），运行时做 capability-based 限制 |

---

## 🟡 HIGH（中）— 建议修复

### 5. Slack / 飞书代码耦合（架构）

| 项目 | 内容 |
|------|------|
| **位置** | `packages/mom/src/main.ts` |
| **影响** | 两个平台的上下文创建、事件处理、启动逻辑混在一个 544 行的文件中。`createSlackContext` 返回 200+ 行匿名对象。新增平台（如 Discord/企微）时需要继续往里加分支，违背开闭原则 |
| **修复建议** | 定义 `BotAdapter` 接口：`{ start(), stop(), sendMessage(), ... }`。SlackAdapter 和 FeishuAdapter 分别实现。main.ts 仅做工厂路由 |

### 6. 健身工具侵入核心包（架构）🔄 部分处理 (2026-05-01)

| 项目 | 内容 |
|------|------|
| **位置** | `packages/coding-agent/src/core/tools/fitness/` |
| **影响** | 11 个健身工具与 read/bash/edit/write 等核心工具平级存放。健身功能是垂直业务，不应与通用编程工具耦合。长期会污染核心代码，增加构建体积 |
| **修复建议** | 将健身工具提取为独立 npm 包（如 `@fitclaw/fitness-tools`）或作为内置扩展（`extensions/fitness/`），通过扩展系统注册 |
| **进展** | 2026-05-01 实施了 Sport Skill Pack 架构：工具已通过 `scripts/tools.ts` 接入 skill 系统，`SportDataStore` 泛型接口解耦了数据层，支持多运动 skill（健身/游泳等）。工具代码仍留在 `fitness/` 子目录但支持通过 skill 目录激活。完整拆分待后续 Phase |

### 7. 扩展系统过度复杂（架构）

| 项目 | 内容 |
|------|------|
| **位置** | `packages/coding-agent/src/core/extensions/` |
| **影响** | `types.ts` 1545 行、`runner.ts` 1022 行，支持 15+ 种事件类型。扩展系统几乎是一个完整的插件框架，但当前使用率未知。过度设计增加了维护负担和认知负担 |
| **修复建议** | 评估实际使用的扩展数量；若使用率低于 3 个，考虑简化事件模型；将未使用的事件类型标记为 deprecated |

### 8. 多个文件超过 800 行上限（代码质量）

| 文件 | 行数 | 问题 |
|------|------|------|
| `agent-session.ts` | 3097 | 上帝类 |
| `extensions/types.ts` | 1545 | 类型定义臃肿 |
| `extensions/runner.ts` | 1022 | 逻辑过于集中 |
| `extensions/loader.ts` | 606 | 尚可接受 |
| `agent-loop.ts` | 683 | 接近上限 |
| `main.ts` | 762 | 接近上限 |

| **修复建议** | 按职责拆分大文件。如 `agent-session.ts` 可按章节拆分为多个内部模块，AgentSession 类通过组合使用它们 |

### 9. `as any` 和 `as Record<string, unknown>` 泛滥（代码质量）

| 项目 | 内容 |
|------|------|
| **位置** | `mom/src/main.ts:323` (`ctx as any`)、`mom/src/feishu.ts` (多处 SDK 响应转换) |
| **影响** | 类型安全丢失。编译器无法检查属性访问合法性，运行时可能出现 `undefined` 访问错误。飞书 SDK 响应结构变化时无法提前发现 |
| **修复建议** | 为飞书 SDK 响应定义接口类型；使用 `unknown` + 类型守卫替代 `any`；对 `ctx` 的适配器差异通过联合类型或泛型处理 |

### 10. Slack / 飞书上下文创建逻辑重复（代码质量）

| 项目 | 内容 |
|------|------|
| **位置** | `mom/src/main.ts` 中 `createSlackContext` 和 `createFeishuContext` |
| **影响** | respond、replaceMessage、setWorking 的实现模式高度相似（Promise 链 + 长度截断 + 错误捕获），但代码无法复用。修改截断逻辑需要在两处同步修改 |
| **修复建议** | 提取 `createMessageAccumulator(maxLength)` 工厂函数，返回 `{ append(), replace(), get(), isTruncated }`。两个适配器共用 |

### 11. 飞书 WebSocket 断线无自动重连（稳定性）

| 项目 | 内容 |
|------|------|
| **位置** | `packages/mom/src/feishu.ts` |
| **影响** | `WSClient.start()` 启动后无重连逻辑。网络波动或飞书服务端重启会导致 Bot 永久离线，需人工重启进程 |
| **修复建议** | 监听 WebSocket `close`/`error` 事件，实现指数退避重连（1s → 2s → 4s → ... → 60s）。参考 Slack Bot 的 Socket Mode 重连实现 |

### 12. 飞书事件无签名验证（安全）

| 项目 | 内容 |
|------|------|
| **位置** | `packages/mom/src/feishu.ts` |
| **影响** | `handleMessage()` 直接处理接收到的所有事件，未验证事件签名。攻击者若知道 appId，可伪造事件向 Bot 发送恶意消息 |
| **修复建议** | 使用飞书 SDK 的签名验证功能，或手动验证 `X-Lark-Signature` header。参考飞书官方文档的 [事件回调安全](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-calback-security) |

### 13. 核心逻辑测试覆盖不足（质量）

| 项目 | 内容 |
|------|------|
| **位置** | 全项目 |
| **影响** | 206 个测试文件共 54977 行，但 `coding-agent/src/core/` 下的核心逻辑（sdk.ts、agent-session.ts、compaction）测试极少。mom 包刚补到 12 个测试。回归测试无法保证修改安全 |
| **修复建议** | 为 `sdk.ts` 的 `createAgentSession` 写集成测试；为 AgentSession 的关键方法（prompt、compact、setModel）写单元测试；使用内存 SessionManager 避免文件 IO |

### 14. 健身工具无 E2E 测试（质量）

| 项目 | 内容 |
|------|------|
| **位置** | `packages/coding-agent/src/core/tools/fitness/` |
| **影响** | 11 个工具共 802 行代码，无任何测试。数据持久化（JSON 文件读写）、LLM 工具调用链路均无覆盖。文件格式变更可能导致数据丢失 |
| **修复建议** | 为每个工具写单元测试：mock `loadFitnessData`/`persist`，验证 execute 返回结果；为 `createAllFitnessTools` 写集成测试，验证工具定义完整 |

### 15. Compaction 同步阻塞用户交互（性能）

| 项目 | 内容 |
|------|------|
| **位置** | `packages/coding-agent/src/core/agent-session.ts` `_runAutoCompaction()` |
| **影响** | 自动压缩调用 LLM 生成历史摘要，这是一个同步阻塞操作。用户在 compaction 期间无法发送新消息或中断。上下文窗口大的会话压缩耗时可达数秒至数十秒 |
| **修复建议** | 将 compaction 改为异步后台任务：agent_end 时触发后台压缩，压缩完成后热替换上下文。或至少允许用户在压缩期间发送 steering 消息 |

---

## 风险分布统计

| 级别 | 数量 | 分类 | 状态 |
|------|------|------|------|
| 🔴 CRITICAL | 4 | 架构 ×1、安全 ×3 | 2/4 已修复 |
| 🟡 HIGH | 11 | 架构 ×3、代码质量 ×4、安全 ×2、质量 ×2、性能 ×1 | 0/11 |
| **合计** | **15** | — | 2 已修复 |

## 修复优先级建议

```
✅ P0（已完成 2026-05-01）:
  - #2 Bash 无沙箱 → validateCommand() 拦截危险命令 (f09e06cd)
  - #3 文件路径无校验 → validatePathBoundary() 路径边界检查 (f09e06cd)

P0（本周）:
  - #12 飞书无签名验证 → 添加签名校验

P1（本月）:
  - #1 AgentSession 拆分 → 分阶段提取服务类
  - #5 Slack/飞书解耦 → 抽象 BotAdapter
  - #6 健身工具移出核心 → 改为扩展包
  - #11 飞书重连 → 实现退避重连

P2（季度）:
  - #4 扩展签名验证
  - #7 扩展系统简化
  - #8 大文件拆分
  - #13/#14 补测试
  - #15 Compaction 异步化
```
