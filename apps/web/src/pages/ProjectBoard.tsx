import { listModels } from "@/api/projects.ts";
import {
  addWorktree,
  listRepos,
  refreshRepo,
  registerRepo,
  setRepoModel,
} from "@/api/repos.ts";
import { cancelTask, createTask, listTasks, retryTask } from "@/api/tasks.ts";
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
import { defineActionHandler, useAction } from "@/hooks/useAction";
import type { RepoDTO, TaskDTO } from "@rosetta/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

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
    <span
      className={`rounded border px-1.5 py-px text-[11px] ${statusClass(status)}`}
    >
      {label ?? TASK_STATUS_LABEL[status] ?? status}
    </span>
  );
}

interface PanelState {
  description: string;
  deps: number[];
  wtName: string;
  statusFilter: string;
}

/** 按业务语义设计 action：resetTaskForm 一次清空描述与依赖 */
interface PanelActions {
  editDescription: string;
  toggleDep: number;
  editWtName: string;
  filterStatus: string;
  resetTaskForm: null;
  wtAdded: null;
}

function RepoPanel({ repo }: { repo: RepoDTO }) {
  const queryClient = useQueryClient();

  const [state, actions] = useAction(
    (): PanelState => ({
      description: "",
      deps: [],
      wtName: "",
      statusFilter: "all",
    }),
    defineActionHandler<PanelState, PanelActions>({
      editDescription: (s, v) => {
        s.description = v;
      },
      toggleDep: (s, id) => {
        s.deps = s.deps.includes(id)
          ? s.deps.filter((x) => x !== id)
          : [...s.deps, id];
      },
      editWtName: (s, v) => {
        s.wtName = v;
      },
      filterStatus: (s, v) => {
        s.statusFilter = v;
      },
      resetTaskForm: (s) => {
        s.description = "";
        s.deps = [];
      },
      wtAdded: (s) => {
        s.wtName = "";
      },
    }),
  );

  const tasks = useQuery({
    queryKey: ["tasks", repo.id],
    queryFn: () => listTasks(repo.id).unwrap(),
  });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => listModels().unwrap(),
    staleTime: 60_000,
  });

  const addTask = useMutation({
    mutationFn: () =>
      createTask(repo.id, {
        description: state.description,
        dependsOn: state.deps.length ? state.deps : undefined,
      }).unwrap(),
    onSuccess: () => {
      actions.resetTaskForm();
      void queryClient.invalidateQueries({ queryKey: ["tasks", repo.id] });
    },
  });
  const addWt = useMutation({
    mutationFn: () => addWorktree(repo.id, { name: state.wtName }).unwrap(),
    onSuccess: () => {
      actions.wtAdded();
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
  const cancel = useMutation({
    mutationFn: (id: number) => cancelTask(id).unwrap(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["tasks", repo.id] }),
  });
  const retry = useMutation({
    mutationFn: (id: number) => retryTask(id).unwrap(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["tasks", repo.id] }),
  });
  const refresh = useMutation({
    mutationFn: () => refreshRepo(repo.id).unwrap(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos"] }),
  });
  const setRepoModelMut = useMutation({
    mutationFn: (m: string) =>
      setRepoModel(repo.id, { model: m === "__default" ? "" : m }).unwrap(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos"] }),
  });

  // 状态筛选：全部 + 各状态计数
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of tasks.data ?? [])
      c.set(t.status, (c.get(t.status) ?? 0) + 1);
    return c;
  }, [tasks.data]);
  const filtered = useMemo(
    () =>
      (tasks.data ?? []).filter(
        (t) => state.statusFilter === "all" || t.status === state.statusFilter,
      ),
    [tasks.data, state.statusFilter],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {repo.displayName}
          <code className="ml-1 text-xs font-normal text-muted-foreground">
            {repo.repoRoot}
          </code>
        </CardTitle>
        <div className="flex items-center gap-2">
          <div className="w-56">
            <Select
              value={repo.defaultModel ?? "__default"}
              onValueChange={(v) => setRepoModelMut.mutate(v)}
              disabled={setRepoModelMut.isPending}
            >
              <SelectTrigger
                size="sm"
                className="w-full"
                title="task 派发使用的默认模型"
              >
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
          <Button
            variant="outline"
            size="sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
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
                  <Link
                    to="/task/$taskId"
                    params={{ taskId: String(w.currentTaskId) }}
                    className="rounded border border-amber-500/50 px-1.5 py-px text-amber-400"
                  >
                    task #{w.currentTaskId}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1 flex-col gap-1.5">
            <Label>新 worktree（建在 repo 同级目录）</Label>
            <Input
              value={state.wtName}
              onChange={(e) => actions.editWtName(e.target.value)}
              placeholder="feature-x"
            />
          </div>
          <Button
            variant="secondary"
            disabled={!state.wtName.trim() || addWt.isPending}
            onClick={() => addWt.mutate()}
          >
            + worktree
          </Button>
        </div>

        {/* 状态筛选 */}
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", `全部 ${tasks.data?.length ?? 0}`],
              ...Object.keys(TASK_STATUS_LABEL).map(
                (s) =>
                  [s, `${TASK_STATUS_LABEL[s]} ${counts.get(s) ?? 0}`] as const,
              ),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => actions.filterStatus(key)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                state.statusFilter === key
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
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
            {filtered.map((t: TaskDTO) => (
              <TableRow
                key={t.id}
                className={
                  t.status === "done" || t.status === "cancelled"
                    ? "opacity-55"
                    : ""
                }
              >
                <TableCell>{t.seq}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <StatusBadge status={t.status} />
                    {t.rejectCount ? (
                      <span className="text-xs text-muted-foreground">
                        ×{t.rejectCount}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Link
                    to="/task/$taskId"
                    params={{ taskId: String(t.id) }}
                    className="text-sm hover:text-primary"
                  >
                    {t.description.split("\n")[0].slice(0, 80)}
                  </Link>
                  {t.error && (
                    <p className="mt-0.5 text-xs text-destructive">{t.error}</p>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t.worktreePath
                    ? `${t.worktreePath.split("/").pop()}@${t.branch ?? "?"}`
                    : "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {t.deps.length ? t.deps.map((d) => `#${d}`).join(" ") : "—"}
                </TableCell>
                <TableCell>
                  {(t.status === "running" || t.status === "queued") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cancel.mutate(t.id)}
                    >
                      取消
                    </Button>
                  )}
                  {t.status === "failed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => retry.mutate(t.id)}
                    >
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
            value={state.description}
            onChange={(e) => actions.editDescription(e.target.value)}
          />
          {(tasks.data ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(tasks.data ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => actions.toggleDep(t.id)}
                  className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    state.deps.includes(t.id)
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
            <Button
              disabled={!state.description.trim() || addTask.isPending}
              onClick={() => addTask.mutate()}
            >
              添加任务
            </Button>
            {addTask.isError && (
              <span className="text-xs text-destructive">
                {String(addTask.error)}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface BoardState {
  path: string;
}

interface BoardActions {
  editPath: string;
  registered: null;
}

export default function ProjectBoard({ repoId }: { repoId?: number }) {
  const queryClient = useQueryClient();

  const [state, actions] = useAction(
    (): BoardState => ({ path: "" }),
    defineActionHandler<BoardState, BoardActions>({
      editPath: (s, v) => {
        s.path = v;
      },
      registered: (s) => {
        s.path = "";
      },
    }),
  );

  const repos = useQuery({
    queryKey: ["repos"],
    queryFn: () => listRepos().unwrap(),
  });
  const register = useMutation({
    mutationFn: () => registerRepo({ path: state.path }).unwrap(),
    onSuccess: () => {
      actions.registered();
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
            <Input
              value={state.path}
              onChange={(e) => actions.editPath(e.target.value)}
              placeholder="/srv/my-project"
            />
          </div>
          <Button
            disabled={!state.path.trim() || register.isPending}
            onClick={() => register.mutate()}
          >
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
        <p className="text-sm text-muted-foreground">
          尚未注册项目。注册后会自动发现 main + 全部 worktree。
        </p>
      )}
      {shown.map((r) => (
        <RepoPanel key={r.id} repo={r} />
      ))}
    </div>
  );
}
