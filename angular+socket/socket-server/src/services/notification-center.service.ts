/**
 * NotificationCenterService (N2) — the business boundary for the durable in-app
 * notification inbox + per-project activity feed.
 *
 * SRP: it owns the "should this notification exist and who gets it" rules
 * (skip the anonymous demo user, never notify someone of their own action,
 * de-dupe fan-out recipients) plus the live delivery (persist → emit
 * `notification:new` to the recipient's per-user room). DIP: it depends on the
 * repository, not on SQL; gateways/cron depend on THIS class, not the repo.
 *
 * Transport concerns (validation, ack shape) stay in the notification gateway;
 * the write sites (collab/sharing gateways, cron) just call `notify` / `notifyMany`.
 */
import type { Server } from "socket.io";
import { userRoom } from "./notification.service.js";
import {
  insertNotification,
  listForRecipient,
  unreadCount,
  markRead,
  markAllRead,
  participantUsernames,
  projectFeed,
  type InsertNotificationParams,
  type SerializedNotification,
  type FeedItem,
} from "../repositories/notifications.repository.js";

/** Keep notification bodies short (previews, not full threads). */
function preview(text: string, max = 140): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Optional side-channel invoked for every persisted notification (N10 webhook /
 * Slack delivery). Injected so this service stays decoupled from IntegrationsService
 * (DIP): it depends on a plain function, not the integration boundary. Best-effort.
 */
export type NotificationSideChannel = (
  recipient: string,
  notification: SerializedNotification
) => void | Promise<unknown>;

export class NotificationCenterService {
  private sideChannel?: NotificationSideChannel;

  /** Register an external delivery hook (N10). Fired fire-and-forget in `notify`. */
  setSideChannel(fn: NotificationSideChannel): void {
    this.sideChannel = fn;
  }

  /**
   * Persist one notification and push it live to the recipient's room. Returns
   * the created row, or null when suppressed (no recipient, the anonymous demo
   * user, or a self-notification — you never get notified of your own action).
   */
  async notify(
    io: Server,
    params: InsertNotificationParams
  ): Promise<SerializedNotification | null> {
    const { recipient, actor } = params;
    if (!recipient || recipient === "Demo User") return null;
    if (actor && actor === recipient) return null;

    const notification = await insertNotification(params);
    io.to(userRoom(recipient)).emit("notification:new", notification);

    // N10: mirror to an external webhook/Slack, if one is registered. Never let
    // a side-channel failure affect the in-app notification.
    if (this.sideChannel) {
      Promise.resolve(this.sideChannel(recipient, notification)).catch((err) =>
        console.error("[NotificationCenter] side-channel error:", err)
      );
    }
    return notification;
  }

  /**
   * Fan one notification out to many recipients (deduped). Each recipient gets
   * their own row; self / demo suppression is applied per recipient by `notify`.
   */
  async notifyMany(
    io: Server,
    recipients: Iterable<string>,
    base: Omit<InsertNotificationParams, "recipient">
  ): Promise<void> {
    const seen = new Set<string>();
    for (const recipient of recipients) {
      if (seen.has(recipient)) continue;
      seen.add(recipient);
      await this.notify(io, { ...base, recipient });
    }
  }

  /**
   * Record the durable notifications for one added comment (N2): a `mention`
   * row for each @mentioned user (richer type), and a `comment` row for every
   * OTHER project participant (owner + collaborators). Self / demo / already-
   * mentioned recipients are excluded so nobody is double-notified. The live
   * `mention:notified` transient push stays in the gateway.
   *
   * @param mentioned usernames the collab gateway already parsed from the body.
   */
  async recordCommentNotifications(
    io: Server,
    p: {
      projectId: string;
      projectName: string;
      projectType: "local" | "hosted";
      author: string;
      body: string;
      mentioned: string[];
    }
  ): Promise<void> {
    const body = preview(p.body);
    const scope = {
      actor: p.author,
      projectName: p.projectName,
      projectType: p.projectType,
      body,
    };

    // 1) Durable @mention rows.
    const mentionedSet = new Set(p.mentioned);
    for (const recipient of mentionedSet) {
      await this.notify(io, {
        ...scope,
        recipient,
        type: "mention",
        title: `${p.author} mentioned you`,
      });
    }

    // 2) Comment rows for the remaining participants.
    const participants = await participantUsernames(p.projectId);
    const recipients = participants.filter(
      (u) => u !== p.author && !mentionedSet.has(u)
    );
    await this.notifyMany(io, recipients, {
      ...scope,
      type: "comment",
      title: `${p.author} commented`,
    });
  }

  /** A recipient's notifications, newest first. */
  list(recipient: string, limit?: number): Promise<SerializedNotification[]> {
    return listForRecipient(recipient, limit);
  }

  /** Count of a recipient's unread notifications. */
  unreadCount(recipient: string): Promise<number> {
    return unreadCount(recipient);
  }

  /** Mark one notification read (scoped to the recipient). */
  markRead(recipient: string, id: string): Promise<boolean> {
    return markRead(recipient, id);
  }

  /** Mark all of a recipient's notifications read; returns the count affected. */
  markAllRead(recipient: string): Promise<number> {
    return markAllRead(recipient);
  }

  /** A project's recent activity feed (comments + members added). */
  feed(projectId: string, limit?: number): Promise<FeedItem[]> {
    return projectFeed(projectId, limit);
  }
}
