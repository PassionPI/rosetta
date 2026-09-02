// REST DTO —— 与 server db schema 对齐（md/02-storage.md）

export interface SessionSummary {
  id: string;
  name: string | null;
  cwd: string;
  filePath: string;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  status: string;
  taskId: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface EntryDTO {
  id: string;
  sessionId: string;
  parentId: string | null;
  seq: number;
  kind: string;
  role: string | null;
  stopReason: string | null;
  toolName: string | null;
  isError: boolean | null;
  payload: unknown;
  timestamp: number | null;
}

export interface RunDTO {
  id: number;
  sessionId: string;
  prompt: string | null;
  trigger: string;
  status: string;
  modelId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsdMicros: number;
  turnCount: number;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface StepDTO {
  id: number;
  runId: number;
  sessionId: string;
  callId: string | null;
  toolName: string;
  arguments: unknown;
  result: unknown;
  patch: string | null;
  isError: boolean;
  durationMs: number | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface ProjectDTO {
  path: string;
  displayName: string | null;
  repoRoot: string | null;
  repoName: string | null;
  isWorktree: boolean | null;
  worktreeName: string | null;
  branch: string | null;
  sessionCount: number;
  lastActiveAt: number | null;
}

export interface WorktreeDTO {
  path: string;
  name: string;
  isMain: boolean;
  branch: string | null;
  slotOrder: number;
  /** idle | busy | unavailable | reserved（用户手动占用）| disabled */
  status: string;
  currentTaskId: number | null;
}

export interface NotificationDTO {
  id: number;
  /** awaiting_review | run_stopped | task_done | task_failed | dispatch_blocked | dispatch_skipped */
  type: string;
  title: string;
  detail: string | null;
  taskId: number | null;
  sessionId: string | null;
  repoId: number | null;
  read: boolean;
  createdAt: number | null;
}

export interface RepoDTO {
  id: number;
  repoRoot: string;
  displayName: string | null;
  defaultModel: string | null;
  worktrees: WorktreeDTO[];
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface TaskDTO {
  id: number;
  repoId: number;
  seq: number;
  description: string;
  summary: string | null;
  status: string;
  worktreePath: string | null;
  sessionId: string | null;
  branch: string | null;
  baseCommit: string | null;
  endCommit: string | null;
  rejectCount: number;
  error: string | null;
  deps: number[];
  createdAt: number | null;
  dispatchedAt: number | null;
  finishedAt: number | null;
}

export interface ModelInfo {
  providerId: string;
  modelId: string;
  displayName: string;
}
