import path from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import { taskDeps, tasks, worktrees } from "../db/schema.ts";
import { log } from "../util/log.ts";
import { realpath } from "../util/git.ts";
import { registry } from "../agent/registry.ts";
import { recorder } from "../recorder/event-recorder.ts";
import { notify, notifyOnce } from "../notify/notify.ts";
import { currentBranch, headCommit, worktreeIsDirty } from "./git-ops.ts";
import { buildTaskPrompt, watchTaskRun } from "./task-runner.ts";
import { depsOf, getRepoDefaultModel, getTaskRow } from "./queries.ts";
import { emitTask, submitForReviewTool } from "./review-tool.ts";

type TaskRow = typeof tasks.$inferSelect;
type WorktreeRow = typeof worktrees.$inferSelect;

const dispatching = new Set<number>();

/**
 * unavailable 状态复查：派发时工作区 dirty 的 slot 会被标记 unavailable，
 * 这里重新做脏检查——已干净的恢复为 idle。dispatch 前与 refresh 接口都会调用。
 * reserved（用户手动占用）不受影响。
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
 * 调度器（md/08 §5 + 需求 #6/#7）：FIFO × 最小空闲 slot。
 * - reserved（用户占用）/ busy / unavailable 的 slot 跳过
 * - clean 优先：dirty 的 idle slot 标 unavailable 并跳过
 * - 无 clean 可用时阻塞并发 dispatch_blocked 通知（任务页可强制派发）
 */
export async function dispatch(repoId: number): Promise<void> {
  if (dispatching.has(repoId)) return;
  dispatching.add(repoId);
  try {
    await recheckUnavailableSlots(repoId).catch(() => 0);

    const slots = db
      .select()
      .from(worktrees)
      .where(eq(worktrees.repoId, repoId))
      .orderBy(asc(worktrees.slotOrder))
      .all();
    const idle = slots.filter((s) => s.status === "idle");

    // 并行脏检查（md 需求 #7：clean 优先，dirty 提示）
    const checked = await Promise.all(
      idle.map(async (s) => ({
        s,
        dirty: await worktreeIsDirty(s.path).catch(() => true),
      })),
    );
    const clean = checked.filter((c) => !c.dirty).map((c) => c.s);
    const dirty = checked.filter((c) => c.dirty);
    for (const c of dirty) {
      db.update(worktrees)
        .set({ status: "unavailable", updatedAt: Date.now() })
        .where(eq(worktrees.path, c.s.path))
        .run();
    }

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
    let assignedCount = 0;
    for (const slot of clean) {
      const task = queued.find(
        (t) => !taken.has(t.id) && depsOf(t.id).every((d) => statusById.get(d) === "done"),
      );
      if (!task) break;
      taken.add(task.id);
      if (await assign(task, slot)) assignedCount++;
    }

    // 派发提示：还有就绪任务没派出去且存在 dirty slot
    const remaining = queued.filter((t) => !taken.has(t.id));
    if (remaining.length && dirty.length) {
      const dirtyNames = dirty.map((d) => path.basename(d.s.path)).join("、");
      if (clean.length === 0) {
        const t = remaining[0]!;
        notifyOnce({
          type: "dispatch_blocked",
          title: `任务 #${t.id} 派发受阻：空闲 worktree 均有未提交改动`,
          detail: `涉及 ${dirtyNames}。可在任务页强制派发到指定 worktree，或清理后自动恢复。`,
          taskId: t.id,
          repoId,
        });
      } else if (assignedCount > 0) {
        notify({
          type: "dispatch_skipped",
          title: "派发时跳过了有未提交改动的 worktree",
          detail: `跳过：${dirtyNames}（已标记 unavailable，清理后自动恢复）`,
          repoId,
        });
      }
    }
  } finally {
    dispatching.delete(repoId);
  }
}

/** 强制派发（md 需求 #7）：忽略 dirty，指定 worktree 执行任务 */
export async function forceAssignToWorktree(taskId: number, worktreePath: string): Promise<void> {
  const task = getTaskRow(taskId);
  if (!task || task.status !== "queued") throw new Error("仅排队中的任务可强制派发");
  const p = realpath(worktreePath);
  const wt = db.select().from(worktrees).where(eq(worktrees.path, p)).get();
  if (!wt || wt.repoId !== task.repoId) throw new Error("worktree 不属于该任务所在 repo");
  if (wt.status === "busy") throw new Error("该 worktree 正在执行其他任务");
  const ok = await assign(task, wt);
  if (!ok) throw new Error("派发失败（会话创建异常，见 server 日志）");
}

async function assign(task: TaskRow, slot: WorktreeRow): Promise<boolean> {
  let baseCommit: string;
  let branch: string;
  try {
    baseCommit = await headCommit(slot.path);
    branch = await currentBranch(slot.path);
  } catch (e) {
    log.error(`[scheduler] slot ${slot.path} 读取 git 信息失败:`, e);
    return false;
  }

  try {
    const depIds = depsOf(task.id);
    const depSummaries = depIds.length
      ? db
          .select()
          .from(tasks)
          .where(inArray(tasks.id, depIds))
          .all()
          .map((t) => `#${t.id} ${t.summary ?? t.description}`)
      : [];

    // repo 默认模型：未设置时用 pi 全局默认
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
  } catch (e) {
    log.error(`[scheduler] 任务 #${task.id} 派发失败:`, e);
    return false;
  }
}
