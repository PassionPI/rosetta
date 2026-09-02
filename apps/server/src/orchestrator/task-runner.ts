import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { tasks, worktrees } from "../db/schema.ts";
import { log } from "../util/log.ts";
import { registry } from "../agent/registry.ts";
import { recorder } from "../recorder/event-recorder.ts";
import { notify, notifyOnce } from "../notify/notify.ts";
import { wsHub } from "../ws/hub.ts";
import { headCommit, pushCurrent, stageAndCommit, withRepoLock } from "./git-ops.ts";
import { getTaskRow, getRepoDefaultModel } from "./queries.ts";
import { emitTask } from "./review-tool.ts";
import { generateCommitMessageSafe } from "./commit-message.ts";

/** watch：run 结束但未 submit → 保持 running + 通知（md/08 §4） */
export function watchTaskRun(taskId: number, session: AgentSession): void {
  session.subscribe((ev) => {
    if (ev.type !== "agent_end" || ev.willRetry) return;
    // submit_for_review 的 execute 写库先于 agent_end 事件；再等一拍确认
    setTimeout(() => {
      const row = getTaskRow(taskId);
      if (row?.status === "running") {
        emitTask(taskId, "run 已结束但未调用 submit_for_review（可催促/人工标记完成，或继续对话后验收）");
        notifyOnce({
          type: "run_stopped",
          title: `任务 #${taskId} 已停止但未提交验收`,
          detail: "可催促、人工标记完成，或在会话里继续对话",
          taskId,
          repoId: row.repoId,
          sessionId: row.sessionId ?? undefined,
        });
      }
    }, 200);
  });
}

export function buildTaskPrompt(
  task: { description: string; worktreePath?: string | null; branch?: string | null },
  depSummaries: string[],
): string {
  const deps = depSummaries.length
    ? `前置任务均已完成并提交，摘要：\n${depSummaries.map((s) => `- ${s}`).join("\n")}\n`
    : "";
  return [
    `你在 git worktree ${task.worktreePath ?? "?"}（分支 ${task.branch ?? "?"}）中独立完成一个开发任务。`,
    `任务：${task.description}`,
    deps,
    "约束：",
    "- 不要执行 git commit / git push（验收后由系统统一提交推送）",
    "- 完成后调用 submit_for_review 工具提交验收，摘要里说明：做了什么、改了哪些文件、如何验证",
  ].join("\n");
}

/** 催促（06-todo：仅手动按钮） */
export async function nudgeTask(taskId: number): Promise<void> {
  const row = getTaskRow(taskId);
  if (!row?.sessionId) throw new Error("任务没有关联会话");
  const entry = await registry.acquire(row.sessionId);
  if (!entry) throw new Error("会话不可用");
  const text = "请继续完成任务；完成时务必调用 submit_for_review 工具提交验收摘要。";
  if (entry.session.isStreaming) await entry.session.steer(text);
  else await entry.session.prompt(text);
  emitTask(taskId, "已发送催促");
}

export async function rejectTask(taskId: number, feedback: string): Promise<void> {
  const row = getTaskRow(taskId);
  if (!row || row.status !== "awaiting_review" || !row.sessionId) throw new Error("任务不在待验收状态");
  const entry = await registry.acquire(row.sessionId);
  if (!entry) throw new Error("会话不可用");
  db.update(tasks)
    .set({ status: "running", rejectCount: (row.rejectCount ?? 0) + 1 })
    .where(eq(tasks.id, taskId))
    .run();
  recorder.beginRun(row.sessionId, `验收反馈：${feedback}`, "followUp");
  await entry.session.followUp(`验收未通过，请继续修改。反馈：${feedback}`);
  emitTask(taskId, "已返工");
}

