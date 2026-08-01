/**
 * Notification gateway (N2) — the wire contract for the in-app notification
 * center + per-project activity feed.
 *
 * Events (ack-based, mirroring the sharing gateway):
 *   notification:list        { limit? }                 → { notifications, unreadCount }
 *   notification:unreadCount  {}                         → { count }
 *   notification:markRead     { id }                     → { unreadCount }
 *   notification:markAllRead  {}                         → { unreadCount }
 *   notification:feed         { projectName, projectType, limit? } → { items }  (needs view)
 *
 * Inbox reads/writes are implicitly scoped to the CALLER (identity().username) —
 * you can only ever see or mutate your own notifications, so no per-item authz is
 * needed. The project feed requires `view` access, delegated to CollabService.
 *
 * Transport-only concerns live here (validate → resolve identity / authorize →
 * call the service → ack); the business logic is in NotificationCenterService.
 */
import type { Server, Socket } from "socket.io";
import type { GatewayDeps } from "./types.js";
import {
  notificationListSchema,
  notificationMarkReadSchema,
  notificationFeedSchema,
  formatZodError,
} from "../validation/schemas.js";
import { clientError } from "../lib/clientError.js";

type Ack = (response: any) => void;

export function register(io: Server, socket: Socket, deps: GatewayDeps): void {
  const { identity, notifications, collab } = deps;

  /** The caller's username, or undefined for the anonymous/demo case. */
  const recipient = (): string | undefined => {
    const name = identity().username;
    return name && name !== "Demo User" ? name : undefined;
  };

  // ─── Inbox reads/writes (self-scoped) ──────────────────────────────────────

  socket.on("notification:list", async (data: unknown, ack?: Ack) => {
    const parsed = notificationListSchema.safeParse(data ?? {});
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      const me = recipient();
      if (!me) {
        ack?.({ success: true, notifications: [], unreadCount: 0 });
        return;
      }
      const [list, count] = await Promise.all([
        notifications.list(me, parsed.data.limit),
        notifications.unreadCount(me),
      ]);
      ack?.({ success: true, notifications: list, unreadCount: count });
    } catch (error) {
      console.error("[Notifications] list error:", error);
      ack?.({ success: false, message: clientError("load notifications") });
    }
  });

  socket.on("notification:unreadCount", async (_data: unknown, ack?: Ack) => {
    try {
      const me = recipient();
      const count = me ? await notifications.unreadCount(me) : 0;
      ack?.({ success: true, count });
    } catch (error) {
      console.error("[Notifications] unreadCount error:", error);
      ack?.({ success: false, message: clientError("load notifications") });
    }
  });

  socket.on("notification:markRead", async (data: unknown, ack?: Ack) => {
    const parsed = notificationMarkReadSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      const me = recipient();
      if (me) await notifications.markRead(me, parsed.data.id);
      const count = me ? await notifications.unreadCount(me) : 0;
      ack?.({ success: true, unreadCount: count });
    } catch (error) {
      console.error("[Notifications] markRead error:", error);
      ack?.({ success: false, message: clientError("update the notification") });
    }
  });

  socket.on("notification:markAllRead", async (_data: unknown, ack?: Ack) => {
    try {
      const me = recipient();
      if (me) await notifications.markAllRead(me);
      ack?.({ success: true, unreadCount: 0 });
    } catch (error) {
      console.error("[Notifications] markAllRead error:", error);
      ack?.({ success: false, message: clientError("update notifications") });
    }
  });

  // ─── Per-project activity feed (needs view access) ─────────────────────────

  socket.on("notification:feed", async (data: unknown, ack?: Ack) => {
    const parsed = notificationFeedSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    try {
      const { projectName, projectType, limit } = parsed.data;
      const auth = await collab.authorize(
        projectName,
        projectType,
        identity().username,
        "view"
      );
      if (!auth.ok) {
        ack?.({ success: false, message: auth.message });
        return;
      }
      const items = await notifications.feed(auth.projectId, limit);
      ack?.({ success: true, items });
    } catch (error) {
      console.error("[Notifications] feed error:", error);
      ack?.({ success: false, message: clientError("load the activity feed") });
    }
  });
}
