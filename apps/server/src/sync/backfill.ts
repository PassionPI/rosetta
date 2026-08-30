import { eq } from "drizzle-orm";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { db } from "../db/index.ts";
import { sessions } from "../db/schema.ts";
import { log } from "../util/log.ts";
import { upsertProject } from "./projects.ts";

/**
 * 启动对账（md/02 §5）：SessionManager.listAll() 与 DB 对比，
 * 新文件回填 sessions 行。cwd 一律读 header 字段，不从目录名反解（07 §6）。
 */
export async function backfillSessions(): Promise<number> {
  const infos = await SessionManager.listAll();
  let added = 0;
  for (const info of infos) {
    const existing = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.filePath, info.path)).get();
    if (existing) {
      db.update(sessions)
        .set({
          updatedAt: info.modified.getTime(),
          name: info.name ?? undefined,
        })
        .where(eq(sessions.id, existing.id))
        .run();
      continue;
    }
    db.insert(sessions)
      .values({
        id: info.id,
        filePath: info.path,
        name: info.name ?? null,
        cwd: info.cwd || "",
        status: "active",
        parentSession: info.parentSessionPath ?? null,
        createdAt: info.created.getTime(),
        updatedAt: info.modified.getTime(),
      })
      .onConflictDoNothing()
      .run();
    added++;
    if (info.cwd) await upsertProject(info.cwd).catch(() => {});
  }
  if (added) log.info(`[backfill] 回填 ${added} 个 pi 历史会话`);
  return added;
}
