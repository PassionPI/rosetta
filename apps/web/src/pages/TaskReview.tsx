import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Undo2, X } from "lucide-react";
import type { TaskDTO } from "@rossetta/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Markdown from "../components/Markdown.tsx";
import { api } from "../api/client.ts";

export default function TaskReview({ taskId }: { taskId: number }) {
  const queryClient = useQueryClient();
  const [commitMessage, setCommitMessage] = useState("");
  const [feedback, setFeedback] = useState("");

  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => api.get<TaskDTO>(`/api/tasks/${taskId}`) });

  const accept = useMutation({
    mutationFn: () => api.post(`/api/tasks/${taskId}/accept`, { commitMessage: commitMessage || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });
  const reject = useMutation({
    mutationFn: () => api.post(`/api/tasks/${taskId}/reject`, { feedback }),
    onSuccess: () => {
      setFeedback("");
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
  const nudge = useMutation({
    mutationFn: () => api.post(`/api/tasks/${taskId}/nudge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const t = task.data;
  if (task.isLoading) return <p className="text-sm text-muted-foreground">加载中…</p>;
  if (!t) return <p className="text-sm text-destructive">任务不存在</p>;

  const statusColor: Record<string, string> = {
    running: "border-primary/50 text-primary",
    awaiting_review: "border-amber-500/50 text-amber-400",
    finishing: "border-amber-500/50 text-amber-400",
    done: "border-emerald-600/50 text-emerald-400",
    failed: "border-destructive/60 text-destructive",
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <Button variant="ghost" size="sm" onClick={() => (location.hash = `#/repo/${t.repoId}`)}>
          ← 返回
        </Button>
        <CardTitle className="text-base">
          task #{t.id}
          <span className={`ml-2 rounded border px-1.5 py-px text-xs font-normal ${statusColor[t.status] ?? "border-border text-muted-foreground"}`}>
            {t.status}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section>
          <h4 className="mb-1.5 text-sm font-semibold">任务描述</h4>
          <pre className="whitespace-pre-wrap rounded-lg border bg-black/30 p-3 font-mono text-xs">
            {t.description}
          </pre>
        </section>

        <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          <span>
            slot: <code className="text-foreground">{t.worktreePath ?? "—"}</code>
          </span>
          <span>
            分支: <code className="text-foreground">{t.branch ?? "—"}</code>
          </span>
          <span>
            base: <code className="text-foreground">{t.baseCommit?.slice(0, 10) ?? "—"}</code>
            {t.endCommit && (
              <>
                {" → "}end: <code className="text-foreground">{t.endCommit.slice(0, 10)}</code>
              </>
            )}
          </span>
          {t.deps.length > 0 && <span>依赖: {t.deps.map((d) => `#${d}`).join(" ")}</span>}
          {t.rejectCount ? <span>返工次数: {t.rejectCount}</span> : null}
        </div>

        {t.error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
            {t.error}
          </p>
        )}

        {t.summary && (
          <section>
            <h4 className="mb-1.5 text-sm font-semibold">完成摘要（submit_for_review）</h4>
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
            （在 {t.worktreePath} 执行）
          </p>
        )}

        {t.sessionId && (
          <a href={`#/session/${t.sessionId}`} className="text-sm text-primary hover:underline">
            → 查看执行会话
          </a>
        )}

        {t.status === "awaiting_review" && (
          <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex flex-col gap-1.5">
              <Label>commit message（默认：#id + 描述首行）</Label>
              <Textarea
                className="min-h-16"
                placeholder={`#${t.id} ${t.description.split("\n")[0].slice(0, 60)}`}
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
              />
            </div>
            <div>
              <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
                <Check className="size-4" /> 验收通过（commit + push 当前分支）
              </Button>
              {accept.isError && <p className="mt-1 text-sm text-destructive">{String(accept.error)}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>返工反馈（将作为 follow-up 发给 agent）</Label>
              <Textarea
                className="min-h-16"
                placeholder="哪里没达预期、期望改成什么样"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
            <div>
              <Button variant="destructive" disabled={!feedback.trim() || reject.isPending} onClick={() => reject.mutate()}>
                <Undo2 className="size-4" /> 驳回返工
              </Button>
              {reject.isError && <p className="mt-1 text-sm text-destructive">{String(reject.error)}</p>}
            </div>
          </div>
        )}

        {t.status === "running" && (
          <div className="flex items-center gap-2 border-t pt-4">
            <Button variant="secondary" disabled={nudge.isPending} onClick={() => nudge.mutate()}>
              催促（提醒调用 submit_for_review）
            </Button>
            {nudge.isSuccess && <span className="text-xs text-muted-foreground">已发送</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
