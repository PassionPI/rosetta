import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { repos, taskDeps, tasks, worktrees } from "../db/schema.ts";
import { log } from "../util/log.ts";
import { registry } from "../agent/registry.ts";
import { addWorktree, refreshWorktrees, registerRepo } from "../orchestrator/repo-service.ts";
import { listReposWithWorktrees, listTaskDTOs, loadTaskDTO } from "../orchestrator/queries.ts";
import { acceptTask, completeTask, nudgeTask, rejectTask } from "../orchestrator/task-runner.ts";
import { emitTask } from "../orchestrator/review-tool.ts";
import { dispatch, forceAssignToWorktree, recheckUnavailableSlots } from "../orchestrator/scheduler.ts";
import { realpath } from "../util/git.ts";

export async function orchestratorRoutes(app: FastifyInstance): Promise<void> {
  // ── repos / worktree 池 ──
  app.post("/repos", async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: "path 必填" });
    try {
      const repoId = await registerRepo(path);
      return { id: repoId };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/repos", async () => listReposWithWorktrees());

  app.get("/repos/:id/worktrees", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dto = listReposWithWorktrees().find((r) => r.id === Number(id));
    if (!dto) return reply.code(404).send({ error: "repo 不存在" });
    return dto.worktrees;
  });

  app.post("/repos/:id/worktrees", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name, base } = (req.body ?? {}) as { name?: string; base?: string };
    if (!name) return reply.code(400).send({ error: "name 必填" });
    const repo = db.select().from(repos).where(eq(repos.id, Number(id))).get();
    if (!repo) return reply.code(404).send({ error: "repo 不存在" });
    try {
      const target = await addWorktree(repo.id, repo.repoRoot, name, base);
      await dispatch(repo.id).catch(() => {});
      return { path: target };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** worktree 状态刷新（发现新 worktree + unavailable 复查恢复） */
  app.post("/repos/:id/refresh", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repo = db.select().from(repos).where(eq(repos.id, Number(id))).get();
    if (!repo) return reply.code(404).send({ error: "repo 不存在" });
    await refreshWorktrees(repo.id, repo.repoRoot);
    await recheckUnavailableSlots(repo.id).catch(() => 0);
    return listReposWithWorktrees().find((r) => r.id === repo.id);
  });

  // ── tasks ──
  app.get("/repos/:id/tasks", async (req) => {
    const { id } = req.params as { id: string };
    return listTaskDTOs(Number(id));
  });

  app.post("/repos/:id/tasks", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { description?: string; dependsOn?: number[] };
    if (!body.description?.trim()) return reply.code(400).send({ error: "description 必填" });
    const repo = db.select().from(repos).where(eq(repos.id, Number(id))).get();
    if (!repo) return reply.code(404).send({ error: "repo 不存在" });

    const seqRow = db
      .select({ seq: tasks.seq })
      .from(tasks)
      .where(eq(tasks.repoId, repo.id))
      .orderBy(tasks.seq)
      .all();
    const seq = (seqRow.length ? seqRow[seqRow.length - 1]!.seq : 0) + 1;

    const res = db
      .insert(tasks)
      .values({ repoId: repo.id, seq, description: body.description.trim(), createdAt: Date.now() })
      .run();
    const taskId = Number(res.lastInsertRowid);
    for (const dep of body.dependsOn ?? []) {
      db.insert(taskDeps).values({ taskId, dependsOn: dep }).run();
    }
    emitTask(taskId, "任务已创建");
    dispatch(repo.id).catch((e) => log.error("[scheduler] dispatch 失败:", e));
    return loadTaskDTO(taskId);
  });

  app.get("/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const dto = loadTaskDTO(Number(id));
    if (!dto) return reply.code(404).send({ error: "任务不存在" });
    return dto;
  });

  /** 验收：commit=true（默认）AI 生成 message + commit + push；false 仅标记通过不动工作区 */
  app.post("/tasks/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { commit } = (req.body ?? {}) as { commit?: boolean };
    try {
      await acceptTask(Number(id), { commit: commit !== false });
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/tasks/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { feedback } = (req.body ?? {}) as { feedback?: string };
    if (!feedback?.trim()) return reply.code(400).send({ error: "feedback 必填" });
    try {
      await rejectTask(Number(id), feedback);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/tasks/:id/nudge", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await nudgeTask(Number(id));
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** cancel：除 done 外任意状态可取消（md 需求 #4）；running 时同时中止会话；不清理工作区 */
  app.post("/tasks/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.select().from(tasks).where(eq(tasks.id, Number(id))).get();
    if (!row) return reply.code(404).send({ error: "任务不存在" });
    if (row.status === "done") return reply.code(400).send({ error: "任务已完成，无法取消" });
    if (row.status === "cancelled") return { ok: true };

    // running → 中止进行中的 LLM run
    if (row.status === "running" && row.sessionId) {
      const entry = await registry.acquire(row.sessionId).catch(() => null);
      if (entry?.session.isStreaming) await entry.session.abort().catch(() => {});
    }

    db.update(tasks)
      .set({ status: "cancelled", finishedAt: Date.now() })
      .where(eq(tasks.id, row.id))
      .run();
    if (row.worktreePath) {
      // 仅 busy 时释放，避免覆盖用户 reserved 占用
      db.update(worktrees)
        .set({ status: "idle", updatedAt: Date.now() })
        .where(and(eq(worktrees.path, row.worktreePath), eq(worktrees.status, "busy")))
        .run();
    }
    emitTask(row.id, "已取消（工作区未自动清理，请手动检查 git status）");
    dispatch(row.repoId).catch(() => {});
    return { ok: true };
  });

  /** 强制派发（md 需求 #7）：dirty 的 worktree 上执行排队任务 */
  app.post("/tasks/:id/dispatch", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { worktreePath } = (req.body ?? {}) as { worktreePath?: string };
    if (!worktreePath) return reply.code(400).send({ error: "worktreePath 必填" });
    try {
      await forceAssignToWorktree(Number(id), worktreePath);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** slot 占用/释放（md 需求 #6）：reserved 状态不参与派发 */
  app.post("/repos/:id/worktrees/reserve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { path, reserved } = (req.body ?? {}) as { path?: string; reserved?: boolean };
    if (!path) return reply.code(400).send({ error: "path 必填" });
    // 入库统一 realpath，避免 symlink 路径（如 /tmp → /private/tmp）查不到
    let wtPath: string;
    try {
      wtPath = realpath(path);
    } catch {
      return reply.code(404).send({ error: "路径不存在" });
    }
    const wt = db.select().from(worktrees).where(eq(worktrees.path, wtPath)).get();
    if (!wt || wt.repoId !== Number(id)) return reply.code(404).send({ error: "worktree 不存在" });
    if (reserved) {
      if (wt.status === "busy") return reply.code(400).send({ error: "该 worktree 正在执行任务" });
      db.update(worktrees)
        .set({ status: "reserved", updatedAt: Date.now() })
        .where(eq(worktrees.path, wtPath))
        .run();
    } else {
      if (wt.status !== "reserved") return reply.code(400).send({ error: "该 worktree 未被占用" });
      db.update(worktrees)
        .set({ status: "idle", updatedAt: Date.now() })
        .where(eq(worktrees.path, wtPath))
        .run();
    }
    return { ok: true, status: reserved ? "reserved" : "idle" };
  });

  /** 设置 repo 默认模型（task 会话派发时使用；空串清除） */
  app.post("/repos/:id/model", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { model } = (req.body ?? {}) as { model?: string };
    const repo = db.select().from(repos).where(eq(repos.id, Number(id))).get();
    if (!repo) return reply.code(404).send({ error: "repo 不存在" });
    let settings: Record<string, unknown> = {};
    try {
      settings = repo.settings ? (JSON.parse(repo.settings as string) as Record<string, unknown>) : {};
    } catch {
      /* ignore */
    }
    if (model?.trim()) settings.defaultModel = model.trim();
    else delete settings.defaultModel;
    db.update(repos)
      .set({ settings: JSON.stringify(settings) })
      .where(eq(repos.id, repo.id))
      .run();
    return { ok: true, defaultModel: settings.defaultModel ?? null };
  });

  /** 人工标记完成：running → awaiting_review（agent 未调 submit_for_review 时） */
  app.post("/tasks/:id/complete", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await completeTask(Number(id));
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** retry：failed → queued 重新排队（简化：不保证回到原 slot） */
  app.post("/tasks/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db.select().from(tasks).where(eq(tasks.id, Number(id))).get();
    if (!row) return reply.code(404).send({ error: "任务不存在" });
    if (row.status !== "failed") return reply.code(400).send({ error: "仅 failed 可重试" });
    if (row.worktreePath) {
      db.update(worktrees)
        .set({ status: "idle", updatedAt: Date.now() })
        .where(eq(worktrees.path, row.worktreePath))
        .run();
    }
    db.update(tasks).set({ status: "queued", error: null }).where(eq(tasks.id, row.id)).run();
    emitTask(row.id, "已重新排队");
    dispatch(row.repoId).catch(() => {});
    return { ok: true };
  });
}
