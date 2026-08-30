# 02 · 存储设计

## 1. 双存储职责划分

| | pi JSONL（事实源） | SQLite（镜像 + 审计） |
|---|---|---|
| 职责 | 会话持久化、resume/fork/tree/compaction | 查询、列表、统计、UI 渲染加速、run/step 审计 |
| 写入方 | pi SessionManager（逐条落盘） | EventRecorder（事件聚合点写入） |
| 数据 | 完整树结构 + 所有 entry 类型 | entries 镜像 + runs/steps 投影 |
| 可重建 | —（源头） | ✅ 可从 JSONL 全量重建（backfill） |

## 2. 为什么是 SQLite 而不是 Postgres

- 单进程 TS server + 单用户内网场景，SQLite（WAL）零运维、备份=拷文件
- better-sqlite3 同步写极快，配合单写队列批量事务，负载完全够
- 用 Drizzle ORM，schema 可平移，未来多用户/多实例再切 Postgres
- 切换触发条件：多实例部署、需要 JSONB+GIN 复杂查询、需要 tsvector 全文检索

## 3. Schema（Drizzle / better-sqlite3）

```ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ── 项目（folder as project，git 元数据仅展示用，见 07-worktrees）──
export const projects = sqliteTable("projects", {
  path: text("path").primaryKey(),          // fs.realpath(cwd)，项目唯一键
  displayName: text("display_name"),        // basename 或用户自定义
  repoRoot: text("repo_root"),              // realpath(git toplevel)；非 git 为 null
  repoName: text("repo_name"),              // basename(repoRoot)
  isWorktree: integer("is_worktree", { mode: "boolean" }),
  worktreeName: text("worktree_name"),      // gitdir 尾段，仅 isWorktree 时有值
  branch: text("branch"),
  sessionCount: integer("session_count").default(0),
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }),
  metaCheckedAt: integer("meta_checked_at", { mode: "timestamp_ms" }),  // git 元数据刷新时间
}, (t) => [index("idx_projects_repo").on(t.repoRoot)]);

// ── 会话（镜像 pi session 文件）──────────────────────────
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),            // pi sessionId (uuid, 来自 session header)
  filePath: text("file_path").notNull(),  // JSONL 绝对路径
  name: text("name"),                     // session_info 显示名（/name 设置）
  cwd: text("cwd").notNull(),
  provider: text("provider"),             // 最近一次使用的模型
  modelId: text("model_id"),
  thinkingLevel: text("thinking_level"),
  status: text("status").notNull().default("active"),
    // active | interrupted(上次 run 被打断未续) | archived
  parentSession: text("parent_session"),  // fork 来源文件路径
  taskId: integer("task_id"),             // 关联编排任务（08-tasks），普通会话为 null
  entryCount: integer("entry_count").default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),  // 文件 mtime 或最后事件
}, (t) => [
  index("idx_sessions_cwd").on(t.cwd),
  index("idx_sessions_updated").on(t.updatedAt),
]);

// ── 会话条目（镜像 JSONL 树，逐行对应）─────────────────────
export const sessionEntries = sqliteTable("session_entries", {
  id: text("id").primaryKey(),            // pi entry id (8-char hex)
  sessionId: text("session_id").notNull().references(() => sessions.id),
  parentId: text("parent_id"),            // null = 首条
  seq: integer("seq").notNull(),          // 文件内行号（0-based）
  kind: text("kind").notNull(),
    // message | model_change | thinking_level_change | compaction
    // | branch_summary | custom | custom_message | label | session_info
  role: text("role"),                     // kind=message 时:
    // user | assistant | toolResult | bashExecution | custom
    // | branchSummary | compactionSummary
  stopReason: text("stop_reason"),        // assistant 时: stop|length|toolUse|error|aborted
  toolName: text("tool_name"),            // toolResult 时
  isError: integer("is_error", { mode: "boolean" }),
  payload: text("payload", { mode: "json" }),  // 原始 entry 完整 JSON
  timestamp: integer("timestamp", { mode: "timestamp_ms" }),
}, (t) => [
  index("idx_entries_session_seq").on(t.sessionId, t.seq),
  index("idx_entries_role").on(t.sessionId, t.role),
]);

// ── 一次 prompt 运行（agent_start → agent_end）─────────────
export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  prompt: text("prompt"),                 // 触发文本（steer/followUp 触发的记录类型）
  trigger: text("trigger").notNull().default("user"),  // user | steer | followUp | auto_continue
  status: text("status").notNull().default("running"),
    // running | completed | error | aborted | interrupted(重启对账)
  modelId: text("model_id"),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  cacheReadTokens: integer("cache_read_tokens").default(0),
  costUsdMicros: integer("cost_usd_micros").default(0),  // 微美分避免浮点
  turnCount: integer("turn_count").default(0),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("idx_runs_session").on(t.sessionId, t.startedAt),
  index("idx_runs_status").on(t.status),
]);

// ── 每一步工具操作（tool_execution_start → end）────────────
export const steps = sqliteTable("steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull().references(() => runs.id),
  sessionId: text("session_id").notNull(),
  callId: text("call_id"),                // toolCall.id（与 session_entries 关联）
  toolName: text("tool_name").notNull(),  // read | bash | edit | write | grep | ...
  arguments: text("arguments", { mode: "json" }),
  result: text("result", { mode: "json" }),     // content blocks
  patch: text("patch"),                   // edit 工具的 details.patch（unified diff，UI 用）
  isError: integer("is_error", { mode: "boolean" }),
  durationMs: integer("duration_ms"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("idx_steps_run").on(t.runId),
  index("idx_steps_tool").on(t.toolName),
  index("idx_steps_session_time").on(t.sessionId, t.startedAt),
]);

// ── 关键事件审计（只存生命周期事件，不存 delta）──────────────
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  runId: integer("run_id"),
  type: text("type").notNull(),           // compaction_start | auto_retry_* | queue_update ...
  payload: text("payload", { mode: "json" }),
  ts: integer("ts", { mode: "timestamp_ms" }),
}, (t) => [index("idx_events_session_ts").on(t.sessionId, t.ts)]);
```

