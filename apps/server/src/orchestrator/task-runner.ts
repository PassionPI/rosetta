import { Type } from "typebox";
import { defineTool, type AgentSession, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { tasks, worktrees } from "../db/schema.ts";
import { log } from "../util/log.ts";
import { registry } from "../agent/registry.ts";
import { recorder } from "../recorder/event-recorder.ts";
import { wsHub } from "../ws/hub.ts";
import { commitAndPush, withRepoLock } from "./git-ops.ts";
import { getTaskRow, loadTaskDTO } from "./queries.ts";

/**
 * 完成信号工具（md/08 §6，06-todo 已确认）：
 * agent 调用 submit_for_review 才进入待验收；run 结束未调用则保持 running。
 */
export function submitForReviewTool(taskId: number): ToolDefinition {
  return defineTool({
    name: "submit_for_review",
    label: "提交验收",
    description: "任务完成时调用。summary 需说明：做了什么、改了哪些文件、如何验证。",
    parameters: Type.Object({
      summary: Type.String({ description: "完成摘要（做了什么/改了哪些文件/如何验证）" }),
    }),
    execute: async (_toolCallId, params) => {
      markAwaitingReview(taskId, params.summary);
      return { content: [{ type: "text", text: "已提交验收，等待用户确认后由系统统一 commit/push。" }], details: {} };
    },
  }) as ToolDefinition;
}

export function emitTask(taskId: number, note?: string): void {
  const dto = loadTaskDTO(taskId);
  if (dto) wsHub.taskUpdate(dto, note);
}

function markAwaitingReview(taskId: number, summary: string): void {
  const row = getTaskRow(taskId);
  if (!row || row.status !== "running") return;
  db.update(tasks).set({ status: "awaiting_review", summary }).where(eq(tasks.id, taskId)).run();
  emitTask(taskId, "task 已提交验收");
}

/** watch：run 结束但未 submit → 保持 running + 提示（md/08 §4） */
export function watchTaskRun(taskId: number, session: AgentSession): void {
  session.subscribe((ev) => {
    if (ev.type !== "agent_end" || ev.willRetry) return;
    // submit_for_review 的 execute 写库先于 agent_end 事件；再等一拍确认，
    // 避免「已提交验收」被误报为「未提交」
    setTimeout(() => {
      const row = getTaskRow(taskId);
      if (row?.status === "running") {
        emitTask(taskId, "run 已结束但未调用 submit_for_review（可催促，或在会话里继续补充后验收）");
      }
    }, 200);
  });
}

export function buildTaskPrompt(task: { description: string; worktreePath?: string | null; branch?: string | null }, depSummaries: string[]): string {
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

/** 验收：git 流水线（md/08 §7）→ done → 释放 slot → dispatch */
export async function acceptTask(taskId: number, commitMessage?: string): Promise<void> {
  const row = getTaskRow(taskId);
  if (!row || row.status !== "awaiting_review" || !row.worktreePath) throw new Error("任务不在待验收状态");
  const msg =
    commitMessage?.trim() ||
    `#${taskId} ${row.description.split("\n")[0].slice(0, 72)}`;

  db.update(tasks).set({ status: "finishing" }).where(eq(tasks.id, taskId)).run();
  emitTask(taskId, "git 流水线执行中");
  try {
    const wt = row.worktreePath;
    const { endCommit, pushError } = await withRepoLock(row.repoId, () => commitAndPush(wt, msg));
    db.update(tasks)
      .set({ status: "done", endCommit, finishedAt: Date.now(), error: pushError })
      .where(eq(tasks.id, taskId))
      .run();
    db.update(worktrees).set({ status: "idle", updatedAt: Date.now() }).where(eq(worktrees.path, wt)).run();
    emitTask(taskId, pushError ? `完成（警告：${pushError}）` : "已完成并推送");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log.error(`[task] #${taskId} git 流水线失败:`, err);
    db.update(tasks).set({ status: "failed", error: err }).where(eq(tasks.id, taskId)).run();
    emitTask(taskId, `git 流水线失败：${err}`);
    throw e;
  } finally {
    const { dispatch } = await import("./scheduler.ts"); // 运行时引入避免循环依赖
    dispatch(row.repoId).catch((err) => log.error("[scheduler] dispatch 失败:", err));
  }
}
