import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EntryDTO, SessionSummary } from "@rossetta/shared";
import { api } from "../api/client.ts";
import { wsClient } from "../ws/client.ts";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: any) => (c.type === "text" ? c.text : c.type === "image" ? "[图片]" : ""))
    .join("");
}

function EntryView({ e }: { e: EntryDTO }) {
  const p = e.payload as any;
  if (e.kind === "message") {
    const m = p.message ?? {};
    if (m.role === "user") {
      return (
        <div className="msg user">
          <pre>{textOf(m.content)}</pre>
        </div>
      );
    }
    if (m.role === "assistant") {
      const parts: any[] = Array.isArray(m.content) ? m.content : [];
      const thinking = parts.filter((c) => c.type === "thinking").map((c) => c.thinking).join("\n");
      const text = parts.filter((c) => c.type === "text").map((c) => c.text).join("");
      const calls = parts.filter((c) => c.type === "toolCall");
      return (
        <div className="msg assistant">
          {thinking && (
            <details className="thinking">
              <summary>thinking</summary>
              <pre>{thinking}</pre>
            </details>
          )}
          {text && <pre>{text}</pre>}
          {calls.length > 0 && (
            <div className="calls">
              {calls.map((c) => (
                <details key={c.id}>
                  <summary>
                    <code>{c.name}</code>
                  </summary>
                  <pre>{JSON.stringify(c.arguments, null, 2)}</pre>
                </details>
              ))}
            </div>
          )}
        </div>
      );
    }
    if (m.role === "toolResult") {
      return (
        <details className={`toolresult ${m.isError ? "err" : ""}`}>
          <summary>
            <code>{m.toolName}</code> {m.isError ? "✖" : "✓"}
          </summary>
          <pre>{textOf(m.content).slice(0, 4000)}</pre>
        </details>
      );
    }
    return null;
  }
  if (e.kind === "compaction") return <div className="sys">⋯ 上下文已压缩（{p.tokensBefore ?? "?"} tokens → 摘要）</div>;
  if (e.kind === "branch_summary") return <div className="sys">⋯ 分支切换摘要</div>;
  return null;
}

export default function SessionView({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [streaming, setStreaming] = useState("");
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const session = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.get<SessionSummary & { streaming?: boolean }>(`/api/sessions/${sessionId}`),
  });
  const entries = useQuery({
    queryKey: ["entries", sessionId],
    queryFn: () => api.get<EntryDTO[]>(`/api/sessions/${sessionId}/entries`),
  });

  useEffect(() => {
    wsClient.subscribe(sessionId);
    return () => wsClient.unsubscribe(sessionId);
  }, [sessionId]);

  useEffect(() => {
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    const off = wsClient.on((msg) => {
      if (msg.kind === "event" && msg.sessionId !== sessionId) return;
      if (msg.kind === "run_status") {
        setRunStatus(msg.status);
        if (msg.status !== "running") setStreaming("");
        return;
      }
      if (msg.kind !== "event") return;
      const ev = msg.event as any;
      if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
        setStreaming((s) => s + ev.assistantMessageEvent.delta);
      } else if (ev.type === "message_end" || ev.type === "agent_end" || ev.type === "entry_appended") {
        setStreaming("");
        refetchTimer ??= setTimeout(() => {
          refetchTimer = null;
          void queryClient.invalidateQueries({ queryKey: ["entries", sessionId] });
          void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
        }, 300);
      }
    });
    return () => {
      off();
      if (refetchTimer) clearTimeout(refetchTimer);
    };
  }, [sessionId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.dataUpdatedAt, streaming]);

  const isStreaming = runStatus === "running" || session.data?.streaming === true;

  const send = useMutation({
    mutationFn: async (behavior?: "steer" | "followUp") => {
      if (!input.trim()) return;
      if (behavior === "steer") await api.post(`/api/sessions/${sessionId}/steer`, { text: input.trim() });
      else if (behavior === "followUp") await api.post(`/api/sessions/${sessionId}/followup`, { text: input.trim() });
      else await api.post(`/api/sessions/${sessionId}/prompt`, { text: input.trim() });
    },
    onSuccess: () => setInput(""),
  });

  const abort = useMutation({ mutationFn: () => api.post(`/api/sessions/${sessionId}/abort`) });

  const s = session.data;
  return (
    <div className="page session">
      <div className="session-head">
        <a href="#/sessions">← 返回</a>
        <h3>{s?.name || s?.id?.slice(0, 8) || "…"}</h3>
        <span className="meta">
          {s?.modelId && <span className="badge">{s.modelId}</span>}
          <code className="cwd-inline">{s?.cwd}</code>
          {s?.taskId && (
            <a className="badge task" href={`#/task/${s.taskId}`}>
              task #{s.taskId}
            </a>
          )}
          {isStreaming && <span className="badge live">● streaming</span>}
        </span>
      </div>

      <div className="messages">
        {(entries.data ?? []).map((e) => (
          <EntryView key={e.id} e={e} />
        ))}
        {streaming && (
          <div className="msg assistant streaming">
            <pre>{streaming}</pre>
          </div>
        )}
        {(entries.data ?? []).length === 0 && !streaming && <div className="muted center">空会话，发送第一条消息开始</div>}
        <div ref={bottomRef} />
      </div>

      <div className="composer card">
        <textarea
          placeholder={isStreaming ? "正在生成… 可插话（steer）或排队（follow-up）" : "输入消息…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send.mutate();
          }}
        />
        <div className="row">
          {isStreaming ? (
            <>
              <button disabled={!input.trim() || send.isPending} onClick={() => send.mutate("steer")}>
                插话 steer
              </button>
              <button disabled={!input.trim() || send.isPending} onClick={() => send.mutate("followUp")}>
                排队 follow-up
              </button>
              <button className="danger" disabled={abort.isPending} onClick={() => abort.mutate()}>
                中止
              </button>
            </>
          ) : (
            <button className="primary" disabled={!input.trim() || send.isPending} onClick={() => send.mutate()}>
              发送 ⌘↵
            </button>
          )}
          {send.isError && <span className="error">{String(send.error)}</span>}
        </div>
      </div>
    </div>
  );
}
