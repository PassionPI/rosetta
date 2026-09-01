import {
  acceptTask,
  completeTask,
  getTask,
  nudgeTask,
  rejectTask,
} from "@/api/tasks.ts";
import Markdown from "@/components/Markdown.tsx";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { defineActionHandler, useAction } from "@/hooks/useAction";
import type { TaskDTO } from "@rosetta/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, CircleCheckBig, Send, Undo2 } from "lucide-react";
import SessionView from "./SessionView.tsx";

interface ReviewState {
  feedback: string;
}

interface ReviewActions {
  setFeedback: string;
}

/**
 * 任务页：左右布局。
 * 左：任务信息 + 验收操作；右：执行会话（100% 宽嵌入）。
 */
export default function TaskReview({ taskId }: { taskId: number }) {
  const queryClient = useQueryClient();

  const [state, actions] = useAction(
    (): ReviewState => ({ feedback: "" }),
    defineActionHandler<ReviewState, ReviewActions>({
      setFeedback: (s, v) => {
        s.feedback = v;
      },
    }),
  );

  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => getTask(taskId).unwrap(),
  });

  const accept = useMutation({
    mutationFn: () => acceptTask(taskId).unwrap(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const reject = useMutation({
    mutationFn: () => rejectTask(taskId, { feedback: state.feedback }).unwrap(),
    onSuccess: () => {
      actions.setFeedback("");
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
  const nudge = useMutation({
    mutationFn: () => nudgeTask(taskId).unwrap(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const complete = useMutation({
    mutationFn: () => completeTask(taskId).unwrap(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const t: TaskDTO | undefined = task.data;

  if (task.isLoading)
    return <p className="p-6 text-sm text-muted-foreground">加载中…</p>;
  if (!t) return <p className="p-6 text-sm text-destructive">任务不存在</p>;

  const statusColor: Record<string, string> = {
    running: "border-primary/50 text-primary",
    awaiting_review: "border-amber-500/50 text-amber-400",
    finishing: "border-amber-500/50 text-amber-400",
    done: "border-emerald-600/50 text-emerald-400",
    failed: "border-destructive/60 text-destructive",
  };

  return (
    <div className="flex h-[calc(100vh-3.4rem)]">
      {/* 左：任务面板 */}
      <div className="flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-r p-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/repo/$repoId" params={{ repoId: String(t.repoId) }}>
              ← 返回
            </Link>
          </Button>
          <h2 className="text-base font-semibold">
            task #{t.id}
            <span
              className={`ml-2 rounded border px-1.5 py-px text-xs font-normal ${statusColor[t.status] ?? "border-border text-muted-foreground"}`}
            >
              {t.status}
            </span>
          </h2>
        </div>

        <section>
          <h4 className="mb-1.5 text-sm font-semibold">任务描述</h4>
          <pre className="whitespace-pre-wrap rounded-lg border bg-black/30 p-3 font-mono text-xs">
            {t.description}
          </pre>
        </section>

        <div className="grid gap-1.5 text-xs text-muted-foreground">
          <span>
            slot:{" "}
            <code className="text-foreground">{t.worktreePath ?? "—"}</code>
          </span>
          <span>
            分支: <code className="text-foreground">{t.branch ?? "—"}</code>
          </span>
          <span>
            base:{" "}
            <code className="text-foreground">
              {t.baseCommit?.slice(0, 10) ?? "—"}
            </code>
            {t.endCommit && (
              <>
                {" → "}end:{" "}
                <code className="text-foreground">
                  {t.endCommit.slice(0, 10)}
                </code>
              </>
            )}
          </span>
          {t.deps.length > 0 && (
            <span>依赖: {t.deps.map((d) => `#${d}`).join(" ")}</span>
          )}
          {t.rejectCount ? <span>返工次数: {t.rejectCount}</span> : null}
        </div>

        {t.error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
            {t.error}
          </p>
        )}

        {t.summary && (
          <section>
            <h4 className="mb-1.5 text-sm font-semibold">
              完成摘要（submit_for_review）
            </h4>
            <div className="rounded-lg border bg-black/30 p-3">
              <Markdown>{t.summary}</Markdown>
            </div>
          </section>
        )}

        {t.baseCommit && (
          <p className="text-xs text-muted-foreground">
            任务改动范围：
            <code className="text-foreground">
              git diff {t.baseCommit?.slice(0, 10)}
              {t.endCommit ? `..${t.endCommit.slice(0, 10)}` : ""}
            </code>
          </p>
        )}

        {t.status === "awaiting_review" && (
          <div className="flex flex-col gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              commit message 将由 AI 根据需求与改动总结生成。
            </p>
            <div>
              <Button
                disabled={accept.isPending}
                onClick={() => accept.mutate()}
              >
                <Check className="size-4" />
                {accept.isPending
                  ? "AI 总结并提交中…"
                  : "验收通过（AI commit + push）"}
              </Button>
              {accept.isError && (
                <p className="mt-1 text-sm text-destructive">
                  {String(accept.error)}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>返工反馈（将作为 follow-up 发给 agent）</Label>
              <Textarea
                className="min-h-16"
                placeholder="哪里没达预期、期望改成什么样"
                value={state.feedback}
                onChange={(e) => actions.setFeedback(e.target.value)}
              />
            </div>
            <div>
              <Button
                variant="destructive"
                disabled={!state.feedback.trim() || reject.isPending}
                onClick={() => reject.mutate()}
              >
                <Undo2 className="size-4" /> 驳回返工
              </Button>
              {reject.isError && (
                <p className="mt-1 text-sm text-destructive">
                  {String(reject.error)}
                </p>
              )}
            </div>
          </div>
        )}

        {t.status === "running" && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <Button
              variant="secondary"
              disabled={nudge.isPending}
              onClick={() => nudge.mutate()}
            >
              <Send className="size-4" /> 催促（提醒调用 submit_for_review）
            </Button>
            <Button
              variant="outline"
              disabled={complete.isPending}
              onClick={() => complete.mutate()}
            >
              <CircleCheckBig className="size-4" /> 人工标记完成
            </Button>
            {nudge.isSuccess && (
              <span className="text-xs text-muted-foreground">催促已发送</span>
            )}
          </div>
        )}
      </div>

      {/* 右：执行会话（无间隙全宽） */}
      <div className="min-w-0 flex-1">
        {t.sessionId ? (
          <SessionView sessionId={t.sessionId} embedded />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无执行会话（任务未派发）
          </div>
        )}
      </div>
    </div>
  );
}
