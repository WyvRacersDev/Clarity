/**
 * Notifications repository (N2) — SQL for the `notifications` inbox table and the
 * per-project activity feed read-model.
 *
 * Distinct from `notification.repository.ts` (singular), which owns the cron's
 * due-task / problem-task queries. This one owns the durable in-app notification
 * center: insert, list-for-user, unread-count, and the mark-read writes, plus two
 * read helpers the write sites need (project participants for fan-out, and the
 * activity feed).
 *
 * Plain exported async functions over the shared `sql` handle, matching the other
 * repositories (no classes / DI at this layer).
 */
import { sql } from "../infrastructure/db.js";

/** The notification kinds the inbox understands (mirrors the DB CHECK). */
export type NotificationType =
  | "mention"
  | "comment"
  | "project_shared"
  | "ai_suggestion"
  | "due_soon";

/** The serialized notification shape sent to clients (ISO string timestamps). */
export interface SerializedNotification {
  id: string;
  recipient: string;
  type: NotificationType;
  actor: string | null;
  projectName: string | null;
  projectType: "local" | "hosted" | null;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

interface NotificationRow {
  id: string;
  recipient: string;
  type: NotificationType;
  actor: string | null;
  project_name: string | null;
  project_type: "local" | "hosted" | null;
  title: string;
  body: string | null;
  link: string | null;
  read_at: Date | null;
  created_at: Date;
}

function serialize(row: NotificationRow): SerializedNotification {
  return {
    id: row.id,
    recipient: row.recipient,
    type: row.type,
    actor: row.actor,
    projectName: row.project_name,
    projectType: row.project_type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.read_at !== null,
    created_at: row.created_at.toISOString(),
  };
}

/** Fields a caller supplies to create one notification. */
export interface InsertNotificationParams {
  recipient: string;
  type: NotificationType;
  actor?: string | null;
  projectName?: string | null;
  projectType?: "local" | "hosted" | null;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Insert one notification and return the created (serialized) row. */
export async function insertNotification(
  p: InsertNotificationParams
): Promise<SerializedNotification> {
  const rows = await sql<NotificationRow[]>`
    insert into notifications
      (recipient, type, actor, project_name, project_type, title, body, link)
    values
      (${p.recipient}, ${p.type}, ${p.actor ?? null}, ${p.projectName ?? null},
       ${p.projectType ?? null}, ${p.title}, ${p.body ?? null}, ${p.link ?? null})
    returning id, recipient, type, actor, project_name, project_type,
              title, body, link, read_at, created_at
  `;
  return serialize(rows[0]!);
}

/** A recipient's notifications, newest first, capped at `limit`. */
export async function listForRecipient(
  recipient: string,
  limit = 30
): Promise<SerializedNotification[]> {
  const rows = await sql<NotificationRow[]>`
    select id, recipient, type, actor, project_name, project_type,
           title, body, link, read_at, created_at
    from notifications
    where recipient = ${recipient}
    order by created_at desc
    limit ${limit}
  `;
  return rows.map(serialize);
}

/** Count of a recipient's unread notifications. */
export async function unreadCount(recipient: string): Promise<number> {
  const rows = await sql<Array<{ count: string }>>`
    select count(*)::text as count
    from notifications
    where recipient = ${recipient} and read_at is null
  `;
  return Number(rows[0]?.count ?? 0);
}

/** Mark one notification read (only if it belongs to `recipient`). Returns true if changed. */
export async function markRead(
  recipient: string,
  id: string
): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    update notifications set read_at = now()
    where id = ${id} and recipient = ${recipient} and read_at is null
    returning id
  `;
  return rows.length > 0;
}

/** Mark all of a recipient's notifications read. Returns the number affected. */
export async function markAllRead(recipient: string): Promise<number> {
  const rows = await sql<Array<{ id: string }>>`
    update notifications set read_at = now()
    where recipient = ${recipient} and read_at is null
    returning id
  `;
  return rows.length;
}

/**
 * Usernames of everyone who participates in a project: the owner plus every
 * registered collaborator. Used to fan out `comment` notifications. Distinct,
 * so an owner who is also (erroneously) a collaborator isn't double-notified.
 */
export async function participantUsernames(
  projectId: string
): Promise<string[]> {
  const rows = await sql<Array<{ username: string }>>`
    select u.username
    from projects p
    join users u on u.id = p.owner_id
    where p.id = ${projectId}
    union
    select u.username
    from project_collaborators pc
    join users u on u.id = pc.user_id
    where pc.project_id = ${projectId}
  `;
  return rows.map((r) => r.username);
}

/** One entry in a project's activity feed (comment or member-added). */
export interface FeedItem {
  kind: "comment" | "member_added";
  actor: string;
  detail: string; // comment body, or the added member's role
  created_at: string;
}

/**
 * A project's recent activity, newest first — a read-model UNION over
 * task_comments (comments on the project's tasks) and project_collaborators
 * (people added to the project). Independent of the `notifications` inbox so any
 * viewer sees the full activity regardless of who was individually notified.
 */
export async function projectFeed(
  projectId: string,
  limit = 30
): Promise<FeedItem[]> {
  const rows = await sql<
    Array<{ kind: "comment" | "member_added"; actor: string; detail: string; created_at: Date }>
  >`
    (
      select 'comment' as kind, tc.author as actor, tc.body as detail, tc.created_at
      from task_comments tc
      join tasks t           on t.id  = tc.task_id
      join screen_elements se on se.id = t.element_id
      join grids g           on g.id  = se.grid_id
      where g.project_id = ${projectId}
    )
    union all
    (
      select 'member_added' as kind, u.username as actor, pc.role as detail, pc.created_at
      from project_collaborators pc
      join users u on u.id = pc.user_id
      where pc.project_id = ${projectId}
    )
    order by created_at desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    kind: r.kind,
    actor: r.actor,
    detail: r.detail,
    created_at: r.created_at.toISOString(),
  }));
}
