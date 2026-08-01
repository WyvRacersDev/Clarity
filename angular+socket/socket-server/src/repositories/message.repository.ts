/**
 * Message repository — SQL for the `messages` (chat) + `chat_reads` tables.
 *
 * Two conversation scopes share the `messages` table (see 0012_messages.sql):
 *   - 'project' — a project-wide channel, addressed by `projectId`.
 *   - 'dm'      — a 1:1 conversation, addressed by `dmKey` = the two usernames
 *                 sorted lexically and joined with '|'.
 *
 * `author` is a username string (no hard FK to users), matching
 * task_comments.author. History is paged newest-first via an optional `before`
 * (ISO timestamp) cursor but RETURNED oldest-first so the client can append.
 *
 * Plain exported async functions over the shared `sql` handle, matching the
 * other repositories (no classes / DI at this layer).
 */
import { sql } from "../infrastructure/db.js";

export type MessageScope = "project" | "dm";

/** An uploaded file carried by a message (E2). Immutable once the message posts. */
export interface MessageAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
}

/** A message's reactions for one emoji: the emoji + the users who reacted (E1). */
export interface ReactionSet {
  emoji: string;
  users: string[];
}

/** The serialized message shape sent to clients (ISO string timestamps). */
export interface SerializedMessage {
  id: string;
  scope: MessageScope;
  projectId: string | null;
  dmKey: string | null;
  author: string;
  body: string;
  replyToId: string | null;
  attachments: MessageAttachment[];
  reactions: ReactionSet[];
  edited_at: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  scope: MessageScope;
  project_id: string | null;
  dm_key: string | null;
  author: string;
  body: string;
  reply_to_id: string | null;
  attachments: MessageAttachment[] | null;
  edited_at: Date | null;
  created_at: Date;
}

