import { asc, eq, inArray } from "drizzle-orm";
import type { RepoDTO, TaskDTO, WorktreeDTO } from "@rossetta/shared";
import { db } from "../db/index.ts";
import { repos, taskDeps, tasks, worktrees } from "../db/schema.ts";

type TaskRow = typeof tasks.$inferSelect;

export function getTaskRow(taskId: number): TaskRow | undefined {
  return db.select().from(tasks).where(eq(tasks.id, taskId)).get();
}

export function depsOf(taskId: number): number[] {
  return db.select().from(taskDeps).where(eq(taskDeps.taskId, taskId)).all().map((d) => d.dependsOn);
}

export function taskRowToDTO(row: TaskRow): TaskDTO {
  return {
    id: row.id,
    repoId: row.repoId,
    seq: row.seq,
    description: row.description,
    summary: row.summary ?? null,
    status: row.status,
    worktreePath: row.worktreePath ?? null,
    sessionId: row.sessionId ?? null,
    branch: row.branch ?? null,
    baseCommit: row.baseCommit ?? null,
    endCommit: row.endCommit ?? null,
    rejectCount: row.rejectCount ?? 0,
    error: row.error ?? null,
    deps: depsOf(row.id),
    createdAt: row.createdAt ?? null,
    dispatchedAt: row.dispatchedAt ?? null,
    finishedAt: row.finishedAt ?? null,
  };
}

export function loadTaskDTO(taskId: number): TaskDTO | null {
  const row = getTaskRow(taskId);
  return row ? taskRowToDTO(row) : null;
}

export function listTaskDTOs(repoId: number): TaskDTO[] {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.repoId, repoId))
    .orderBy(asc(tasks.seq))
    .all()
    .map(taskRowToDTO);
}

/** 占用 slot 的任务状态（md/08 §4） */
const SLOT_HOLDING_STATUSES = ["running", "awaiting_review", "finishing"];

export function listReposWithWorktrees(): RepoDTO[] {
  const repoRows = db.select().from(repos).all();
  const holding = db
    .select({ path: tasks.worktreePath, id: tasks.id })
    .from(tasks)
    .where(inArray(tasks.status, SLOT_HOLDING_STATUSES))
    .all();
  const taskByPath = new Map(holding.filter((h) => h.path).map((h) => [h.path!, h.id]));

  return repoRows.map((r) => {
    const wts = db
      .select()
      .from(worktrees)
      .where(eq(worktrees.repoId, r.id))
      .orderBy(asc(worktrees.slotOrder))
      .all();
    return {
      id: r.id,
      repoRoot: r.repoRoot,
      displayName: r.displayName ?? null,
      worktrees: wts.map<WorktreeDTO>((w) => ({
        path: w.path,
        name: w.name,
        isMain: w.isMain,
        branch: w.branch ?? null,
        slotOrder: w.slotOrder,
        status: w.status,
        currentTaskId: taskByPath.get(w.path) ?? null,
      })),
    };
  });
}
