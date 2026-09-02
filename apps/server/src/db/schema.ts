// 与 md/02-storage.md 对齐
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ── 项目（folder as project，git 元数据仅展示用，见 md/07）──
export const projects = sqliteTable(
  "projects",
  {
    path: text("path").primaryKey(), // fs.realpath(cwd)，项目唯一键
    displayName: text("display_name"),
    repoRoot: text("repo_root"),
    repoName: text("repo_name"),
    isWorktree: integer("is_worktree", { mode: "boolean" }),
    worktreeName: text("worktree_name"),
    branch: text("branch"),
    sessionCount: integer("session_count").default(0),
    lastActiveAt: integer("last_active_at"),
    metaCheckedAt: integer("meta_checked_at"),
  },
  (t) => [index("idx_projects_repo").on(t.repoRoot)],
);

// ── 会话（镜像 pi session 文件）──
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // pi sessionId (uuid)
    filePath: text("file_path").notNull(),
    name: text("name"),
    cwd: text("cwd").notNull(),
    provider: text("provider"),
    modelId: text("model_id"),
    thinkingLevel: text("thinking_level"),
    status: text("status").notNull().default("active"),
    parentSession: text("parent_session"),
    taskId: integer("task_id"),
    entryCount: integer("entry_count").default(0),
    createdAt: integer("created_at"),
    updatedAt: integer("updated_at"),
  },
  (t) => [index("idx_sessions_cwd").on(t.cwd), index("idx_sessions_updated").on(t.updatedAt)],
);

// ── 会话条目（镜像 JSONL 树）──
export const sessionEntries = sqliteTable(
  "session_entries",
  {
    id: text("id").primaryKey(), // pi entry id (8-char hex)
    sessionId: text("session_id").notNull(),
    parentId: text("parent_id"),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    role: text("role"),
    stopReason: text("stop_reason"),
    toolName: text("tool_name"),
    isError: integer("is_error", { mode: "boolean" }),
    payload: text("payload", { mode: "json" }),
    timestamp: integer("timestamp"),
  },
  (t) => [index("idx_entries_session_seq").on(t.sessionId, t.seq)],
);

// ── 一次 prompt 运行（agent_start → agent_end）──
export const runs = sqliteTable(
  "runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    prompt: text("prompt"),
    trigger: text("trigger").notNull().default("user"), // user | steer | followUp | auto_continue | task
    status: text("status").notNull().default("running"), // running | completed | error | aborted | interrupted
    modelId: text("model_id"),
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    cacheReadTokens: integer("cache_read_tokens").default(0),
    costUsdMicros: integer("cost_usd_micros").default(0),
    turnCount: integer("turn_count").default(0),
    error: text("error"),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
  },
  (t) => [index("idx_runs_session").on(t.sessionId, t.startedAt), index("idx_runs_status").on(t.status)],
);

// ── 每一步工具操作 ──
export const steps = sqliteTable(
  "steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").notNull(),
    sessionId: text("session_id").notNull(),
    callId: text("call_id"),
    toolName: text("tool_name").notNull(),
    arguments: text("arguments", { mode: "json" }),
    result: text("result", { mode: "json" }),
    patch: text("patch"),
    isError: integer("is_error", { mode: "boolean" }),
    durationMs: integer("duration_ms"),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
  },
  (t) => [
    index("idx_steps_run").on(t.runId),
    index("idx_steps_tool").on(t.toolName),
    index("idx_steps_session_time").on(t.sessionId, t.startedAt),
  ],
);

// ── 关键事件审计（生命周期事件，不含 delta）──
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    runId: integer("run_id"),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }),
    ts: integer("ts"),
  },
  (t) => [index("idx_events_session_ts").on(t.sessionId, t.ts)],
);

// ── 编排层（md/08-tasks.md）──
export const repos = sqliteTable("repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repoRoot: text("repo_root").notNull().unique(),
  displayName: text("display_name"),
  settings: text("settings", { mode: "json" }),
  createdAt: integer("created_at"),
});

export const worktrees = sqliteTable(
  "worktrees",
  {
    path: text("path").primaryKey(),
    repoId: integer("repo_id").notNull(),
    name: text("name").notNull(),
    isMain: integer("is_main", { mode: "boolean" }).notNull(),
    branch: text("branch"),
    slotOrder: integer("slot_order").notNull(),
    status: text("status").notNull().default("idle"), // idle | busy | unavailable | disabled
    updatedAt: integer("updated_at"),
  },
  (t) => [index("idx_worktrees_repo").on(t.repoId, t.slotOrder)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    repoId: integer("repo_id").notNull(),
    seq: integer("seq").notNull(),
    description: text("description").notNull(),
    summary: text("summary"),
    status: text("status").notNull().default("queued"),
    // queued | running | awaiting_review | finishing | done | failed | cancelled
    worktreePath: text("worktree_path"),
    sessionId: text("session_id"),
    branch: text("branch"),
    baseCommit: text("base_commit"),
    endCommit: text("end_commit"),
    rejectCount: integer("reject_count").default(0),
    error: text("error"),
    createdAt: integer("created_at"),
    dispatchedAt: integer("dispatched_at"),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("idx_tasks_repo_seq").on(t.repoId, t.seq), index("idx_tasks_status").on(t.status)],
);

export const taskDeps = sqliteTable(
  "task_deps",
  {
    taskId: integer("task_id").notNull(),
    dependsOn: integer("depends_on").notNull(),
  },
  (t) => [index("idx_task_deps_task").on(t.taskId)],
);

// ── 通知中心（md 需求 #8：需用户确认/知悉的事件）──
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    taskId: integer("task_id"),
    sessionId: text("session_id"),
    repoId: integer("repo_id"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at"),
  },
  (t) => [
    index("idx_notifications_read").on(t.read, t.createdAt),
    index("idx_notifications_task").on(t.taskId),
  ],
);
