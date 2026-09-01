import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelInfo, RepoDTO, TaskDTO } from "@rossetta/shared";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
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

function statusClass(status: string): string {
  switch (status) {
    case "running":
    case "busy":
      return "border-primary/50 text-primary";
    case "awaiting_review":
    case "finishing":
      return "border-amber-500/50 text-amber-400";
    case "done":
    case "idle":
      return "border-emerald-600/50 text-emerald-400";
    case "failed":
    case "unavailable":
      return "border-destructive/60 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`rounded border px-1.5 py-px text-[11px] ${statusClass(status)}`}>
      {label ?? TASK_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function RepoPanel({ repo }: { repo: RepoDTO }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [deps, setDeps] = useState<number[]>([]);
  const [wtName, setWtName] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const tasks = useQuery({
    queryKey: ["tasks", repo.id],
    queryFn: () => api.get<TaskDTO[]>(`/api/repos/${repo.id}/tasks`),
  });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => api.get<ModelInfo[]>("/api/models"),
    staleTime: 60_000,
  });

  const setRepoModel = useMutation({
    mutationFn: (m: string) =>
      api.post(`/api/repos/${repo.id}/model`, { model: m === "__default" ? "" : m }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos"] }),
  });

  // 状态筛选（md 需求 #1）：全部 + 各状态计数
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of tasks.data ?? []) c.set(t.status, (c.get(t.status) ?? 0) + 1);
    return c;
  }, [tasks.data]);
  const filtered = useMemo(
    () => (tasks.data ?? []).filter((t) => statusFilter === "all" || t.status === statusFilter),
    [tasks.data, statusFilter],
  );

  const addTask = useMutation({
    mutationFn: () =>
      api.post(`/api/repos/${repo.id}/tasks`, {
        description,
        dependsOn: deps.length ? deps : undefined,
      }),
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
  const refresh = useMutation({
    mutationFn: () => api.post(`/api/repos/${repo.id}/refresh`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos"] }),
  });

  const list = tasks.data ?? [];
  const total = list.length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {repo.displayName}{" "}
          <code className="ml-1 text-xs font-normal text-muted-foreground">{repo.repoRoot}</code>
        </CardTitle>
        <div className="flex items-center gap-2">
          <div className="w-56">
            <Select
              value={repo.defaultModel ?? "__default"}
              onValueChange={(v) => setRepoModel.mutate(v)}
              disabled={setRepoModel.isPending}
            >
              <SelectTrigger size="sm" className="w-full" title="task 派发使用的默认模型">
                <SelectValue placeholder="repo 默认模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default">默认模型（pi 设置）</SelectItem>
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
          <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            刷新状态
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* slot 池 */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {repo.worktrees.map((w) => (
            <div key={w.path} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  slot {w.slotOrder} · {w.name}
                </span>
                <StatusBadge status={w.status} label={w.status} />
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <code>{w.branch ?? "detached"}</code>
                {w.currentTaskId && (
                  <a href={`#/task/${w.currentTaskId}`} className="rounded border border-amber-500/50 px-1.5 py-px text-amber-400">
                    task #{w.currentTaskId}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 flex-col gap-1.5">
            <Label>新 worktree（建在 repo 同级目录）</Label>
            <Input value={wtName} onChange={(e) => setWtName(e.target.value)} placeholder="feature-x" />
          </div>
          <Button variant="secondary" disabled={!wtName.trim() || addWt.isPending} onClick={() => addWt.mutate()}>
            + worktree
          </Button>
        </div>

        {/* 状态筛选（md 需求 #1） */}
        <div className="flex flex-wrap gap-1.5">
          {[["all", `全部 ${total}`] as const, ...Object.keys(TASK_STATUS_LABEL).map((s) => [s, `${TASK_STATUS_LABEL[s]} ${counts.get(s) ?? 0}`] as const)].map(
            ([key, label]) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  statusFilter === key
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ),
          )}
        </div>

        {/* 任务表 */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-24">状态</TableHead>
              <TableHead>描述</TableHead>
              <TableHead className="w-44">slot / 分支</TableHead>
              <TableHead className="w-20">依赖</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t) => (
              <TableRow key={t.id} className={t.status === "done" || t.status === "cancelled" ? "opacity-55" : ""}>
                <TableCell>{t.seq}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <StatusBadge status={t.status} />
                    {t.rejectCount ? <span className="text-xs text-muted-foreground">×{t.rejectCount}</span> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <a href={`#/task/${t.id}`} className="text-sm hover:text-primary">
                    {t.description.split("\n")[0].slice(0, 80)}
                  </a>
                  {t.error && <p className="mt-0.5 text-xs text-destructive">{t.error}</p>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t.worktreePath ? `${t.worktreePath.split("/").pop()}@${t.branch ?? "?"}` : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {t.deps.length ? t.deps.map((d) => `#${d}`).join(" ") : "—"}
                </TableCell>
                <TableCell>
                  {t.status === "running" && (
                    <Button variant="outline" size="sm" onClick={() => cancel.mutate(t.id)}>
                      取消
                    </Button>
                  )}
                  {t.status === "queued" && (
                    <Button variant="outline" size="sm" onClick={() => cancel.mutate(t.id)}>
                      取消
                    </Button>
                  )}
                  {t.status === "failed" && (
                    <Button variant="outline" size="sm" onClick={() => retry.mutate(t.id)}>
                      重试
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* 添加任务 */}
        <div className="flex flex-col gap-2 border-t pt-3">
          <Textarea
            placeholder="任务描述（一段话）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {list.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {list.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDeps((d) => (d.includes(t.id) ? d.filter((x) => x !== t.id) : [...d, t.id]))}
                  className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    deps.includes(t.id)
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  dep #{t.seq}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button disabled={!description.trim() || addTask.isPending} onClick={() => addTask.mutate()}>
              添加任务
            </Button>
            {addTask.isError && <span className="text-xs text-destructive">{String(addTask.error)}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">注册项目（git repo）</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="flex-1 flex-col gap-1.5">
            <Label>仓库路径（main worktree 或其子目录）</Label>
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/srv/my-project" />
          </div>
          <Button disabled={!path.trim() || register.isPending} onClick={() => register.mutate()}>
            注册
          </Button>
        </CardContent>
        {register.isError && (
          <CardContent className="pt-0">
            <p className="text-sm text-destructive">{String(register.error)}</p>
          </CardContent>
        )}
      </Card>

      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">尚未注册项目。注册后会自动发现 main + 全部 worktree。</p>
      )}
      {shown.map((r) => (
        <RepoPanel key={r.id} repo={r} />
      ))}
    </div>
  );
}
