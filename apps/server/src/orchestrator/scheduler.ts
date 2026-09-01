import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { taskDeps, tasks, worktrees } from "../db/schema.ts";
import { log } from "../util/log.ts";
import { registry } from "../agent/registry.ts";
import { recorder } from "../recorder/event-recorder.ts";
import { currentBranch, headCommit, worktreeIsDirty } from "./git-ops.ts";
import { buildTaskPrompt, watchTaskRun } from "./task-runner.ts";
import { depsOf, getRepoDefaultModel } from "./queries.ts";
import { emitTask, submitForReviewTool } from "./review-tool.ts";

type TaskRow = typeof tasks.$inferSelect;
type WorktreeRow = typeof worktrees.$inferSelect;

const dispatching = new Set<number>();

/**
 * unavailable 状态复查（md/08 §9）：派发时工作区 dirty 的 slot 会被标记 unavailable，
 * 这里重新做脏检查——已干净的恢复为 idle。dispatch 前与 POST /repos/:id/refresh 都会调用。
 */
export async function recheckUnavailableSlots(repoId: number): Promise<number> {
  const rows = db
    .select()
    .from(worktrees)
    .where(and(eq(worktrees.repoId, repoId), eq(worktrees.status, "unavailable")))
    .all();
  let recovered = 0;
  for (const w of rows) {
    try {
      if (!(await worktreeIsDirty(w.path))) {
        db.update(worktrees)
          .set({ status: "idle", updatedAt: Date.now() })
          .where(eq(worktrees.path, w.path))
          .run();
        recovered++;
        log.info(`[scheduler] slot ${w.path} 工作区已干净，恢复 idle`);
      }
    } catch (e) {
      log.warn(`[scheduler] slot ${w.path} 状态复查失败:`, e);
    }
  }
  return recovered;
}

/**
 * 调度器（md/08 §5）：FIFO × 最小空闲 slot。
 * 事件驱动触发：task 创建 / done / cancel / worktree 增删 / boot。
 */
export async function dispatch(repoId: number): Promise<void> {
  if (dispatching.has(repoId)) return;
  dispatching.add(repoId);
  try {
    // 每次派发前复查 unavailable slot（用户要求：派发时重新获取状态）
    await recheckUnavailableSlots(repoId).catch(() => 0);
    const slots = db
      .select()
      .from(worktrees)
      .where(eq(worktrees.repoId, repoId))
      .orderBy(asc(worktrees.slotOrder))
      .all();
    const repoTasks = db
      .select()
      .from(tasks)
      .where(eq(tasks.repoId, repoId))
      .orderBy(asc(tasks.seq))
      .all();
    const statusById = new Map(repoTasks.map((t) => [t.id, t.status]));
    const queued = repoTasks.filter((t) => t.status === "queued");
    if (!queued.length) return;

    const taken = new Set<number>();
    for (const slot of slots) {
      if (slot.status !== "idle") continue;
      const task = queued.find(
        (t) => !taken.has(t.id) && depsOf(t.id).every((d) => statusById.get(d) === "done"),
      );
      if (!task) break; // 无更多就绪任务
      taken.add(task.id);
      await assign(task, slot);
    }
  } finally {
    dispatching.delete(repoId);
  }
}

async function assign(task: TaskRow, slot: WorktreeRow): Promise<boolean> {
  // 派发前 dirty 检查（md/08 §9）
  try {
    if (await worktreeIsDirty(slot.path)) {
      db.update(worktrees)
        .set({ status: "unavailable", updatedAt: Date.now() })
        .where(eq(worktrees.path, slot.path))
        .run();
      log.warn(`[scheduler] slot ${slot.path} 工作区 dirty，标记 unavailable`);
      return false;
    }
  } catch (e) {
    log.error(`[scheduler] slot ${slot.path} 状态检查失败:`, e);
    return false;
  }

  let baseCommit: string;
  let branch: string;
  try {
    baseCommit = await headCommit(slot.path);
    branch = await currentBranch(slot.path);
  } catch (e) {
    log.error(`[scheduler] slot ${slot.path} 读取 git 信息失败:`, e);
    return false;
  }

  const depIds = depsOf(task.id);
  const depSummaries = depIds.length
    ? db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, depIds))
        .all()
        .map((t) => `#${t.id} ${t.summary ?? t.description}`)
    : [];

  // repo 默认模型（md 需求 #3）：未设置时用 pi 全局默认
  const modelSpec = getRepoDefaultModel(task.repoId);
  const entry = await registry.create({
    cwd: slot.path,
    taskId: task.id,
    modelSpec,
    customTools: [submitForReviewTool(task.id)],
  });
  const sessionId = entry.sessionId;

  db.update(tasks)
    .set({
      status: "running",
      worktreePath: slot.path,
      sessionId,
      branch,
      baseCommit,
      dispatchedAt: Date.now(),
      error: null,
    })
    .where(eq(tasks.id, task.id))
    .run();
  db.update(worktrees)
    .set({ status: "busy", updatedAt: Date.now() })
    .where(eq(worktrees.path, slot.path))
    .run();

  watchTaskRun(task.id, entry.session);
  const prompt = buildTaskPrompt({ ...task, worktreePath: slot.path, branch }, depSummaries);
  recorder.beginRun(sessionId, prompt, "task");
  emitTask(task.id, `已派发到 slot ${slot.slotOrder}（${slot.name}）`);

  entry.session
    .prompt(prompt)
    .catch((err) => {
      recorder.failRun(sessionId, err instanceof Error ? err.message : String(err));
      db.update(tasks)
        .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
        .where(eq(tasks.id, task.id))
        .run();
      emitTask(task.id, "run 失败");
    });
  return true;
}
