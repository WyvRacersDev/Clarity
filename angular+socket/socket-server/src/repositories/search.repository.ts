/**
 * Search repository (N3 — global content search).
 *
 * Owns the SQL that scans a single owner's content across four surfaces —
 * tasks, task comments, element names, and text-document bodies — and returns a
 * flat, ranked list of hits. Keeping the SQL here (never in the route/service)
 * follows the same repository boundary as analytics.repository.
 *
 * Every branch is scoped to `p.owner_id = ${ownerId}`, so a user can only ever
 * search their own projects. Matching is a case-insensitive substring (ILIKE);
 * the `q` value is bound as a parameter, so it is injection-safe.
 */
import { sql } from "../infrastructure/db.js";

export type SearchHitKind = "task" | "comment" | "element" | "document";

export interface SearchHit {
  kind: SearchHitKind;
  project_name: string;
  project_type: string;
  element_id: string | null;
  element_name: string | null;
  title: string;
  snippet: string;
}

/**
 * Search a single owner's content. `q` must already be trimmed and non-trivial
 * (the service enforces a minimum length). Results are capped at `limit`.
 */
export async function searchContent(
  ownerId: string,
  q: string,
  limit = 40
): Promise<SearchHit[]> {
  const pattern = `%${q}%`;
  return sql<SearchHit[]>`
    (
      select 'task'::text as kind, p.name as project_name, p.project_type,
             se.id as element_id, se.name as element_name,
             t.taskname as title, t.taskname as snippet
      from tasks t
      join screen_elements se on se.id = t.element_id
      join grids g           on g.id  = se.grid_id
      join projects p        on p.id  = g.project_id
      where p.owner_id = ${ownerId} and t.taskname ilike ${pattern}
    )
    union all
    (
      select 'comment'::text, p.name, p.project_type,
             se.id, se.name,
             coalesce(nullif(se.name, ''), t.taskname) as title,
             tc.body as snippet
      from task_comments tc
      join tasks t           on t.id  = tc.task_id
      join screen_elements se on se.id = t.element_id
      join grids g           on g.id  = se.grid_id
      join projects p        on p.id  = g.project_id
      where p.owner_id = ${ownerId} and tc.body ilike ${pattern}
    )
    union all
    (
      select 'element'::text, p.name, p.project_type,
             se.id, se.name,
             coalesce(nullif(se.name, ''), se.element_type) as title,
             se.element_type as snippet
      from screen_elements se
      join grids g    on g.id = se.grid_id
      join projects p on p.id = g.project_id
      where p.owner_id = ${ownerId} and se.name ilike ${pattern}
    )
    union all
    (
      select 'document'::text, p.name, p.project_type,
             se.id, se.name,
             coalesce(nullif(se.name, ''), 'Document') as title,
             left(se.content->>'Text_field', 200) as snippet
      from screen_elements se
      join grids g    on g.id = se.grid_id
      join projects p on p.id = g.project_id
      where p.owner_id = ${ownerId}
        and se.element_type = 'Text_document'
        and se.content->>'Text_field' ilike ${pattern}
    )
    order by title asc
    limit ${limit}
  `;
}
