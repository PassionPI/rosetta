import { and, eq, inArray } from "drizzle-orm";
import { SessionManager, type AgentSession, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { db } from "../db/index.ts";
import { sessions, tasks } from "../db/schema.ts";
import { config } from "../config.ts";
import { realpath } from "../util/git.ts";
import { log } from "../util/log.ts";
import { recorder } from "../recorder/event-recorder.ts";
import { wsHub } from "../ws/hub.ts";
import { writeQueue } from "../recorder/write-queue.ts";
import { upsertProject } from "../sync/projects.ts";
import { buildSession } from "./factory.ts";
import { repairDanglingToolCalls } from "./repair.ts";
import { submitForReviewTool } from "../orchestrator/review-tool.ts";

export interface RegistryEntry {
  sessionId: string;
  session: AgentSession;
  unsub: () => void;
  lastActive: number;
}

export interface CreateSessionOptions {
  cwd: string;
  name?: string;
  modelSpec?: string;
  taskId?: number;
  customTools?: ToolDefinition[];
}

/**
 * 活跃会话注册表（md/01 §2）：懒加载 + 空闲 dispose。
 * EventBridge 职责并入 attach()：事件扇出到 WS + Recorder。
 */
class Registry {
  private entries = new Map<string, RegistryEntry>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  startSweeper(): void {
    this.sweeper ??= setInterval(() => this.sweepIdle(), 60_000);
  }

  get(sessionId: string): RegistryEntry | null {
    const e = this.entries.get(sessionId);
    if (e) e.lastActive = Date.now();
    return e ?? null;
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  async create(opts: CreateSessionOptions): Promise<RegistryEntry> {
    const cwd = realpath(opts.cwd);
    const sm = SessionManager.create(cwd);
    const { session, modelFallbackMessage } = await buildSession({
      cwd,
      modelSpec: opts.modelSpec,
      customTools: opts.customTools,
      sessionManager: sm,
    });
    if (modelFallbackMessage) log.warn(`[registry] ${modelFallbackMessage}`);

    if (opts.name) sm.appendSessionInfo(opts.name);

    const model = session.model;
    const now = Date.now();
    db.insert(sessions)
      .values({
        id: session.sessionId,
        filePath: sm.getSessionFile() ?? "",
        name: opts.name ?? null,
        cwd,
        provider: model?.provider ?? null,
        modelId: model?.id ?? null,
        thinkingLevel: String(session.thinkingLevel ?? ""),
        taskId: opts.taskId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
    await upsertProject(cwd).catch(() => {});
    return this.attach(session.sessionId, session);
  }

  /** 懒加载恢复（md/03 §5）：open + 悬空修复 + 重新订阅 */
  async acquire(sessionId: string): Promise<RegistryEntry | null> {
    const hit = this.get(sessionId);
    if (hit) return hit;

    const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!row) return null;

    const sm = SessionManager.open(row.filePath);
    repairDanglingToolCalls(sm);
    // task 会话重建时必须补挂 submit_for_review（否则 idle dispose / 重启后工具消失）
    const activeTask = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.sessionId, sessionId), inArray(tasks.status, ["running", "awaiting_review"])))
      .get();
    const { session, modelFallbackMessage } = await buildSession({
      cwd: row.cwd,
      sessionManager: sm,
      customTools: activeTask ? [submitForReviewTool(activeTask.id)] : undefined,
    });
    if (modelFallbackMessage) log.warn(`[registry] ${modelFallbackMessage}`);

    db.update(sessions)
      .set({ name: session.sessionName ?? row.name, updatedAt: Date.now() })
      .where(eq(sessions.id, sessionId))
      .run();
    return this.attach(sessionId, session);
  }

  private attach(sessionId: string, session: AgentSession): RegistryEntry {
    const unsub = session.subscribe((ev) => {
      wsHub.publishEvent(sessionId, ev);
      recorder.record(sessionId, ev);
    });
    const entry: RegistryEntry = { sessionId, session, unsub, lastActive: Date.now() };
    this.entries.set(sessionId, entry);
    return entry;
  }

  private sweepIdle(): void {
    const now = Date.now();
    for (const [id, e] of this.entries) {
      if (now - e.lastActive < config.idleDisposeMs) continue;
      if (e.session.isStreaming || e.session.isCompacting) continue;
      try {
        e.unsub();
        e.session.dispose();
        this.entries.delete(id);
        log.info(`[registry] 空闲 dispose: ${id}`);
      } catch (err) {
        log.error(`[registry] dispose 失败: ${id}`, err);
      }
    }
  }

  /** 优雅停机（md/03 §3） */
  async shutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const [, e] of this.entries) {
      try {
        if (e.session.isStreaming) await e.session.abort();
        await e.session.waitForIdle();
      } catch {
        /* 超时/异常不阻塞其余会话停机 */
      }
      try {
        e.unsub();
        e.session.dispose();
      } catch {
        /* ignore */
      }
    }
    this.entries.clear();
    writeQueue.flush();
  }
}

export const registry = new Registry();
