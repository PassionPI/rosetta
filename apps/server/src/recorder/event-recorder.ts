import { eq, and } from "drizzle-orm";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { db } from "../db/index.ts";
import { events, runs, sessionEntries, sessions, steps } from "../db/schema.ts";
import { writeQueue } from "./write-queue.ts";
import { wsHub } from "../ws/hub.ts";

interface RunCtx {
  runId: number;
  input: number;
  output: number;
  cacheRead: number;
  costMicros: number;
  turns: number;
}

/**
 * 事件 → DB 映射（md/01 事件备忘）。
 * delta 类不落库；聚合点写入：entry_appended / tool_execution_* / turn_end / agent_end。
 */
class EventRecorder {
  /** sessionId → 活跃 run 上下文 */
  private runCtx = new Map<string, RunCtx>();
  private openSteps = new Map<string, number>(); // `${runId}:${callId}` → startedAt(ms)
  private nextSeq = new Map<string, number>();

  beginRun(sessionId: string, prompt: string, trigger: string): number {
    const res = db
      .insert(runs)
      .values({ sessionId, prompt, trigger, status: "running", startedAt: Date.now() })
      .run();
    const runId = Number(res.lastInsertRowid);
    this.runCtx.set(sessionId, { runId, input: 0, output: 0, cacheRead: 0, costMicros: 0, turns: 0 });
    wsHub.runStatus(sessionId, runId, "running");
    return runId;
  }

  failRun(sessionId: string, error: string): void {
    const ctx = this.runCtx.get(sessionId);
    if (!ctx) return;
    this.runCtx.delete(sessionId);
    db.update(runs)
      .set({ status: "error", error: error.slice(0, 2000), endedAt: Date.now() })
      .where(eq(runs.id, ctx.runId))
      .run();
    wsHub.runStatus(sessionId, ctx.runId, "error", error);
  }

  record(sessionId: string, ev: AgentSessionEvent): void {
    try {
      switch (ev.type) {
        case "entry_appended": {
          const entry = ev.entry as any;
          const msg = entry.type === "message" ? (entry.message ?? {}) : {};
          const seq = this.takeSeq(sessionId);
          writeQueue.push(() => {
            db.insert(sessionEntries)
              .values({
                id: entry.id,
                sessionId,
                parentId: entry.parentId ?? null,
                seq,
                kind: entry.type,
                role: msg.role ?? null,
                stopReason: msg.stopReason ?? null,
                toolName: msg.toolName ?? null,
                isError: msg.isError ?? null,
                payload: entry,
                timestamp: entry.timestamp ? Date.parse(entry.timestamp) : null,
              })
              .onConflictDoNothing()
              .run();
            db.update(sessions).set({ updatedAt: Date.now(), entryCount: seq + 1 }).where(eq(sessions.id, sessionId)).run();
          });
          break;
        }
        case "tool_execution_start": {
          const ctx = this.runCtx.get(sessionId);
          if (!ctx) break;
          const key = `${ctx.runId}:${ev.toolCallId}`;
          const startedAt = Date.now();
          this.openSteps.set(key, startedAt);
          writeQueue.push(() => {
            db.insert(steps)
              .values({
                runId: ctx.runId,
                sessionId,
                callId: ev.toolCallId,
                toolName: ev.toolName,
                arguments: ev.args ?? null,
                startedAt,
              })
              .run();
          });
          break;
        }
        case "tool_execution_end": {
          const ctx = this.runCtx.get(sessionId);
          if (!ctx) break;
          const key = `${ctx.runId}:${ev.toolCallId}`;
          const startedAt = this.openSteps.get(key);
          this.openSteps.delete(key);
          const result = ev.result as any;
          writeQueue.push(() => {
            db.update(steps)
              .set({
                result: result ?? null,
                patch: result?.details?.patch ?? null,
                isError: ev.isError,
                durationMs: startedAt ? Date.now() - startedAt : null,
                endedAt: Date.now(),
              })
              .where(and(eq(steps.runId, ctx.runId), eq(steps.callId, ev.toolCallId)))
              .run();
          });
          break;
        }
        case "turn_end": {
          const ctx = this.runCtx.get(sessionId);
          const msg = ev.message as any;
          if (!ctx) break;
          ctx.turns++;
          if (msg?.usage) this.accumUsage(ctx, msg.usage);
          break;
        }
        case "agent_end": {
          this.finishRun(sessionId);
          break;
        }
        case "compaction_end":
        case "auto_retry_end": {
          const ctx = this.runCtx.get(sessionId);
          writeQueue.push(() => {
            db.insert(events)
              .values({ sessionId, runId: ctx?.runId ?? null, type: ev.type, payload: ev as any, ts: Date.now() })
              .run();
          });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error("[recorder] 事件处理失败:", ev.type, err);
    }
  }

  private finishRun(sessionId: string): void {
    const ctx = this.runCtx.get(sessionId);
    if (!ctx) return;
    this.runCtx.delete(sessionId);
    writeQueue.push(() => {
      db.update(runs)
        .set({
          status: "completed",
          endedAt: Date.now(),
          inputTokens: ctx.input,
          outputTokens: ctx.output,
          cacheReadTokens: ctx.cacheRead,
          costUsdMicros: ctx.costMicros,
          turnCount: ctx.turns,
        })
        .where(eq(runs.id, ctx.runId))
        .run();
    });
    writeQueue.flush();
    wsHub.runStatus(sessionId, ctx.runId, "completed");
  }

  private accumUsage(ctx: RunCtx, usage: any): void {
    ctx.input += usage.input ?? 0;
    ctx.output += usage.output ?? 0;
    ctx.cacheRead += usage.cacheRead ?? 0;
    ctx.costMicros += Math.round((usage.cost?.total ?? 0) * 1e6);
  }

  private takeSeq(sessionId: string): number {
    let n = this.nextSeq.get(sessionId);
    if (n === undefined) {
      const rows = db.select({ seq: sessionEntries.seq }).from(sessionEntries).where(eq(sessionEntries.sessionId, sessionId)).all();
      n = rows.reduce((m, r) => Math.max(m, r.seq), -1) + 1;
    }
    this.nextSeq.set(sessionId, n + 1);
    return n;
  }
}

export const recorder = new EventRecorder();
