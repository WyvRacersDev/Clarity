/**
 * Integrations repository (N10) — SQL for `user_integrations` plus the
 * whole-user task query that backs the ICS feed.
 *
 * Plain exported async functions over the shared `sql` handle, matching the
 * other repositories (no classes / DI at this layer).
 */
import { sql } from "../infrastructure/db.js";
import type { IcsTask } from "../lib/ics.js";

export type WebhookKind = "generic" | "slack";

export interface IntegrationRow {
  userId: string;
  icsFeedToken: string;
  webhookUrl: string | null;
  webhookKind: WebhookKind;
}

interface Row {
  user_id: string;
  ics_feed_token: string;
  webhook_url: string | null;
  webhook_kind: WebhookKind;
}

function serialize(row: Row): IntegrationRow {
  return {
    userId: row.user_id,
    icsFeedToken: row.ics_feed_token,
    webhookUrl: row.webhook_url,
    webhookKind: row.webhook_kind,
  };
}

/**
 * Fetch a user's integration row, creating it (with a freshly-minted feed token)
 * on first access. Idempotent via the primary-key conflict.
 */
export async function ensureIntegration(userId: string): Promise<IntegrationRow> {
  const rows = await sql<Row[]>`
    insert into user_integrations (user_id)
    values (${userId})
    on conflict (user_id) do update set user_id = excluded.user_id
    returning user_id, ics_feed_token, webhook_url, webhook_kind
  `;
  return serialize(rows[0]!);
}

/** Set (or clear) a user's outbound webhook. Returns the updated row. */
export async function setWebhook(
  userId: string,
  webhookUrl: string | null,
  webhookKind: WebhookKind
): Promise<IntegrationRow> {
  await ensureIntegration(userId);
  const rows = await sql<Row[]>`
    update user_integrations
       set webhook_url = ${webhookUrl}, webhook_kind = ${webhookKind}
     where user_id = ${userId}
    returning user_id, ics_feed_token, webhook_url, webhook_kind
  `;
  return serialize(rows[0]!);
}

/** Mint a new ICS feed token (invalidates the old subscribe URL). */
export async function regenerateFeedToken(userId: string): Promise<IntegrationRow> {
  await ensureIntegration(userId);
  const rows = await sql<Row[]>`
    update user_integrations
       set ics_feed_token = gen_random_uuid()
     where user_id = ${userId}
    returning user_id, ics_feed_token, webhook_url, webhook_kind
  `;
  return serialize(rows[0]!);
}

/** Resolve the user (id + username) that owns a given ICS feed token. */
export async function findUserByFeedToken(
  token: string
): Promise<{ id: string; username: string } | null> {
  const rows = await sql<Array<{ id: string; username: string }>>`
    select u.id, u.username
    from user_integrations ui
    join users u on u.id = ui.user_id
    where ui.ics_feed_token = ${token}
    limit 1
  `;
  return rows[0] ?? null;
}

/** A user's webhook config resolved by username (for the notify() side-channel). */
export async function getWebhookByUsername(
  username: string
): Promise<{ webhookUrl: string; webhookKind: WebhookKind } | null> {
  const rows = await sql<Array<{ webhook_url: string | null; webhook_kind: WebhookKind }>>`
    select ui.webhook_url, ui.webhook_kind
    from user_integrations ui
    join users u on u.id = ui.user_id
    where u.username = ${username}
    limit 1
  `;
  const row = rows[0];
  if (!row || !row.webhook_url) return null;
  return { webhookUrl: row.webhook_url, webhookKind: row.webhook_kind };
}

/**
 * Every task (with a due date) owned by a user, across their projects, shaped
 * for the ICS feed. Joins task → element → grid → project → owner, mirroring the
 * notification repo's problem-task join but WITHOUT the done/overdue filters.
 * Undated tasks are excluded (nothing to place on a calendar).
 */
export async function allDatedTasksForUser(username: string): Promise<IcsTask[]> {
  const rows = await sql<
    Array<{ id: string; taskname: string; due: Date | null; is_done: boolean; priority: number; project_name: string }>
  >`
    select t.id, t.taskname, t.time as due, t.is_done, t.priority, p.name as project_name
    from tasks t
    join screen_elements se on se.id = t.element_id
    join grids g           on g.id  = se.grid_id
    join projects p        on p.id  = g.project_id
    join users u           on u.id  = p.owner_id
    where u.username = ${username}
      and t.time is not null
    order by t.time asc
  `;
  return rows.map((r) => ({
    id: r.id,
    taskname: r.taskname,
    due: r.due ? r.due.toISOString() : null,
    is_done: r.is_done,
    priority: r.priority,
    project_name: r.project_name,
  }));
}
