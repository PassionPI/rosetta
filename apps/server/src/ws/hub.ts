import type { TaskDTO, WsServerMessage } from "@rosetta/shared";
import type { WebSocket } from "ws";

interface Client {
  ws: WebSocket;
  sessions: Set<string>;
}

/** WS 连接管理 + 订阅扇出（md/04 §4） */
class Hub {
  private clients = new Set<Client>();
  private seqCounters = new Map<string, number>();

  add(ws: WebSocket): Client {
    const client: Client = { ws, sessions: new Set() };
    this.clients.add(client);
    ws.on("close", () => this.clients.delete(client));
    return client;
  }

  subscribe(client: Client, sessionId: string): void {
    client.sessions.add(sessionId);
    // 骨架阶段 backlog 仅通知；客户端随后走 REST 拉全量（完整回放见 md/04 §4 TODO）
    this.send(client, {
      kind: "backlog",
      sessionId,
      lastSeq: this.seq(sessionId),
    });
  }

  unsubscribe(client: Client, sessionId: string): void {
    client.sessions.delete(sessionId);
  }

  /** pi 事件透传给所有订阅该 session 的客户端 */
  publishEvent(sessionId: string, event: unknown): void {
    const msg: WsServerMessage = {
      kind: "event",
      sessionId,
      seq: this.seq(sessionId),
      ts: Date.now(),
      event,
    };
    this.broadcastTo(sessionId, msg);
  }

  /** run 状态信封（订阅该 session 的客户端） */
  runStatus(
    sessionId: string,
    runId: number | null,
    status: string,
    error?: string,
  ): void {
    this.broadcastTo(sessionId, {
      kind: "run_status",
      sessionId,
      runId,
      status,
      error,
    });
  }

  /** 任务状态变化：全局广播 */
  taskUpdate(task: TaskDTO, note?: string): void {
    const msg: WsServerMessage = { kind: "task_update", task, note };
    for (const c of this.clients) this.send(c, msg);
  }

  private seq(sessionId: string): number {
    const n = (this.seqCounters.get(sessionId) ?? 0) + 1;
    this.seqCounters.set(sessionId, n);
    return n;
  }

  private broadcastTo(sessionId: string, msg: WsServerMessage): void {
    for (const c of this.clients)
      if (c.sessions.has(sessionId)) this.send(c, msg);
  }

  private send(client: Client, msg: WsServerMessage): void {
    if (client.ws.readyState === client.ws.OPEN)
      client.ws.send(JSON.stringify(msg));
  }
}

export const wsHub = new Hub();
