import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildSession } from "../agent/factory.ts";
import { git } from "../util/git.ts";
import { log } from "../util/log.ts";

function sanitize(raw: string): string {
  return raw
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```\s*$/, "")
    .trim()
    .slice(0, 500);
}

/**
 * 验收时由 AI 生成 commit message（不让用户手填）：
 * 输入任务需求 + 执行摘要 + 工作区改动统计，用一次性 in-memory 会话产出。
 */
export async function generateCommitMessage(
  wt: string,
  description: string,
  summary: string | null,
  modelSpec?: string,
): Promise<string> {
  let stat = "";
  let status = "";
  try {
    stat = await git(["diff", "--stat", "HEAD"], wt);
  } catch {
    /* ignore */
  }
  try {
    status = await git(["status", "--porcelain"], wt);
  } catch {
    /* ignore */
  }

  const prompt = [
    "你在为一个 git 提交生成 commit message。只输出 commit message 本身，不要解释、不要代码块标记。",
    "格式：第一行是不超过 72 个字符的概要（中文，说清「做了什么」）；如需补充细节，空一行后写简短要点。",
    "",
    `任务需求：${description}`,
    `执行摘要：${summary ?? "（无）"}`,
    "",
    "工作区改动统计（git diff --stat HEAD）：",
    stat || "（无已跟踪文件改动）",
    "",
    "未跟踪/状态文件（git status --porcelain）：",
    status || "（无）",
  ].join("\n");

  const { session } = await buildSession({
    cwd: wt,
    sessionManager: SessionManager.inMemory(),
    modelSpec,
  });
  try {
    await session.prompt(prompt);
    const messages = session.messages as any[];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role !== "assistant") continue;
      const text = (Array.isArray(m.content) ? m.content : [])
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join("")
        .trim();
      if (text) return sanitize(text);
    }
    // 带 provider 错误详情（如 403），便于排查凭证问题
    const errDetail = (session.agent.state as any).errorMessage;
    throw new Error(errDetail ? `AI 未返回内容: ${String(errDetail).slice(0, 200)}` : "AI 未返回内容");
  } finally {
    try {
      session.dispose();
    } catch {
      /* ignore */
    }
  }
}

/** 带兜底的生成：失败时回退为 #id + 描述首行 */
export async function generateCommitMessageSafe(
  wt: string,
  taskId: number,
  description: string,
  summary: string | null,
  modelSpec?: string,
): Promise<string> {
  try {
    return await generateCommitMessage(wt, description, summary, modelSpec);
  } catch (e) {
    log.warn(`[task] #${taskId} AI 生成 commit message 失败，使用回退:`, e);
    return `#${taskId} ${description.split("\n")[0].slice(0, 60)}`;
  }
}
