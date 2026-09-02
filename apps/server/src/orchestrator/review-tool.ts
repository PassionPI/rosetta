import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { tasks } from "../db/schema.ts";
import { wsHub } from "../ws/hub.ts";
import { notify } from "../notify/notify.ts";
import { loadTaskDTO, getTaskRow } from "./queries.ts";

export function emitTask(taskId: number, note?: string): void {
  const dto = loadTaskDTO(taskId);
  if (dto) wsHub.taskUpdate(dto, note);
}

/**
 * 任务完成信号工具（md/08 §6）。
 * 独立模块：registry.acquire 重建 task 会话时也要挂载（否则 idle dispose / 重启后工具消失），
 * 且允许在 awaiting_review 状态重复调用——更新验收摘要。
 */
export function submitForReviewTool(taskId: number): ToolDefinition {
  return defineTool({
    name: "submit_for_review",
    label: "提交验收",
    description:
      "任务完成（或完成度有更新）时调用。summary 说明：做了什么、改了哪些文件、如何验证。可多次调用，后一次覆盖前一次。",
    parameters: Type.Object({
      summary: Type.String({ description: "完成摘要（做了什么/改了哪些文件/如何验证）" }),
    }),
    execute: async (_toolCallId, params) => {
      markAwaitingReview(taskId, params.summary);
      return {
        content: [{ type: "text", text: "已更新验收摘要，等待用户确认后由系统统一 commit/push。" }],
        details: {},
      };
    },
  }) as ToolDefinition;
}

function markAwaitingReview(taskId: number, summary: string): void {
  const row = getTaskRow(taskId);
  if (!row) return;
  // running → awaiting_review 首次提交；awaiting_review → 更新摘要（重复调用）
  if (row.status !== "running" && row.status !== "awaiting_review") return;
  db.update(tasks).set({ status: "awaiting_review", summary }).where(eq(tasks.id, taskId)).run();
  const first = row.status === "running";
  emitTask(taskId, first ? "已提交验收" : "已更新验收摘要");
  if (first) {
    notify({
      type: "awaiting_review",
      title: `任务 #${taskId} 待验收`,
      detail: summary.slice(0, 200),
      taskId,
      repoId: row.repoId,
      sessionId: row.sessionId ?? undefined,
    });
  }
}
