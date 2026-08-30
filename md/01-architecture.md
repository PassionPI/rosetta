# 01 · 总体架构

## 1. 架构图

```
┌─────────────────────────────────────────────────────┐
│  Browser (本地, 访问 http://10.x:PORT)                │
│    REST: 会话列表 / 历史 / 统计                        │
│    WS:   实时事件流 (text_delta, tool_*, agent_*)     │
└──────────────┬──────────────────────────────────────┘
               │ HTTP / WebSocket  (明文密码 → 签名 cookie)
┌──────────────▼──────────────────────────────────────┐
│  TS Server (Fastify, 单进程, 跑在 cloudedDevServer)    │
│                                                      │
│  ┌────────────────────────────────────────────┐     │
│  │ SessionRegistry                            │     │
│  │   Map<sessionId, AgentSessionRuntime>      │     │
│  │   懒加载 / LRU / dispose；内核是            │     │
│  │   createAgentSessionRuntime() 而非裸        │     │
│  │   createAgentSession()                     │     │
│  └──────────────┬─────────────────────────────┘     │
│                 │ runtime.session                    │
│  ┌──────────────▼─────────────────────────────┐     │
│  │ pi SDK (in-process)                         │     │
│  │   SessionManager.create/open(cwd)           │────▶ ~/.pi/agent/sessions/**.jsonl
│  │   ModelRuntime.create()                     │     │ (事实源, 逐条落盘)
│  └──────────────┬─────────────────────────────┘     │
│                 │ session.subscribe(event)           │
│  ┌──────────────▼─────────────────────────────┐     │
│  │ EventBridge (扇出)                          │     │
│  │   ├─→ WS 订阅者（全量事件，含 delta）          │     │
│  │   └─→ EventRecorder（聚合点才写库）           │     │
│  │        └─ WriteQueue（单写队列，批量事务）      │     │
│  └──────────────┬─────────────────────────────┘     │
└─────────────────┼───────────────────────────────────┘
                  ▼
           SQLite (WAL) — data/harness.db
           sessions / session_entries / runs / steps / events
```

## 2. 进程模型

- **单 Node 进程**：server 同时承担 pi SDK 宿主、REST API、WS 网关、静态资源（web build 产物）。
- **pi 以 in-process SDK 方式运行**（官方推荐同进程场景用 SDK：类型安全、可直接读
  `session.agent.state`、可编程注入工具/扩展）。RPC 子进程模式是备选，仅当需要进程隔离时再考虑。
- **每个会话一个 `AgentSessionRuntime`**，Registry 统一管理。会话不随 server 启动而加载，
  UI 打开时才 `SessionManager.open()` 恢复（懒加载），空闲超时 dispose。
- 同时可以有多个会话活跃、并行 streaming，互不阻塞。

## 3. 核心设计决策

### 3.1 双存储：pi JSONL = 事实源，SQLite = 镜像 + 审计

- resume / fork / tree 分支 / compaction / label 这些能力 pi 原生做得好（树结构 id/parentId），
  自建等于重写半个 harness。JSONL 保留为操作层事实源。
- SQLite 通过事件流同步镜像 entries / runs / steps，供 Web UI 查询、列表、统计。
- 镜像损坏或缺失时，可从 JSONL 全量重建（见 02-storage 的 backfill）。

反面方案（`SessionManager.inMemory()` + 完全自管 DB）被否决：丢 pi 的树/分支/压缩能力。

### 3.2 EventBridge 挂在 Runtime 层，不在 Session 层

`runtime.newSession()` / `switchSession()` / `fork()` 后 `runtime.session` 会换成新对象，
事件订阅绑定在具体 `AgentSession` 上。因此：

- EventBridge 订阅逻辑必须包一层「替换后自动 re-subscribe」
- 扩展（如果以后用）也要在替换后重新 `bindExtensions()`

### 3.3 流式增量只推 WS、不落库

`text_delta` / `thinking_delta` / `tool_execution_update` 只走 WebSocket 给前端渲染；
DB 只在聚合点写入（`message_end` / `tool_execution_end` / `turn_end` / `agent_end`）。
这是 SQLite 方案成立的前提，避免写入量爆炸。

### 3.4 项目身份 = 文件夹（folder as project）

git worktree 并行开发场景：项目唯一键是 `realpath(cwd)`，pi 的 session 目录天然按
cwd 隔离（`--<path>--` 字符串编码）。严禁用 git common dir / 解析 `.git` 文件追溯
主仓来归并项目；git 信息只进 `projects` 表作展示元数据。详见 [07-worktrees.md](07-worktrees.md)。

### 3.5 pi 环境零定制

- `agentDir` 用默认 `~/.pi/agent`（dev server 上该用户的 home）
- 凭证用默认 `auth.json`（在 dev server 上 `pi` 登录一次即可）
- 模型解析用 `resolveCliModel("anthropic/xxx:high")` 接收前端传参
- settings / extensions / skills 遵循 pi 默认发现规则（cwd 下的 `.pi/` 优先）

## 4. pi SDK 关键接口备忘（已对齐官方文档）

| 接口 | 用途 |
|---|---|
| `createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager })` | Registry 内核；支持 newSession / switchSession / fork 替换会话 |
| `runtime.newSession() / switchSession(path) / fork(entryId, { position })` | 会话替换（替换后 re-subscribe） |
| `session.prompt(text, opts?)` / `steer(text)` / `followUp(text)` | 驱动；prompt resolve 于整轮结束（含重试） |
| `session.abort()` / `compact(customInstructions?)` / `dispose()` | 中断 / 压缩 / 清理 |
| `session.subscribe(cb)` → unsubscribe | 事件流（见下） |
| `session.agent.state.messages / .tools` | 直接读写状态（分支/恢复用） |
| `SessionManager.create(cwd) / open(path) / list(cwd) / listAll()` | 会话文件管理 |
| `sm.appendMessage(msg)` / `getEntries()` / `getTree()` / `getPath()` / `getLeafEntry()` | 树操作 + 追加（悬空 toolCall 修复用） |
| `ModelRuntime.create()` / `resolveCliModel()` / `modelRuntime.getAvailable()` | 模型与凭证 |

### 事件类型 → 用途

| 事件 | Recorder 动作 |
|---|---|
| `agent_start` / `agent_end` | runs 行 start / end（agent_end 带新消息与最终状态） |
| `turn_start` / `turn_end` | 每轮 usage 聚合（turn_end 带 message + toolResults） |
| `message_start` / `message_end` | session_entries 落库（message_end 时消息已含终止 stopReason） |
| `tool_execution_start` / `tool_execution_end` | steps 行 start / end（含 isError、duration、details） |
| `message_update` (text/thinking_delta) | 仅 WS 转发，不落库 |
| `queue_update` / `compaction_*` / `auto_retry_*` / `summarization_retry_*` | WS 转发 + events 审计表 |
