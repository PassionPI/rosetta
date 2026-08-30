import type { WsClientMessage, WsServerMessage } from "@rosetta/shared";

type Handler = (msg: WsServerMessage) => void;

/** WS 客户端：自动重连 + 会话订阅（md/04 §4） */
class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private sessionIds = new Set<string>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (this.ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      for (const id of this.sessionIds)
        this.send({ type: "subscribe", sessionId: id });
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as WsServerMessage;
        for (const h of this.handlers) h(msg);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.retryTimer ??= setTimeout(() => {
        this.retryTimer = null;
        this.connect();
      }, 2000);
    };
  }

  private send(msg: WsClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(msg));
  }

  subscribe(sessionId: string): void {
    this.sessionIds.add(sessionId);
    this.send({ type: "subscribe", sessionId });
  }

  unsubscribe(sessionId: string): void {
    this.sessionIds.delete(sessionId);
    this.send({ type: "unsubscribe", sessionId });
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const wsClient = new WsClient();
