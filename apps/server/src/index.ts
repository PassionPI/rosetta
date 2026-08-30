import { eq } from "drizzle-orm";
import { registry } from "./agent/registry.ts";
import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { db, runMigrations, sqlite } from "./db/index.ts";
import { runs, tasks, worktrees } from "./db/schema.ts";
import { writeQueue } from "./recorder/write-queue.ts";
import { backfillSessions } from "./sync/backfill.ts";
import { log } from "./util/log.ts";

async function main(): Promise<void> {
  runMigrations();

  // ── 启动对账（md/03 §4 / md/08 §8）──
  db.update(runs)
    .set({ status: "interrupted", endedAt: Date.now() })
    .where(eq(runs.status, "running"))
    .run();

  // finishing 中断 → failed + 释放 slot（幂等重放见 md/08 §8 TODO，骨架先人工 retry）
  const finishing = db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "finishing"))
    .all();
  if (finishing.length) {
    db.update(tasks)
      .set({
        status: "failed",
        error: "server 重启时 git 流水线被中断，请 retry",
      })
      .where(eq(tasks.status, "finishing"))
      .run();
    for (const t of finishing) {
      if (t.worktreePath) {
        db.update(worktrees)
          .set({ status: "idle", updatedAt: Date.now() })
          .where(eq(worktrees.path, t.worktreePath))
          .run();
      }
    }
  }

  await backfillSessions().catch((e) =>
    log.error("[backfill] 失败（忽略）:", e),
  );

  if (!config.password) log.warn("HARNESS_PASSWORD 未设置，所有登录将被拒绝");
  registry.startSweeper();

  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  log.info(`rosetta server 已启动: http://${config.host}:${config.port}`);

  const shutdown = (sig: string) => {
    log.info(`收到 ${sig}，优雅停机…`);
    void (async () => {
      const deadline = setTimeout(() => process.exit(0), 10_000).unref();
      try {
        await app.close();
        await registry.shutdown();
        writeQueue.flush();
        sqlite.close();
      } catch (e) {
        log.error("停机异常:", e);
      }
      clearTimeout(deadline);
      process.exit(0);
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  log.error("启动失败:", e);
  process.exit(1);
});
