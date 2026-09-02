import type { NotificationDTO } from "@rosetta/shared";
import { fx } from "./client.ts";

export interface ListNotificationsInput {
  taskId?: number;
  unreadOnly?: boolean;
  limit?: number;
}

export const listNotifications = (input?: ListNotificationsInput) =>
  fx<NotificationDTO[]>({
    url: "/api/notifications",
    search: {
      taskId: input?.taskId,
      unread: input?.unreadOnly ? "1" : undefined,
      limit: input?.limit,
    },
  });

export const unreadNotificationCount = () =>
  fx<{ count: number }>({ url: "/api/notifications/unread-count" });

export const markNotificationRead = (id: number) =>
  fx<{ ok: boolean }>({ url: `/api/notifications/${id}/read`, method: "POST" });

export const markAllNotificationsRead = () =>
  fx<{ ok: boolean }>({ url: "/api/notifications/read-all", method: "POST" });
