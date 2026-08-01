/**
 * Notification repository (R8).
 *
 * Owns the SQL behind the notification cron: due-task lookups, the "problem
 * task" (overdue / undated) queries that back proactive suggestions, and the
 * mark-notified write. `notification.service.ts` keeps the business logic
 * (emailing, the scheduling heuristic, dedupe, and Socket.IO delivery).
 */
import { sql } from "../infrastructure/db.js";

export interface DueTaskRow {
  id: string;
  taskname: string;
  project_name: string;
  owner_username: string;
  owner_email: string;
}

export interface ProblemTaskRow {
  taskname: string;
  priority: number;
  project_name: string;
  owner_username: string;
  due: string | null;
}

/**
 * All tasks due within the next 24h that are not done and not yet notified,
 * joined task → element → grid → project → owner so the owner can be emailed.
 */
export async function getDueTasks(): Promise<DueTaskRow[]> {
  return sql<DueTaskRow[]>`
    select t.id,
           t.taskname,
           p.name     as project_name,
           u.username as owner_username,
           u.email    as owner_email
    from tasks t
    join screen_elements se on se.id = t.element_id
    join grids g           on g.id  = se.grid_id
    join projects p        on p.id  = g.project_id
    join users u           on u.id  = p.owner_id
    where t.is_done = false
      and t.notified = false
      and t.time is not null
      and t.time > now()
      and t.time <= now() + interval '24 hours'
  `;
}

/** Mark a single task as notified (no full-project rewrite). */
export async function markTaskNotified(taskId: string): Promise<void> {
  await sql`update tasks set notified = true where id = ${taskId}`;
}

/**
 * A single user's problem tasks (not done, overdue or undated), ordered
 * deadline-first then priority, capped at `limit`. `owner_username` is echoed
 * from the argument so the row shape matches `getAllProblemTasks`.
 */
export async function getProblemTasksForUser(
  username: string,
  limit: number
): Promise<ProblemTaskRow[]> {
  return sql<ProblemTaskRow[]>`
    select t.taskname, t.priority, p.name as project_name, ${username} as owner_username, t.time as due
    from tasks t
    join screen_elements se on se.id = t.element_id
    join grids g           on g.id  = se.grid_id
    join projects p        on p.id  = g.project_id
    join users u           on u.id  = p.owner_id
    where t.is_done = false
      and (t.time is null or t.time < now())
      and u.username = ${username}
    order by t.time asc nulls last, t.priority asc
    limit ${limit}
  `;
}

/** Every user's problem tasks (not done, overdue or undated), grouped-ready. */
export async function getAllProblemTasks(): Promise<ProblemTaskRow[]> {
  return sql<ProblemTaskRow[]>`
    select t.taskname,
           t.priority,
           p.name     as project_name,
           u.username as owner_username,
           t.time     as due
    from tasks t
    join screen_elements se on se.id = t.element_id
    join grids g           on g.id  = se.grid_id
    join projects p        on p.id  = g.project_id
    join users u           on u.id  = p.owner_id
    where t.is_done = false
      and (t.time is null or t.time < now())
    order by u.username, t.time asc nulls last, t.priority asc
  `;
}
