import type { TaskDTO } from "@rosetta/shared";
import { fx } from "./client.ts";

export interface CreateTaskInput {
  description: string;
  dependsOn?: number[];
}

export interface OkOutput {
  ok: boolean;
}

export const listTasks = (repoId: number) =>
  fx<TaskDTO[]>({ url: `/api/repos/${repoId}/tasks` });

export const createTask = (repoId: number, input: CreateTaskInput) =>
  fx<TaskDTO>({
    url: `/api/repos/${repoId}/tasks`,
    method: "POST",
    body: input,
  });

export const getTask = (taskId: number) =>
  fx<TaskDTO>({ url: `/api/tasks/${taskId}` });

/** 验收：commit=true（默认）AI 生成 message + commit + push；false 仅标记通过 */
export const acceptTask = (taskId: number, input?: { commit?: boolean }) =>
  fx<OkOutput>({ url: `/api/tasks/${taskId}/accept`, method: "POST", body: input ?? {} });

/** 强制派发到指定 worktree（忽略未提交改动） */
export const dispatchTask = (taskId: number, input: { worktreePath: string }) =>
  fx<OkOutput>({ url: `/api/tasks/${taskId}/dispatch`, method: "POST", body: input });

export const rejectTask = (taskId: number, input: { feedback: string }) =>
  fx<OkOutput>({
    url: `/api/tasks/${taskId}/reject`,
    method: "POST",
    body: input,
  });

export const nudgeTask = (taskId: number) =>
  fx<OkOutput>({ url: `/api/tasks/${taskId}/nudge`, method: "POST" });

export const completeTask = (taskId: number) =>
  fx<OkOutput>({ url: `/api/tasks/${taskId}/complete`, method: "POST" });

export const cancelTask = (taskId: number) =>
  fx<OkOutput>({ url: `/api/tasks/${taskId}/cancel`, method: "POST" });

export const retryTask = (taskId: number) =>
  fx<OkOutput>({ url: `/api/tasks/${taskId}/retry`, method: "POST" });
