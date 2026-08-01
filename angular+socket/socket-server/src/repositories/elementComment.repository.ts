/**
 * Element comment repository (E6) — SQL for the `element_comments` table.
 *
 * Comments are pinned to a single canvas `screen_elements` row (the "comment pin"
 * primitive) and scoped to a project. `author`/`resolved_by` are username strings
 * (no hard FK to users), matching task_comments. `element_id` deliberately carries
 * no FK so a thread survives saveProject's full-replace of a project's elements
 * (the element id is stable) — see 0014_element_comments.sql.
 *
 * Plain exported async functions over the shared `sql` handle, matching the other
 * repositories (no classes / DI at this layer); business rules + authorization
 * live one level up in CollabService.
 */
import { sql } from "../infrastructure/db.js";

/** The serialized element comment shape sent to clients (ISO string timestamps). */
export interface SerializedElementComment {
  id: string;
  projectId: string;
  elementId: string;
  author: string;
  body: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  created_at: string;
}

interface ElementCommentRow {
  id: string;
  project_id: string;
  element_id: string;
  author: string;
  body: string;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

function serialize(row: ElementCommentRow): SerializedElementComment {
  return {
    id: row.id,
    projectId: row.project_id,
    elementId: row.element_id,
    author: row.author,
    body: row.body,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

const COLUMNS = sql`id, project_id, element_id, author, body, resolved_by, resolved_at, created_at`;

/** Insert one comment pinned to an element and return the created (serialized) comment. */
export async function createComment(
  projectId: string,
  elementId: string,
  author: string,
  body: string
): Promise<SerializedElementComment> {
  const rows = await sql<ElementCommentRow[]>`
    insert into element_comments (project_id, element_id, author, body)
    values (${projectId}, ${elementId}, ${author}, ${body})
    returning ${COLUMNS}
  `;
  return serialize(rows[0]!);
}

/** List every comment for a project (all elements), oldest-first. */
export async function listCommentsForProject(
  projectId: string
): Promise<SerializedElementComment[]> {
  const rows = await sql<ElementCommentRow[]>`
    select ${COLUMNS}
    from element_comments
    where project_id = ${projectId}
    order by created_at asc
  `;
  return rows.map(serialize);
}

/**
 * Mark a comment resolved (or re-open it when `resolved` is false), scoped to the
 * project so a client can't resolve a comment in another project. Returns the
 * updated comment, or null if no row matched.
 */
export async function setCommentResolved(
  commentId: string,
  projectId: string,
  resolved: boolean,
  username: string
): Promise<SerializedElementComment | null> {
  const rows = await sql<ElementCommentRow[]>`
    update element_comments
    set resolved_by = ${resolved ? username : null},
        resolved_at = ${resolved ? sql`now()` : null}
    where id = ${commentId} and project_id = ${projectId}
    returning ${COLUMNS}
  `;
  return rows[0] ? serialize(rows[0]) : null;
}

/**
 * Delete a comment, scoped to the project. Returns the deleted comment's
 * element id (so the caller can broadcast which thread changed), or null if no
 * row matched.
 */
export async function deleteComment(
  commentId: string,
  projectId: string
): Promise<{ elementId: string } | null> {
  const rows = await sql<{ element_id: string }[]>`
    delete from element_comments
    where id = ${commentId} and project_id = ${projectId}
    returning element_id
  `;
  return rows[0] ? { elementId: rows[0].element_id } : null;
}