### 编排层（详见 08-tasks.md）

```ts
// ── 注册的 repo（project 实体）───────────────────────────
export const repos = sqliteTable("repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repoRoot: text("repo_root").notNull().unique(),   // realpath
  displayName: text("display_name"),
  settings: text("settings", { mode: "json" }),     // useMainAsSlot / mergeStrategy...
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
});

// ── worktree 池（slot）──────────────────────────────────
export const worktrees = sqliteTable("worktrees", {
  path: text("path").primaryKey(),                  // realpath(worktree)
  repoId: integer("repo_id").notNull().references(() => repos.id),
  name: text("name").notNull(),                     // "main" 或 worktree 名
  isMain: integer("is_main", { mode: "boolean" }).notNull(),
  branch: text("branch"),                           // 当前分支（展示用）
  slotOrder: integer("slot_order").notNull(),       // main=1，其余按注册顺序
  status: text("status").notNull().default("idle"),
    // idle | busy | unavailable | disabled
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
}, (t) => [index("idx_worktrees_repo").on(t.repoId, t.slotOrder)]);

// ── 任务队列 ────────────────────────────────────────────
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repoId: integer("repo_id").notNull().references(() => repos.id),
  seq: integer("seq").notNull(),                    // repo 内单调递增（FIFO 依据）
  description: text("description").notNull(),       // 用户的一段话
  summary: text("summary"),                         // agent 完成摘要（验收页预填）
  status: text("status").notNull().default("queued"),
    // queued | running | awaiting_review | finishing | done | failed | cancelled
  worktreePath: text("worktree_path"),              // 派发后填
  sessionId: text("session_id"),                    // 执行 session
  branch: text("branch"),                           // 派发时 slot 的当前分支（沿用，不新建）
  baseCommit: text("base_commit"),                 // 派发时 HEAD（任务改动范围起点）
  endCommit: text("end_commit"),                   // 验收提交后 HEAD（改动范围终点）
  rejectCount: integer("reject_count").default(0),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  dispatchedAt: integer("dispatched_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("idx_tasks_repo_seq").on(t.repoId, t.seq),
  index("idx_tasks_status").on(t.status),
]);

// ── 任务依赖（多依赖支持）─────────────────────────────────
export const taskDeps = sqliteTable("task_deps", {
  taskId: integer("task_id").notNull().references(() => tasks.id),
  dependsOn: integer("depends_on").notNull().references(() => tasks.id),
}, (t) => [index("idx_task_deps_task").on(t.taskId)]);
```

### usage 来源

`AssistantMessage.usage`（含 cost 分项）随 message 落在 JSONL；Recorder 从
`message_end` / `turn_end` 事件读取并累加到当前 run 行。`ToolResultMessage.usage`
（嵌套 LLM 工作量）累加到对应 step。

## 4. 写入策略（WriteQueue）

```
事件回调（同步、快） → 入内存队列 → 单写者循环 → 每 N 条或 50ms 一个事务批量写
```

- better-sqlite3 同步 API，单进程内无跨进程锁问题；开启 `journal_mode = WAL`、
  `busy_timeout = 5000`、`foreign_keys = ON`
- `agent_end` 时强制 flush 一次，保证 UI 查询 runs 时数据完整
- 进程退出前 flush（配合 03-lifecycle 的优雅停机）

## 5. Backfill / 对账（启动时 + 手动）

```
1. SessionManager.listAll() → 全部 session 文件（含 cwd、mtime、header 信息）
2. 与 DB sessions 表对比：
   - 新文件（pi CLI 直接创建的、或 DB 未覆盖的）→ 读 JSONL 全量回填 sessions + session_entries
   - 文件 mtime > DB.updatedAt → 增量补 entries（按 seq 续读）
   - DB 有而文件无 → 标记 orphan（不删，供审计）
3. runs 中 status = 'running' 且进程刚启动 → 标记 'interrupted'（见 03-lifecycle）
```

JSONL 解析直接复用 pi 的 entry 类型（`type` 字段分发），无需自造格式。
注意 header 行（`type: "session"`）不进树，不入 session_entries。

**worktree 注意**（07-worktrees）：session 目录名 `--<path>--` 不可反解，cwd 一律读
header 的 `cwd` 字段；入库前 realpath。

## 6. 会话文件路径规则（pi 事实）

```
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
                                  ^ path = cwd 的 / 替换为 -
```

- 同一 cwd 的会话聚在同一目录下，`SessionManager.list(cwd)` 即按此过滤
- fork/clone 产生的会话 header 带 `parentSession` 字段
