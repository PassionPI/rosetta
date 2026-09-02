import { listModels } from "@/api/projects.ts";
import {
  abortSession,
  followUpSession,
  getSession,
  listEntries,
  listSessionTools,
  promptSession,
  setSessionModel,
  steerSession,
} from "@/api/sessions.ts";
import Markdown from "@/components/Markdown.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { defineActionHandler, useAction } from "@/hooks/useAction";
import { wsClient } from "@/ws/client.ts";
import type { EntryDTO, ModelInfo } from "@rosetta/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CircleStop, Send, Wrench } from "lucide-react";
import { useEffect, useRef } from "react";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: any) =>
      c.type === "text" ? c.text : c.type === "image" ? "[图片]" : "",
    )
    .join("");
}

function EntryView({ e }: { e: EntryDTO }) {
  const p = e.payload as any;
  if (e.kind === "message") {
    const m = p.message ?? {};
    if (m.role === "user") {
      return (
        <div className="ml-auto max-w-[86%] whitespace-pre-wrap rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm">
          {textOf(m.content)}
        </div>
      );
    }
    if (m.role === "assistant") {
      const parts: any[] = Array.isArray(m.content) ? m.content : [];
      const thinking = parts
        .filter((c) => c.type === "thinking")
        .map((c) => c.thinking)
        .join("\n");
      const text = parts
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      const calls = parts.filter((c) => c.type === "toolCall");
      return (
        <div className="mr-auto max-w-[86%] space-y-2 rounded-xl border bg-card p-3 text-sm">
          {thinking && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">thinking</summary>
              <pre className="mt-1 whitespace-pre-wrap">{thinking}</pre>
            </details>
          )}
          {text && <Markdown>{text}</Markdown>}
          {calls.length > 0 && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {calls.map((c) => (
                <details key={c.id}>
                  <summary className="cursor-pointer select-none">
                    <code className="text-primary">{c.name}</code>
                  </summary>
                  <pre className="mt-1 whitespace-pre-wrap">
                    {JSON.stringify(c.arguments, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      );
    }
    if (m.role === "toolResult") {
      return (
        <details
          className={`mr-auto max-w-[86%] text-xs ${m.isError ? "text-destructive" : "text-muted-foreground"}`}
        >
          <summary className="cursor-pointer select-none">
            <code>{m.toolName}</code> {m.isError ? "✖" : "✓"}
          </summary>
          <pre className="mt-1 whitespace-pre-wrap rounded-lg border bg-black/30 p-2">
            {textOf(m.content).slice(0, 4000)}
          </pre>
        </details>
      );
    }
    return null;
  }
  if (e.kind === "compaction") {
    return (
      <p className="text-center text-xs text-muted-foreground">
        ⋯ 上下文已压缩（{p.tokensBefore ?? "?"} tokens → 摘要）
      </p>
    );
  }
  if (e.kind === "branch_summary") {
    return (
      <p className="text-center text-xs text-muted-foreground">
        ⋯ 分支切换摘要
      </p>
    );
  }
  return null;
}

interface ViewState {
  streaming: string;
  runStatus: string | null;
  input: string;
  toolsOpen: boolean;
}

/** 按业务语义设计 action：runStatus 置状态时顺带结束流式；sent 清空已发送输入 */
interface ViewActions {
  editInput: string;
  sent: null;
  appendDelta: string;
  stopStreaming: null;
  runStatus: string;
  toggleTools: boolean;
}

export default function SessionView({
  sessionId,
  embedded = false,
}: {
  sessionId: string;
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [state, actions] = useAction(
    (): ViewState => ({
      streaming: "",
      runStatus: null,
      input: "",
      toolsOpen: false,
    }),
    defineActionHandler<ViewState, ViewActions>({
      editInput: (s, v) => {
        s.input = v;
      },
      sent: (s) => {
        s.input = "";
      },
      appendDelta: (s, delta) => {
        s.streaming += delta;
      },
      stopStreaming: (s) => {
        s.streaming = "";
      },
      runStatus: (s, v) => {
        s.runStatus = v;
        if (v !== "running") s.streaming = "";
      },
      toggleTools: (s, v) => {
        s.toolsOpen = v;
      },
    }),
  );

  const session = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSession(sessionId).unwrap(),
  });
  const entries = useQuery({
    queryKey: ["entries", sessionId],
    queryFn: () => listEntries(sessionId).unwrap(),
  });
  const tools = useQuery({
    queryKey: ["tools", sessionId],
    queryFn: () => listSessionTools(sessionId).unwrap(),
    enabled: state.toolsOpen,
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
        actions.runStatus(msg.status);
        return;
      }
      if (msg.kind !== "event") return;
      const ev = msg.event as any;
      if (
        ev.type === "message_update" &&
        ev.assistantMessageEvent?.type === "text_delta"
      ) {
        actions.appendDelta(ev.assistantMessageEvent.delta);
      } else if (
        ev.type === "message_end" ||
        ev.type === "agent_end" ||
        ev.type === "entry_appended"
      ) {
        actions.stopStreaming();
        refetchTimer ??= setTimeout(() => {
          refetchTimer = null;
          void queryClient.invalidateQueries({
            queryKey: ["entries", sessionId],
          });
          void queryClient.invalidateQueries({
            queryKey: ["session", sessionId],
          });
        }, 300);
      }
    });
    return () => {
      off();
      if (refetchTimer) clearTimeout(refetchTimer);
    };
  }, [sessionId, queryClient, actions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.dataUpdatedAt, state.streaming]);

  const isStreaming =
    state.runStatus === "running" || session.data?.streaming === true;

  const send = useMutation({
    mutationFn: async (behavior?: "steer" | "followUp") => {
      const text = state.input.trim();
      if (!text) return;
      if (behavior === "steer")
        await steerSession(sessionId, { text }).unwrap();
      else if (behavior === "followUp")
        await followUpSession(sessionId, { text }).unwrap();
      else await promptSession(sessionId, { text }).unwrap();
    },
    onSuccess: () => actions.sent(),
  });

  const abort = useMutation({
    mutationFn: () => abortSession(sessionId).unwrap(),
  });

  // 模型切换
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => listModels().unwrap(),
    staleTime: 60_000,
  });
  const setModel = useMutation({
    mutationFn: (spec: string) =>
      setSessionModel(sessionId, { model: spec }).unwrap(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] }),
  });

  const s = session.data;
  const currentSpec =
    s?.provider && s?.modelId ? `${s.provider}/${s.modelId}` : "";

  return (
    <div
      className={
        embedded
          ? "flex h-full min-w-0 flex-col gap-2 p-3"
          : "mx-auto flex max-w-3xl flex-col gap-3"
      }
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {!embedded && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/sessions">
              <ArrowLeft className="size-4" /> 返回
            </Link>
          </Button>
        )}
        {embedded && (
          <h2 className="truncate text-sm font-semibold">
            {s?.name || s?.id?.slice(0, 8) || "…"}
          </h2>
        )}
        <div className="w-56">
          <Select
            value={
              setModel.isPending ? "__pending" : currentSpec || "__placeholder"
            }
            onValueChange={(v) => {
              if (v !== "__placeholder" && v !== "__pending")
                setModel.mutate(v);
            }}
            disabled={setModel.isPending}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__placeholder" disabled>
                {setModel.isPending ? "切换中…" : (s?.modelId ?? "模型")}
              </SelectItem>
              {(models.data ?? []).map((m: ModelInfo) => {
                const spec = `${m.providerId}/${m.modelId}`;
                return (
                  <SelectItem key={spec} value={spec}>
                    {m.displayName}（{spec}）
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={state.toolsOpen} onOpenChange={actions.toggleTools}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Wrench className="size-4" />
              工具{tools.data ? ` (${tools.data.length})` : ""}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[70vh] max-w-lg">
            <DialogHeader>
              <DialogTitle>已加载工具</DialogTitle>
              <DialogDescription>
                当前会话暴露给模型的工具列表
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[50vh] pr-3">
              <div className="space-y-2">
                {tools.isLoading && (
                  <p className="text-sm text-muted-foreground">加载中…</p>
                )}
                {(tools.data ?? []).map((t) => (
                  <div key={t.name} className="rounded-lg border p-2.5">
                    <code className="text-sm text-primary">{t.name}</code>
                    <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
                      {t.description || "（无描述）"}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {isStreaming && (
            <Badge className="border-emerald-600/50 bg-emerald-600/10 text-emerald-400">
              ● streaming
            </Badge>
          )}
          {!embedded && (
            <code className="hidden truncate sm:inline">{s?.cwd}</code>
          )}
          {s?.taskId && (
            <Link
              to="/task/$taskId"
              params={{ taskId: String(s.taskId) }}
              className="rounded border border-amber-500/50 px-1.5 py-px text-amber-400"
            >
              task #{s.taskId}
            </Link>
          )}
        </div>
      </div>

      <div
        className={
          embedded
            ? "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg border bg-black/10 p-3"
            : "flex h-[56vh] flex-col gap-2 overflow-y-auto rounded-lg border bg-black/10 p-3"
        }
      >
        {(entries.data ?? []).map((e) => (
          <EntryView key={e.id} e={e} />
        ))}
        {state.streaming && (
          <div className="mr-auto max-w-[86%] rounded-xl border border-dashed border-primary/50 bg-card p-3 text-sm">
            <Markdown>{state.streaming}</Markdown>
          </div>
        )}
        {(entries.data ?? []).length === 0 && !state.streaming && (
          <p className="m-auto text-sm text-muted-foreground">
            空会话，发送第一条消息开始
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <Card className={embedded ? "border-0 shadow-none" : undefined}>
        <CardContent className="flex flex-col gap-2 p-3">
          <Label htmlFor="composer" className="sr-only">
            消息
          </Label>
          <Textarea
            id="composer"
            className="min-h-20"
            placeholder={
              isStreaming
                ? "正在生成… 可插话（steer）或排队（follow-up）"
                : "输入消息…"
            }
            value={state.input}
            onChange={(e) => actions.editInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send.mutate();
            }}
          />
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!state.input.trim() || send.isPending}
                  onClick={() => send.mutate("steer")}
                >
                  插话 steer
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!state.input.trim() || send.isPending}
                  onClick={() => send.mutate("followUp")}
                >
                  排队 follow-up
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={abort.isPending}
                  onClick={() => abort.mutate()}
                >
                  <CircleStop className="size-4" /> 中止
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={!state.input.trim() || send.isPending}
                onClick={() => send.mutate()}
              >
                <Send className="size-4" /> 发送
                <kbd className="ml-1 rounded bg-black/30 px-1 text-[10px]">
                  ⌘↵
                </kbd>
              </Button>
            )}
            {send.isError && (
              <span className="text-xs text-destructive">
                {String(send.error)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
