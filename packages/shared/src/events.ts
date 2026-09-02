// WS 信封类型（md/04-api.md §4）
import type { NotificationDTO, TaskDTO } from "./dto.ts";

/** pi 原生事件透传信封 */
export interface EventEnvelope {
  kind: "event";
  sessionId: string;
  seq: number;
  ts: number;
  event: unknown; // AgentSessionEvent（pi 类型，web 侧宽松处理）
}

export interface RunStatusEnvelope {
  kind: "run_status";
  sessionId: string;
  runId: number | null;
  status: string;
  error?: string;
}

export interface TaskUpdateEnvelope {
  kind: "task_update";
  task: TaskDTO;
  note?: string;
}

/** 验收 git 流水线进度（生成 commit message → commit → push） */
export interface TaskProgressEnvelope {
  kind: "task_progress";
  taskId: number;
  stage: "generating_commit_message" | "committing" | "pushing" | "done" | "failed";
  detail?: string;
}

/** 通知中心新通知 */
export interface NotificationEnvelope {
  kind: "notification";
  notification: NotificationDTO;
}

export interface BacklogEnvelope {
  kind: "backlog";
  sessionId: string;
  // 骨架阶段：连接建立后通知客户端按 seq 续传；回放逻辑见 md/04 §4（TODO）
  lastSeq: number;
}

export type WsServerMessage =
  | EventEnvelope
  | RunStatusEnvelope
  | TaskUpdateEnvelope
  | TaskProgressEnvelope
  | NotificationEnvelope
  | BacklogEnvelope;

export type WsClientMessage =
  | { type: "subscribe"; sessionId: string }
  | { type: "unsubscribe"; sessionId: string }
  | { type: "ping" };
