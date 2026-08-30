import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskDTO } from "@rossetta/shared";
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
  if (task.isLoading) return <div className="muted center">加载中…</div>;
  if (!t) return <div className="error">任务不存在</div>;

  return (
    <div className="page">
      <div className="card">
        <div className="session-head">
          <a href={`#/repo/${t.repoId}`}>← 返回</a>
          <h3>
            task #{t.id} <span className={`badge ${t.status}`}>{t.status}</span>
          </h3>
        </div>

        <h4>任务描述</h4>
        <pre className="desc">{t.description}</pre>

        <div className="meta grid">
          <span>slot: <code>{t.worktreePath ?? "—"}</code></span>
          <span>分支: <code>{t.branch ?? "—"}</code></span>
          <span>
            base: <code>{t.baseCommit?.slice(0, 10) ?? "—"}</code>
            {t.endCommit && (
              <>
                {" → "}end: <code>{t.endCommit.slice(0, 10)}</code>
              </>
            )}
          </span>
          {t.deps.length > 0 && <span>依赖: {t.deps.map((d) => `#${d}`).join(" ")}</span>}
          {t.rejectCount ? <span>返工次数: {t.rejectCount}</span> : null}
        </div>

        {t.error && <div className="error">{t.error}</div>}

        {t.summary && (
          <>
            <h4>完成摘要（submit_for_review）</h4>
            <pre className="desc">{t.summary}</pre>
          </>
        )}

        {t.baseCommit && (
          <div className="muted small">
            任务改动范围：<code>git diff {t.baseCommit?.slice(0, 10)}{t.endCommit ? `..${t.endCommit.slice(0, 10)}` : ""}</code>
            （在 {t.worktreePath} 执行）
          </div>
        )}

        {t.sessionId && (
          <p>
            <a href={`#/session/${t.sessionId}`}>→ 查看执行会话</a>
          </p>
        )}

        {t.status === "awaiting_review" && (
          <div className="review-actions">
            <textarea
              placeholder="commit message（默认：#id + 描述首行）"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <div className="row">
              <button className="primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
                验收通过（commit + push 当前分支）
              </button>
            </div>
            {accept.isError && <div className="error">{String(accept.error)}</div>}
            <textarea placeholder="返工反馈（将作为 follow-up 发给 agent）" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <div className="row">
              <button className="danger" disabled={!feedback.trim() || reject.isPending} onClick={() => reject.mutate()}>
                驳回返工
              </button>
            </div>
            {reject.isError && <div className="error">{String(reject.error)}</div>}
          </div>
        )}

        {t.status === "running" && (
          <div className="row">
            <button disabled={nudge.isPending} onClick={() => nudge.mutate()}>
              催促（提醒调用 submit_for_review）
            </button>
            {nudge.isSuccess && <span className="muted">已发送</span>}
          </div>
        )}
      </div>
    </div>
  );
}