function serialize(row: MessageRow): SerializedMessage {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    dmKey: row.dm_key,
    author: row.author,
    body: row.body,
    replyToId: row.reply_to_id,
    // `attachments` is JSONB (already parsed to an array by the driver); default
    // to [] for older rows. `reactions` is merged in by the read paths below.
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    reactions: [],
    edited_at: row.edited_at ? row.edited_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

const RETURNING = sql`
  returning id, scope, project_id, dm_key, author, body,
            reply_to_id, attachments, edited_at, created_at
`;

/**
 * Stable conversation key for a 1:1 DM: the two usernames sorted lexically and
 * joined with '|'. Order-independent so (alice,bob) and (bob,alice) collide onto
 * one conversation. Pure — safe to reuse on the client if ever needed.
 */
export function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join("|");
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Insert a project-channel message and return it (serialized). */
export async function insertProjectMessage(
  projectId: string,
  author: string,
  body: string,
  replyToId: string | null = null,
  attachments: MessageAttachment[] = []
): Promise<SerializedMessage> {
  const rows = await sql<MessageRow[]>`
    insert into messages (scope, project_id, author, body, reply_to_id, attachments)
    values ('project', ${projectId}, ${author}, ${body}, ${replyToId}, ${sql.json(attachments as any)})
    ${RETURNING}
  `;
  return serialize(rows[0]!);
}

/** Insert a 1:1 DM and return it (serialized). */
export async function insertDmMessage(
  dmKey: string,
  author: string,
  body: string,
  replyToId: string | null = null,
  attachments: MessageAttachment[] = []
): Promise<SerializedMessage> {
  const rows = await sql<MessageRow[]>`
    insert into messages (scope, dm_key, author, body, reply_to_id, attachments)
    values ('dm', ${dmKey}, ${author}, ${body}, ${replyToId}, ${sql.json(attachments as any)})
    ${RETURNING}
  `;
  return serialize(rows[0]!);
}

/**
 * Edit a message's body — only the original author may (scoped in the WHERE).
 * Stamps `edited_at`. Returns the updated message, or null if nothing matched.
 */
export async function editMessage(
  id: string,
  author: string,
  body: string
): Promise<SerializedMessage | null> {
  const rows = await sql<MessageRow[]>`
    update messages set body = ${body}, edited_at = now()
    where id = ${id} and author = ${author}
    ${RETURNING}
  `;
  return rows.length > 0 ? serialize(rows[0]!) : null;
}

/** Delete a message — only the original author may. Returns true if removed. */
export async function deleteMessage(id: string, author: string): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    delete from messages where id = ${id} and author = ${author}
    returning id
  `;
  return rows.length > 0;
}

// ─── Reads (history) ─────────────────────────────────────────────────────────

/**
 * A project channel's messages, oldest-first. Pages older history via `before`
 * (an ISO timestamp): only messages strictly older than it are returned.
 */
export async function listProjectMessages(
  projectId: string,
  before: string | null = null,
  limit = 50
): Promise<SerializedMessage[]> {
  const rows = await sql<MessageRow[]>`
    select id, scope, project_id, dm_key, author, body,
           reply_to_id, attachments, edited_at, created_at
    from messages
    where scope = 'project' and project_id = ${projectId}
      and (${before}::timestamptz is null or created_at < ${before}::timestamptz)
    order by created_at desc
    limit ${limit}
  `;
  return withReactions(rows.reverse().map(serialize));
}

/** A DM conversation's messages, oldest-first (same paging as project). */
export async function listDmMessages(
  dmKey: string,
  before: string | null = null,
  limit = 50
): Promise<SerializedMessage[]> {
  const rows = await sql<MessageRow[]>`
    select id, scope, project_id, dm_key, author, body,
           reply_to_id, attachments, edited_at, created_at
    from messages
    where scope = 'dm' and dm_key = ${dmKey}
      and (${before}::timestamptz is null or created_at < ${before}::timestamptz)
    order by created_at desc
    limit ${limit}
  `;
  return withReactions(rows.reverse().map(serialize));
}

// ─── Reactions (E1) ──────────────────────────────────────────────────────────

/** Aggregated reactions for one message: one entry per emoji, users listed. */
export async function reactionsForMessage(messageId: string): Promise<ReactionSet[]> {
  const rows = await sql<Array<{ emoji: string; users: string[] }>>`
    select emoji, array_agg(reader order by created_at) as users
    from message_reactions
    where message_id = ${messageId}
    group by emoji
    order by emoji
  `;
  return rows.map((r) => ({ emoji: r.emoji, users: r.users }));
}

/**
 * Attach reactions to a batch of already-serialized messages in one grouped
 * query (avoids an N+1 over history). Mutates + returns the same array.
 */
async function withReactions(messages: SerializedMessage[]): Promise<SerializedMessage[]> {
  if (messages.length === 0) return messages;
  const ids = messages.map((m) => m.id);
  const rows = await sql<Array<{ message_id: string; emoji: string; users: string[] }>>`
    select message_id, emoji, array_agg(reader order by created_at) as users
    from message_reactions
    where message_id = any(${ids}::uuid[])
    group by message_id, emoji
    order by emoji
  `;
  const byId = new Map<string, ReactionSet[]>();
  for (const r of rows) {
    const list = byId.get(r.message_id) ?? [];
    list.push({ emoji: r.emoji, users: r.users });
    byId.set(r.message_id, list);
  }
  for (const m of messages) m.reactions = byId.get(m.id) ?? [];
  return messages;
}

/**
 * Toggle `reader`'s reaction with `emoji` on a message: adds it if absent,
 * removes it if present. Returns the message's full reaction set afterwards so
 * the caller can broadcast the authoritative state.
 */
export async function toggleReaction(
  messageId: string,
  emoji: string,
  reader: string
): Promise<ReactionSet[]> {
  const inserted = await sql<Array<{ reader: string }>>`
    insert into message_reactions (message_id, emoji, reader)
    values (${messageId}, ${emoji}, ${reader})
    on conflict (message_id, emoji, reader) do nothing
    returning reader
  `;
  if (inserted.length === 0) {
    await sql`
      delete from message_reactions
      where message_id = ${messageId} and emoji = ${emoji} and reader = ${reader}
    `;
  }
  return reactionsForMessage(messageId);
}

/** The conversation a message belongs to — used to authorize reactions. */
export async function getMessageRouting(
  id: string
): Promise<{ scope: MessageScope; projectId: string | null; dmKey: string | null } | null> {
  const rows = await sql<Array<{ scope: MessageScope; project_id: string | null; dm_key: string | null }>>`
    select scope, project_id, dm_key from messages where id = ${id}
  `;
  const row = rows[0];
  return row ? { scope: row.scope, projectId: row.project_id, dmKey: row.dm_key } : null;
}

// ─── Read cursors + unread counts ────────────────────────────────────────────

/** Mark a conversation read up to now for `reader` (upsert the read cursor). */
export async function markRead(
  reader: string,
  conversationKey: string
): Promise<void> {
  await sql`
    insert into chat_reads (reader, conversation_key, last_read_at)
    values (${reader}, ${conversationKey}, now())
    on conflict (reader, conversation_key)
      do update set last_read_at = now()
  `;
}

/**
 * Unread count in a project channel for `reader`: messages newer than their read
 * cursor and not authored by them. A missing cursor means everything is unread.
 */
export async function projectUnreadCount(
  reader: string,
  projectId: string
): Promise<number> {
  const rows = await sql<Array<{ count: string }>>`
    select count(*)::text as count
    from messages m
    left join chat_reads r
      on r.reader = ${reader} and r.conversation_key = ${"project:" + projectId}
    where m.scope = 'project' and m.project_id = ${projectId}
      and m.author <> ${reader}
      and (r.last_read_at is null or m.created_at > r.last_read_at)
  `;
  return Number(rows[0]?.count ?? 0);
}

/** One entry in a user's DM conversation list: partner + last message + unread. */
export interface DmSummary {
  partner: string;
  dmKey: string;
  lastBody: string;
  lastAt: string;
  unread: number;
}

/**
 * All DM conversations `reader` participates in, most-recent first, each with the
 * last message preview and the reader's unread count. A user participates in a DM
 * when either side of the '|'-split dm_key is their username.
 */
export async function listDmConversations(reader: string): Promise<DmSummary[]> {
  const rows = await sql<
    Array<{ partner: string; dm_key: string; last_body: string; last_at: Date; unread: string }>
  >`
    with mine as (
      select m.*,
             case when split_part(m.dm_key, '|', 1) = ${reader}
                  then split_part(m.dm_key, '|', 2)
                  else split_part(m.dm_key, '|', 1) end as partner
      from messages m
      where m.scope = 'dm'
        and (split_part(m.dm_key, '|', 1) = ${reader}
             or split_part(m.dm_key, '|', 2) = ${reader})
    ),
    latest as (
      select distinct on (dm_key) dm_key, partner, body as last_body, created_at as last_at
      from mine
      order by dm_key, created_at desc
    )
    select l.partner, l.dm_key, l.last_body, l.last_at,
           (
             select count(*)::text from mine mm
             left join chat_reads r
               on r.reader = ${reader} and r.conversation_key = 'dm:' || mm.dm_key
             where mm.dm_key = l.dm_key
               and mm.author <> ${reader}
               and (r.last_read_at is null or mm.created_at > r.last_read_at)
           ) as unread
    from latest l
    order by l.last_at desc
  `;
  return rows.map((r) => ({
    partner: r.partner,
    dmKey: r.dm_key,
    lastBody: r.last_body,
    lastAt: r.last_at.toISOString(),
    unread: Number(r.unread ?? 0),
  }));
}

/**
 * True when the two users (by id) both participate in at least one common
 * project — either as owner or collaborator. Gates who may open a DM so the
 * feature stays scoped to actual collaborators, not arbitrary users.
 */
export async function usersShareAnyProject(
  userIdA: string,
  userIdB: string
): Promise<boolean> {
  const rows = await sql<Array<{ exists: boolean }>>`
    with participation as (
      select p.id as project_id, p.owner_id as user_id from projects p
      union
      select pc.project_id, pc.user_id from project_collaborators pc
    )
    select exists (
      select 1
      from participation a
      join participation b on a.project_id = b.project_id
      where a.user_id = ${userIdA} and b.user_id = ${userIdB}
    ) as exists
  `;
  return rows[0]?.exists ?? false;
}
