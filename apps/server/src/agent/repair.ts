import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { log } from "../util/log.ts";

/**
 * 悬空 toolCall 修复（md/03 §2）：
 * 崩溃点落在「assistant(带 toolCall) 已落盘、toolResult 未落盘」之间时，
 * 给未回应的 toolCall 补合成 toolResult，使上下文对 LLM API 合法。
 */
export function repairDanglingToolCalls(sm: SessionManager): number {
  try {
    const entries = sm.buildContextEntries();
    const answered = new Set<string>();
    const messages: Array<Record<string, any>> = [];
    for (const e of entries as any[]) {
      if (e.type === "message") {
        messages.push(e.message);
        if (e.message?.role === "toolResult" && e.message.toolCallId) {
          answered.add(e.message.toolCallId);
        }
      }
    }
    const dangling: Array<{ id: string; name: string }> = [];
    for (const msg of messages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block?.type === "toolCall" && !answered.has(block.id)) {
          dangling.push({ id: block.id, name: block.name });
        }
      }
    }
    for (const call of dangling) {
      sm.appendMessage({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: "[interrupted: server restarted mid-execution]" }],
        isError: true,
        timestamp: Date.now(),
      } as any);
    }
    if (dangling.length) log.warn(`[repair] 补了 ${dangling.length} 条悬空 toolResult`);
    return dangling.length;
  } catch (err) {
    log.error("[repair] 悬空 toolCall 检测失败（忽略）:", err);
    return 0;
  }
}
