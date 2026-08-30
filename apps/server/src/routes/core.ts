import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import type { EntryDTO, SessionSummary } from "@rossetta/shared";
import { db } from "../db/index.ts";
import { projects, runs, sessions, steps } from "../db/schema.ts";
import { config } from "../config.ts";
import { checkPassword, issueToken } from "../auth/cookie.ts";
import { registry } from "../agent/registry.ts";
import { recorder } from "../recorder/event-recorder.ts";
import { getModelRuntime } from "../agent/factory.ts";
import { refreshStaleProjects } from "../sync/projects.ts";

function rowToSummary(row: typeof sessions.$inferSelect): SessionSummary {
  return {
    id: row.id,
    name: row.name ?? null,
    cwd: row.cwd,
    filePath: row.filePath,
    provider: row.provider ?? null,
    modelId: row.modelId ?? null,
    thinkingLevel: row.thinkingLevel ?? null,
    status: registry.has(row.id) ? "active" : row.status,
    taskId: row.taskId ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/** 直接读 JSONL（事实源）渲染历史；header 行不入列表（md/02 §5） */
function readEntriesFromFile(filePath: string): EntryDTO[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out: EntryDTO[] = [];
  let seq = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "session") continue;
    const msg = e.type === "message" ? (e.message ?? {}) : {};
    out.push({
      id: e.id,
      sessionId: "",
      parentId: e.parentId ?? null,
      seq: seq++,
      kind: e.type,
      role: msg.role ?? null,
      stopReason: msg.stopReason ?? null,
      toolName: msg.toolName ?? null,
      isError: msg.isError ?? null,
      payload: e,
      timestamp: e.timestamp ? Date.parse(e.timestamp) : null,
    });
  }
  return out;
}

export async function coreRoutes(app: FastifyInstance): Promise<void> {
  // ── auth ──
  app.post("/auth/login", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password || !checkPassword(password)) return reply.code(401).send({ error: "密码错误" });
    reply.setCookie(config.cookieName, issueToken(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
    return { ok: true };
  });

  app.get("/auth/me", async () => ({ ok: true }));

  // ── sessions ──
  app.post("/sessions", async (req, reply) => {
    const body = (req.body ?? {}) as { cwd?: string; name?: string; model?: string };
    if (!body.cwd) return reply.code(400).send({ error: "cwd 必填" });
    try {
      const entry = await registry.create({ cwd: body.cwd, name: body.name, modelSpec: body.model });
      const row = db.select().from(sessions).where(eq(sessions.id, entry.sessionId)).get();
      return row ? rowToSummary(row) : { id: entry.sessionId };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/sessions", async (req) => {
    const { cwd } = req.query as { cwd?: string };
    const rows = db
      .select()
      .from(sessions)
      .where(cwd ? eq(sessions.cwd, cwd) : undefined)
      .orderBy(desc(sessions.updatedAt))
      .limit(200)
      .all();
    return rows.map(rowToSummary);
  });

  app.get("/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row) return reply.code(404).send({ error: "会话不存在" });
    const entry = registry.get(id);
    return { ...rowToSummary(row), streaming: entry?.session.isStreaming ?? false };
  });

  app.get("/sessions/:id/entries", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row) return reply.code(404).send({ error: "会话不存在" });
    return readEntriesFromFile(row.filePath);
  });

  app.post("/sessions/:id/prompt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      text?: string;
      images?: Array<{ mediaType: string; data: string }>;
      streamingBehavior?: "steer" | "followUp";
    };
    if (!body.text) return reply.code(400).send({ error: "text 必填" });
    const entry = await registry.acquire(id);
    if (!entry) return reply.code(404).send({ error: "会话不存在" });

    const runId = recorder.beginRun(id, body.text, "user");
    const opts: Record<string, unknown> = {};
    if (body.images?.length) {
      opts.images = body.images.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, mediaType: img.mediaType, data: img.data },
      }));
    }
    if (entry.session.isStreaming) opts.streamingBehavior = body.streamingBehavior ?? "steer";
    entry.session
      .prompt(body.text, opts as never)
      .catch((err) => recorder.failRun(id, err instanceof Error ? err.message : String(err)));
    return { runId };
  });

  app.post("/sessions/:id/steer", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text } = (req.body ?? {}) as { text?: string };
    if (!text) return reply.code(400).send({ error: "text 必填" });
    const entry = await registry.acquire(id);
    if (!entry) return reply.code(404).send({ error: "会话不存在" });
    await entry.session.steer(text);
    return { ok: true };
  });

  app.post("/sessions/:id/followup", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text } = (req.body ?? {}) as { text?: string };
    if (!text) return reply.code(400).send({ error: "text 必填" });
    const entry = await registry.acquire(id);
    if (!entry) return reply.code(404).send({ error: "会话不存在" });
    recorder.beginRun(id, text, "followUp");
    await entry.session.followUp(text);
    return { ok: true };
  });

  app.post("/sessions/:id/abort", async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = await registry.acquire(id);
    if (!entry) return reply.code(404).send({ error: "会话不存在" });
    await entry.session.abort();
    return { ok: true };
  });

  app.post("/sessions/:id/compact", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { instructions } = (req.body ?? {}) as { instructions?: string };
    const entry = await registry.acquire(id);
    if (!entry) return reply.code(404).send({ error: "会话不存在" });
    const result = await entry.session.compact(instructions);
    return { ok: true, tokensBefore: result.tokensBefore };
  });

  app.patch("/sessions/:id/name", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name) return reply.code(400).send({ error: "name 必填" });
    const entry = await registry.acquire(id);
    if (!entry) return reply.code(404).send({ error: "会话不存在" });
    entry.session.sessionManager.appendSessionInfo(name);
    db.update(sessions).set({ name }).where(eq(sessions.id, id)).run();
    return { ok: true };
  });

  // ── runs / steps ──
  app.get("/sessions/:id/runs", async (req) => {
    const { id } = req.params as { id: string };
    return db.select().from(runs).where(eq(runs.sessionId, id)).orderBy(desc(runs.startedAt)).limit(100).all();
  });

  app.get("/runs/:id/steps", async (req) => {
    const { id } = req.params as { id: string };
    const runId = Number(id);
    return db.select().from(steps).where(eq(steps.runId, runId)).orderBy(steps.id).all();
  });

  // ── models ──
  app.get("/models", async () => {
    const runtime = await getModelRuntime();
    const available = await runtime.getAvailable();
    return available.map((m) => ({ providerId: m.provider, modelId: m.id, displayName: m.name ?? m.id }));
  });

  // ── projects（folder as project）──
  app.get("/projects", async () => {
    await refreshStaleProjects().catch(() => {});
    return db.select().from(projects).orderBy(desc(projects.lastActiveAt)).all();
  });
}
