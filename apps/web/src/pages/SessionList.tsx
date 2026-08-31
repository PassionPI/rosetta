import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelInfo, ProjectDTO, SessionSummary } from "@rossetta/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "../api/client.ts";

export default function SessionList() {
  const [cwd, setCwd] = useState<string | null>(null);
  const [newCwd, setNewCwd] = useState("");
  const [newName, setNewName] = useState("");
  const [newModel, setNewModel] = useState("");
  const queryClient = useQueryClient();

  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => api.get<ModelInfo[]>("/api/models"),
    staleTime: 60_000,
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<ProjectDTO[]>("/api/projects"),
  });
  const sessions = useQuery({
    queryKey: ["sessions", cwd],
    queryFn: () =>
      api.get<SessionSummary[]>(
        cwd ? `/api/sessions?cwd=${encodeURIComponent(cwd)}` : "/api/sessions",
      ),
    refetchInterval: 10_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<SessionSummary>("/api/sessions", {
        cwd: newCwd,
        name: newName || undefined,
        model: newModel || undefined,
      }),
    onSuccess: (s) => {
      setNewCwd("");
      setNewName("");
      setNewModel("");
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
    return [...byCwd.entries()].sort(
      (a, b) => (b[1][0]?.updatedAt ?? 0) - (a[1][0]?.updatedAt ?? 0),
    );
  }, [sessions.data]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">新建会话</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 flex flex-col gap-1.5">
              <Label>项目路径（worktree 绝对路径）</Label>
              <Input value={newCwd} onChange={(e) => setNewCwd(e.target.value)} placeholder="/srv/project/worktree-a" />
            </div>
            <div className="w-44 flex flex-col gap-1.5">
              <Label>名称（可选）</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="重构登录" />
            </div>
            <div className="w-56 flex flex-col gap-1.5">
              <Label>初始模型</Label>
              <Select value={newModel || "default"} onValueChange={setNewModel}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="默认模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">默认模型（pi 设置）</SelectItem>
                  {(models.data ?? []).map((m) => {
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
            <Button disabled={!newCwd.trim() || create.isPending} onClick={() => create.mutate()}>
              创建
            </Button>
          </div>
          {create.isError && <p className="text-sm text-destructive">{String(create.error)}</p>}
        </CardContent>
      </Card>

      {projects.data && projects.data.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {projects.data.map((p) => (
            <button
              key={p.path}
              onClick={() => setCwd(cwd === p.path ? null : p.path)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                cwd === p.path
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {p.displayName}
              {p.isWorktree ? ` · wt:${p.worktreeName}` : ""}
              {p.branch ? ` (${p.branch})` : ""}
            </button>
          ))}
        </div>
      )}

      {grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无会话。上面输入项目路径创建第一个。</p>
      )}

      {grouped.map(([groupCwd, list]) => (
        <section key={groupCwd} className="flex flex-col gap-1.5">
          <h3 className="font-mono text-xs text-muted-foreground">{groupCwd}</h3>
          {list.map((s) => (
            <a
              key={s.id}
              href={`#/session/${s.id}`}
              className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:border-primary/50 ${
                s.status === "active" ? "border-emerald-600/40" : "border-border"
              }`}
            >
              <span className="truncate text-sm font-medium">
                {s.name || s.id.slice(0, 8)}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                {s.taskId && (
                  <span className="rounded border border-amber-500/50 px-1.5 py-px text-amber-400">
                    task #{s.taskId}
                  </span>
                )}
                {s.modelId && (
                  <span className="rounded border border-border px-1.5 py-px">{s.modelId}</span>
                )}
                {s.updatedAt && <span>{new Date(s.updatedAt).toLocaleString()}</span>}
              </span>
            </a>
          ))}
        </section>
      ))}
    </div>
  );
}
