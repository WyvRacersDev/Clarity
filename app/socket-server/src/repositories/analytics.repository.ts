/**
 * Analytics repository (R8).
 *
 * Owns the aggregation SQL that backs the analytics endpoints, so
 * `analytics.service.ts` keeps only the business logic (window/day math, the 30s
 * cache, and series/rate shaping). Both queries are scoped to a single owner id.
 * The analytics "tag" is the PROJECT name — every project is its own bucket.
 */
import { sql } from "../infrastructure/db.js";

export interface CompletionRow {
  completion_ymd: string;
  tag: string;
  on_time: boolean;
}

/**
 * One row per completed task for a user, grouped by its PROJECT name (the
 * analytics "tag"). On-time = the task had a due time and completed on/before it.
 */
export async function getCompletionRows(ownerId: string): Promise<CompletionRow[]> {
  return sql<CompletionRow[]>`
    select to_char(t.completion_time, 'YYYY-MM-DD') as completion_ymd,
           p.name                                    as tag,
           (t.time is not null and t.completion_time <= t.time) as on_time
    from tasks t
    join screen_elements se on se.id = t.element_id
    join grids g           on g.id  = se.grid_id
    join projects p        on p.id  = g.project_id
    where p.owner_id = ${ownerId}
      and t.is_done = true
      and t.completion_time is not null
  `;
}

/** Every project name a user owns (the selectable analytics "tags"). */
export async function getUserTagRows(ownerId: string): Promise<Array<{ tag: string }>> {
  return sql<Array<{ tag: string }>>`
    select name as tag
    from projects
    where owner_id = ${ownerId}
    order by name
  `;
}
