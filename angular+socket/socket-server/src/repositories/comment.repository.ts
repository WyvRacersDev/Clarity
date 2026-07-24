/**
 * Task comment repository (A3) — SQL for the `task_comments` table.
 *
 * Comments are attached to a single `tasks` row. `author` is a username string
 * (no hard FK to users), matching how tasks.completed_by is carried as a
 * username over the socket contract. `task_id` is validated by the FK: inserting
 * a comment for a non-existent task raises a foreign-key error which the caller
 * surfaces as an ack failure.
 */
import { sql } from "../infrastructure/db.js";

/** The serialized comment shape sent to clients (ISO string timestamp). */
export interface SerializedComment {
  id: string;
  taskId: string;
  author: string;
  body: string;
  created_at: string;
}

interface CommentRow {
  id: string;
  task_id: string;
  author: string;
  body: string;
  created_at: Date;
}

function serialize(row: CommentRow): SerializedComment {
  return {
    id: row.id,
    taskId: row.task_id,
    author: row.author,
    body: row.body,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Insert one comment for a task and return the created (serialized) comment.
 * Throws if `taskId` does not reference an existing task (FK violation).
 */
export async function addComment(
  taskId: string,
  author: string,
  body: string
): Promise<SerializedComment> {
  const rows = await sql<CommentRow[]>`
    insert into task_comments (task_id, author, body)
    values (${taskId}, ${author}, ${body})
    returning id, task_id, author, body, created_at
  `;
  return serialize(rows[0]!);
}

/** List a task's comments oldest-first. */
export async function listComments(
  taskId: string
): Promise<SerializedComment[]> {
  const rows = await sql<CommentRow[]>`
    select id, task_id, author, body, created_at
    from task_comments
    where task_id = ${taskId}
    order by created_at asc
  `;
  return rows.map(serialize);
}
