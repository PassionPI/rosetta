import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RepoDTO, TaskDTO } from "@rossetta/shared";
import { api } from "../api/client.ts";

const TASK_STATUS_LABEL: Record<string, string> = {
  queued: "排队",
  running: "执行中",
  awaiting_review: "待验收",
  finishing: "提交中",
  done: "完成",
  failed: "失败",
  cancelled: "已取消",
};

function RepoPanel({ repo }: { repo: RepoDTO }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [deps, setDeps] = useState<number[]>([]);
  const [wtName, setWtName] = useState("");

  const tasks = useQuery({
    queryKey: ["tasks", repo.id],
    queryFn: () => api.get<TaskDTO[]>(`/api/repos/${repo.id}/tasks`),
  });

  const addTask = useMutation({
    mutationFn: () => api.post(`/api/repos/${repo.id}/tasks`, { description, dependsOn: deps.length ? deps : undefined }),
    onSuccess: () => {
      setDescription("");
      setDeps([]);
      void queryClient.invalidateQueries({ queryKey: ["tasks", repo.id] });
    },
  });
  const addWt = useMutation({
    mutationFn: () => api.post(`/api/repos/${repo.id}/worktrees`, { name: wtName }),
    onSuccess: () => {
      setWtName("");
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api.post(`/api/tasks/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", repo.id] }),
  });
  const retry = useMutation({
    mutationFn: (id: number) => api.post(`/api/tasks/${id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", repo.id] }),
  });

  const list = tasks.data ?? [];

  return (
    <div className="card repo">
      <h3>
        {repo.displayName} <code className="cwd-inline">{repo.repoRoot}</code>
      </h3>

      <div className="slots">
        {repo.worktrees.map((w) => (
          <div key={w.path} className={`slot ${w.status}`}>
            <div className="slot-head">
              <strong>
                slot {w.slotOrder} · {w.name}
              </strong>
              <span className={`badge ${w.status}`}>{w.status}</span>
            </div>
            <div className="meta">
              <code>{w.branch ?? "detached"}</code>
              {w.currentTaskId && (
                <a className="badge task" href={`#/task/${w.currentTaskId}`}>
                  task #{w.currentTaskId}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        <input placeholder="新 worktree 名（建在 repo 同级目录）" value={wtName} onChange={(e) => setWtName(e.target.value)} />
        <button disabled={!wtName.trim() || addWt.isPending} onClick={() => addWt.mutate()}>
          + worktree
        </button>
      </div>

      <table className="tasks">
        <thead>
          <tr>
            <th>#</th>
            <th>状态</th>
            <th>描述</th>
            <th>slot / 分支</th>
            <th>依赖</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.map((t) => (
            <tr key={t.id} className={t.status}>
              <td>{t.seq}</td>
              <td>
                <span className={`badge ${t.status}`}>
                  {TASK_STATUS_LABEL[t.status] ?? t.status}
                  {t.rejectCount ? ` ×${t.rejectCount}` : ""}
                </span>
              </td>
              <td>
                <a href={`#/task/${t.id}`}>{t.description.split("\n")[0].slice(0, 80)}</a>
                {t.error && <div className="error small">{t.error}</div>}
              </td>
              <td>{t.worktreePath ? `${t.worktreePath.split("/").pop()}@${t.branch ?? "?"}` : "—"}</td>
              <td>{t.deps.length ? t.deps.map((d) => `#${d}`).join(" ") || "" : "—"}</td>
              <td>
                {(t.status === "queued" || t.status === "failed") && (
                  <button className="small" onClick={() => (t.status === "failed" ? retry.mutate(t.id) : cancel.mutate(t.id))}>
                    {t.status === "failed" ? "重试" : "取消"}
                  </button>
                )}
                {t.status === "running" && (
                  <button className="small" onClick={() => cancel.mutate(t.id)}>
                    取消
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="addtask">
        <textarea placeholder="任务描述（一段话）" value={description} onChange={(e) => setDescription(e.target.value)} />
        {list.length > 0 && (
          <div className="chips">
            {list.map((t) => (
              <button
                key={t.id}
                className={`chip small ${deps.includes(t.id) ? "active" : ""}`}
                onClick={() => setDeps((d) => (d.includes(t.id) ? d.filter((x) => x !== t.id) : [...d, t.id]))}
              >
                dep #{t.seq}
              </button>
            ))}
          </div>
        )}
        <button className="primary" disabled={!description.trim() || addTask.isPending} onClick={() => addTask.mutate()}>
          添加任务
        </button>
        {addTask.isError && <div className="error">{String(addTask.error)}</div>}
      </div>
    </div>
  );
}

export default function ProjectBoard({ repoId }: { repoId?: number }) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState("");

  const repos = useQuery({ queryKey: ["repos"], queryFn: () => api.get<RepoDTO[]>("/api/repos") });
  const register = useMutation({
    mutationFn: () => api.post<{ id: number }>("/api/repos", { path }),
    onSuccess: () => {
      setPath("");
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });

  const list = repos.data ?? [];
  const shown = repoId ? list.filter((r) => r.id === repoId) : list;

  return (
    <div className="page">
      <div className="card">
        <h3>注册项目（git repo）</h3>
        <div className="row">
          <input placeholder="仓库路径（main worktree 或其子目录）" value={path} onChange={(e) => setPath(e.target.value)} />
          <button disabled={!path.trim() || register.isPending} onClick={() => register.mutate()}>
            注册
          </button>
        </div>
        {register.isError && <div className="error">{String(register.error)}</div>}
      </div>

      {shown.length === 0 && <div className="muted">尚未注册项目。注册后会自动发现 main + 全部 worktree。</div>}
      {shown.map((r) => (
        <RepoPanel key={r.id} repo={r} />
      ))}
    </div>
  );
}
