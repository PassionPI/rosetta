import type { FastifyInstance } from "fastify";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "../notify/notify.ts";

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications", async (req) => {
    const q = req.query as { taskId?: string; unread?: string; limit?: string };
    return listNotifications({
      taskId: q.taskId ? Number(q.taskId) : undefined,
      unreadOnly: q.unread === "1",
      limit: q.limit ? Number(q.limit) : undefined,
    });
  });

  app.get("/notifications/unread-count", async () => ({ count: unreadCount() }));

  app.post("/notifications/:id/read", async (req) => {
    const { id } = req.params as { id: string };
    markRead(Number(id));
    return { ok: true };
  });

  app.post("/notifications/read-all", async () => {
    markAllRead();
    return { ok: true };
  });
}
