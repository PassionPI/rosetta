import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectDTO, SessionSummary } from "@rossetta/shared";
import { api } from "../api/client.ts";

export default function SessionList() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [newCwd, setNewCwd] = useState("");
  const [newName, setNewName] = useState("");
  const queryClient = useQueryClient();

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<ProjectDTO[]>("/api/projects") });
  const sessions = useQuery({
    queryKey: ["sessions", cwd],
    queryFn: () => api.get<SessionSummary[]>(cwd ? `/api/sessions?cwd=${encodeURIComponent(cwd)}` : "/api/sessions"),
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: () => api.post<SessionSummary>("/api/sessions", { cwd: newCwd, name: newName || undefined }),
    onSuccess: (s) => {
      setNewCwd("");
      setNewName("");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      location.hash = `#/session/${s.id}`;
    },
  });

  const grouped = useMemo(() => {
    const byCwd = new Map<string, SessionSummary[]>();
    for (const s of sessions.data ?? []) {
      const list = byCwd.get(s.cwd) ?? [];
      list.push(s);
      byCwd.set(s.cwd, list);
    }
    return [...byCwd.entries()].sort((a, b) => (b[1][0]?.updatedAt ?? 0) - (a[1][0]?.updatedAt ?? 0));
  }, [sessions.data]);

  return (
    <div className="page">
      <div className="card">
        <h3>新建会话</h3>
        <div className="row">
          <input placeholder="项目路径（worktree 绝对路径）" value={newCwd} onChange={(e) => setNewCwd(e.target.value)} />
          <input placeholder="名称（可选）" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button disabled={!newCwd.trim() || create.isPending} onClick={() => create.mutate()}>
            创建
          </button>
        </div>
        {create.isError && <div className="error">{String(create.error)}</div>}
      </div>

      {projects.data && projects.data.length > 0 && (
        <div className="chips">
          {projects.data.map((p) => (
            <button key={p.path} className={`chip ${cwd === p.path ? "active" : ""}`} onClick={() => setCwd(cwd === p.path ? null : p.path)}>
              {p.displayName}
              {p.isWorktree ? ` · wt:${p.worktreeName}` : ""}
              {p.branch ? ` (${p.branch})` : ""}
            </button>
          ))}
        </div>
      )}

      {grouped.length === 0 && <div className="muted">暂无会话。上面输入项目路径创建第一个。</div>}

      {grouped.map(([groupCwd, list]) => (
        <section key={groupCwd}>
          <h3 className="cwd">{groupCwd}</h3>
          {list.map((s) => (
            <a key={s.id} className={`item ${s.status === "active" ? "live" : ""}`} href={`#/session/${s.id}`}>
              <span className="title">{s.name || s.id.slice(0, 8)}</span>
              <span className="meta">
                {s.taskId && <span className="badge task">task #{s.taskId}</span>}
                {s.modelId && <span className="badge">{s.modelId}</span>}
                {s.updatedAt && <span>{new Date(s.updatedAt).toLocaleString()}</span>}
              </span>
            </a>
          ))}
        </section>
      ))}
    </div>
  );
}
