import { and, desc, eq } from "drizzle-orm";
import type { NotificationDTO } from "@rosetta/shared";
import { db } from "../db/index.ts";
import { notifications } from "../db/schema.ts";
import { wsHub } from "../ws/hub.ts";

export interface NotifyInput {
  /** awaiting_review | run_stopped | task_done | task_failed | dispatch_blocked | dispatch_skipped */
  type: string;
  title: string;
  detail?: string;
  taskId?: number;
  sessionId?: string;
  repoId?: number;
}

type Row = typeof notifications.$inferSelect;

export function rowToNotificationDTO(row: Row): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    detail: row.detail ?? null,
    taskId: row.taskId ?? null,
    sessionId: row.sessionId ?? null,
    repoId: row.repoId ?? null,
    read: row.read,
    createdAt: row.createdAt ?? null,
  };
}

/** 落库 + WS 广播 */
export function notify(input: NotifyInput): void {
  const res = db
    .insert(notifications)
    .values({
      type: input.type,
      title: input.title,
      detail: input.detail ?? null,
      taskId: input.taskId ?? null,
      sessionId: input.sessionId ?? null,
      repoId: input.repoId ?? null,
      createdAt: Date.now(),
    })
    .run();
  const row = db
    .select()
    .from(notifications)
    .where(eq(notifications.id, Number(res.lastInsertRowid)))
    .get();
  if (row) wsHub.notification(rowToNotificationDTO(row));
}

/** 去重版：同 type+taskId 存在未读通知时不重复发（防 dispatch_blocked 通知风暴） */
export function notifyOnce(input: NotifyInput): void {
  const conds = [eq(notifications.type, input.type), eq(notifications.read, false)];
  if (input.taskId != null) conds.push(eq(notifications.taskId, input.taskId));
  const existing = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(...conds))
    .get();
  if (existing) return;
  notify(input);
}

export function listNotifications(opts: {
  taskId?: number;
  unreadOnly?: boolean;
  limit?: number;
}): NotificationDTO[] {
  const conds = [];
  if (opts.taskId != null) conds.push(eq(notifications.taskId, opts.taskId));
  if (opts.unreadOnly) conds.push(eq(notifications.read, false));
  return db
    .select()
    .from(notifications)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 50)
    .all()
    .map(rowToNotificationDTO);
}

export function unreadCount(): number {
  return db.select({ id: notifications.id }).from(notifications).where(eq(notifications.read, false)).all().length;
}

export function markRead(id: number): void {
  db.update(notifications).set({ read: true }).where(eq(notifications.id, id)).run();
}

export function markAllRead(): void {
  db.update(notifications).set({ read: true }).where(eq(notifications.read, false)).run();
}