/** 人工标记完成：agent 未调 submit_for_review 时手动进入待验收 */
export async function completeTask(taskId: number): Promise<void> {
  const row = getTaskRow(taskId);
  if (!row || row.status !== "running") throw new Error("仅执行中的任务可人工标记完成");
  db.update(tasks)
    .set({ status: "awaiting_review", summary: row.summary ?? "（人工标记完成，待验收）" })
    .where(eq(tasks.id, taskId))
    .run();
  emitTask(taskId, "人工标记完成，待验收");
  notify({
    type: "awaiting_review",
    title: `任务 #${taskId} 待验收（人工标记）`,
    taskId,
    repoId: row.repoId,
    sessionId: row.sessionId ?? undefined,
  });
}

export interface AcceptOptions {
  /** 默认 true：AI 生成 commit message → commit → push；false 仅标记通过，不动工作区 */
  commit?: boolean;
}

/**
 * 验收（md 需求 #3/#5）：
 * - commit 模式：AI 生成 message（进度可见）→ commit → push 当前分支 → done
 * - 仅通过模式：不改工作区直接 done，提示手动处理
 */
export async function acceptTask(taskId: number, opts: AcceptOptions = {}): Promise<void> {
  const doCommit = opts.commit !== false;
  const row = getTaskRow(taskId);
  if (!row || row.status !== "awaiting_review" || !row.worktreePath) throw new Error("任务不在待验收状态");

  db.update(tasks).set({ status: "finishing" }).where(eq(tasks.id, taskId)).run();
  emitTask(taskId, doCommit ? "git 流水线执行中" : "标记通过");
  try {
    const wt = row.worktreePath;

    if (doCommit) {
      wsHub.taskProgress(taskId, "generating_commit_message");
      const modelSpec = getRepoDefaultModel(row.repoId);
      const msg = await generateCommitMessageSafe(wt, taskId, row.description, row.summary, modelSpec);
      log.info(`[task] #${taskId} commit message: ${msg.split("\n")[0]}`);

      wsHub.taskProgress(taskId, "committing", msg.split("\n")[0]);
      await withRepoLock(row.repoId, () => stageAndCommit(wt, msg));
      const endCommit = await headCommit(wt);

      wsHub.taskProgress(taskId, "pushing");
      const pushError = await withRepoLock(row.repoId, () => pushCurrent(wt));
      wsHub.taskProgress(taskId, "done");

      db.update(tasks)
        .set({ status: "done", endCommit, finishedAt: Date.now(), error: pushError })
        .where(eq(tasks.id, taskId))
        .run();
      notify({
        type: "task_done",
        title: `任务 #${taskId} 已完成${pushError ? "（push 警告）" : ""}`,
        detail: pushError ?? `commit: ${msg.split("\n")[0]}`,
        taskId,
        repoId: row.repoId,
        sessionId: row.sessionId ?? undefined,
      });
    } else {
      db.update(tasks)
        .set({ status: "done", finishedAt: Date.now(), error: "仅验收通过（未提交），请手动处理工作区改动" })
        .where(eq(tasks.id, taskId))
        .run();
      notify({
        type: "task_done",
        title: `任务 #${taskId} 已验收通过（未提交）`,
        detail: "工作区改动保留，未 commit/push",
        taskId,
        repoId: row.repoId,
        sessionId: row.sessionId ?? undefined,
      });
    }

    // 释放 slot（仅 busy 时，避免覆盖用户 reserved 占用）
    db.update(worktrees)
      .set({ status: "idle", updatedAt: Date.now() })
      .where(eq(worktrees.path, wt))
      .run();
    emitTask(taskId, "已完成");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error(`[task] #${taskId} git 流水线失败:`, err);
    wsHub.taskProgress(taskId, "failed", err);
    db.update(tasks).set({ status: "failed", error: err }).where(eq(tasks.id, taskId)).run();
    notify({
      type: "task_failed",
      title: `任务 #${taskId} 验收失败`,
      detail: err.slice(0, 300),
      taskId,
      repoId: row.repoId,
      sessionId: row.sessionId ?? undefined,
    });
    emitTask(taskId, `git 流水线失败：${err}`);
    throw e;
  } finally {
    const { dispatch } = await import("./scheduler.ts");
    dispatch(row.repoId).catch((err) => log.error("[scheduler] dispatch 失败:", err));
  }
}
