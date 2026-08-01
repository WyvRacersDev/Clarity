/**
 * Project repository — SQL for projects / grids / screen_elements / tasks.
 *
 * LOAD  : join the four tables, order by `sort_order`, and rebuild the exact
 *         serialized project shape the frontend expects (owner_name, name,
 *         projectType, grid[].Screen_elements[] with type-correct casing).
 *
 * SAVE  : full-replace inside a single transaction. The caller (ProjectHandler)
 *         has already run the Google-Calendar diff/create/delete pass and
 *         written any new `calendar_event_id`s onto the incoming object, so here
 *         we simply UPSERT the project row, DELETE its grids (CASCADE clears
 *         elements + tasks), and reinsert everything with sort_order = index.
 *
 * Element `content` JSONB by type:
 *   Text_document -> { Text_field }
 *   Image         -> { imagepath }
 *   Video         -> { VideoPath }
 *   ToDoLst       -> { collaborators, tags }   (+ task rows in `tasks`)
 *
 * `tasks.completed_by` is a users.id UUID; the serialized contract carries a
 * username string, so we translate username -> UUID on save and UUID ->
 * username on load.
 */
import { sql } from "../infrastructure/db.js";
import { ensureUser, resolveUser } from "./identity.repository.js";
import { objects_builder } from "@models/screen-elements.model.js";

type ProjectType = "local" | "hosted";

/** The serialized project shape (matches ProjectHandler.serializeProject output). */
export interface SerializedProject {
  owner_name: string;
  name: string;
  projectType: ProjectType;
  grid: Array<{
    id?: string; // stable grid uuid (Phase 6b, additive)
    name: string;
    Screen_elements: any[];
  }>;
  lastModified: string;
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

/** Link-share configuration for a project (N1). */
export type LinkShareRole = "none" | "viewer" | "editor";

interface ProjectRow {
  id: string;
  name: string;
  owner_id: string;
  project_type: ProjectType;
  updated_at: Date;
  owner_username: string;
  link_share_role: LinkShareRole;
  link_share_token: string | null;
}

async function findProjectRow(
  name: string,
  projectType: ProjectType
): Promise<ProjectRow | null> {
  const rows = await sql<ProjectRow[]>`
    select p.id, p.name, p.owner_id, p.project_type, p.updated_at,
           p.link_share_role, p.link_share_token,
           u.username as owner_username
    from projects p
    join users u on u.id = p.owner_id
    where p.name = ${name} and p.project_type = ${projectType}
    limit 1
  `;
  return rows.length > 0 ? rows[0]! : null;
}

/**
 * Stable transaction-advisory-lock key for a project (A3). saveProject's
 * full-replace (delete grids + reinsert) and the granular element:create path
 * both take `pg_advisory_xact_lock(hashtext(key))` so they serialize instead of
 * racing the grid delete/recreate — which otherwise made element:create fail
 * with "grid missing" and silently drop elements. Keyed on (type, name), which
 * matches how the granular ops resolve a project (by name+type), so both paths
 * agree on the same lock.
 */
function projectLockKey(name: string, projectType: ProjectType): string {
  return `project:${projectType}:${name}`;
}

/**
 * Lightweight project lookup used for AUTHORIZATION (A2): returns the project id
 * and its owner's username, or null when the project doesn't exist. Callers gate
 * mutations on `owner_username` (local projects: owner-only) without loading the
 * whole project.
 */
export async function findProjectAuth(
  name: string,
  projectType: ProjectType
): Promise<{
  id: string;
  owner_username: string;
  link_share_role: LinkShareRole;
  link_share_token: string | null;
} | null> {
  const row = await findProjectRow(name, projectType);
  return row
    ? {
        id: row.id,
        owner_username: row.owner_username,
        link_share_role: row.link_share_role,
        link_share_token: row.link_share_token,
      }
    : null;
}

/**
 * Read a project's link-share config by id (N1). Returns null if the project no
 * longer exists.
 */
export async function getProjectLinkShare(
  projectId: string
): Promise<{ link_share_role: LinkShareRole; link_share_token: string | null } | null> {
  const rows = await sql<
    Array<{ link_share_role: LinkShareRole; link_share_token: string | null }>
  >`
    select link_share_role, link_share_token
    from projects where id = ${projectId} limit 1
  `;
  return rows.length > 0 ? rows[0]! : null;
}

/**
 * Set a project's link-share role (N1). Enabling ('viewer'/'editor') mints a
 * share token if none exists; disabling ('none') clears it. Returns the token
 * in effect after the write (null when disabled).
 */
export async function setProjectLinkShare(
  projectId: string,
  role: LinkShareRole
): Promise<string | null> {
  if (role === "none") {
    await sql`
      update projects set link_share_role = 'none', link_share_token = null
      where id = ${projectId}
    `;
    return null;
  }
  const rows = await sql<Array<{ link_share_token: string }>>`
    update projects
       set link_share_role  = ${role},
           link_share_token = coalesce(link_share_token, gen_random_uuid())
     where id = ${projectId}
    returning link_share_token
  `;
  return rows.length > 0 ? rows[0]!.link_share_token : null;
}

/**
 * Projects of a type the given user can reach as owner OR collaborator (N1).
 * Used by the local-project list so shared-with-me projects appear alongside
 * owned ones. Each row carries the user's effective role ('owner' for owned).
 */
export async function listProjectsForUser(
  projectType: ProjectType,
  username: string
): Promise<Array<ProjectListItem & { role: string; isOwner: boolean }>> {
  const rows = await sql<
    Array<{
      name: string;
      owner_username: string;
      updated_at: Date;
      grid_count: string;
      role: string;
    }>
  >`
    select p.name,
           owner.username as owner_username,
           p.updated_at,
           count(g.id)    as grid_count,
           case when owner.username = ${username} then 'owner'
                else pc.role end as role
    from projects p
    join users owner on owner.id = p.owner_id
    left join users me on me.username = ${username}
    left join project_collaborators pc
           on pc.project_id = p.id and pc.user_id = me.id
    left join grids g on g.project_id = p.id
    where p.project_type = ${projectType}
      and (owner.username = ${username} or pc.user_id is not null)
    group by p.id, owner.username, pc.role
    order by p.updated_at desc
  `;
  return rows.map((r) => ({
    name: r.name,
    owner_name: r.owner_username,
    filename: `${r.name}.json`,
    projectType,
    gridCount: Number(r.grid_count),
    lastModified: r.updated_at.toISOString(),
    role: r.role,
    isOwner: r.owner_username === username,
  }));
}

/**
 * Whether `elementId` belongs to a grid of `projectId` (A2). Prevents a client
 * from naming its OWN project in the payload while targeting an element that
 * lives in someone else's project.
 */
export async function elementInProject(
  elementId: string,
  projectId: string
): Promise<boolean> {
  const rows = await sql<Array<{ ok: boolean }>>`
    select true as ok
    from screen_elements se
    join grids g on g.id = se.grid_id
    where se.id = ${elementId} and g.project_id = ${projectId}
    limit 1
  `;
  return rows.length > 0;
}

/**
 * Load a project by name + type. Returns the serialized project shape (ready to
 * be fed to ProjectHandler.deserializeProject), or null when not found.
 */
export async function loadProject(
  name: string,
  projectType: ProjectType
): Promise<SerializedProject | null> {
  const project = await findProjectRow(name, projectType);
  if (!project) return null;

  const grids = await sql<Array<{ id: string; name: string }>>`
    select id, name from grids
    where project_id = ${project.id}
    order by sort_order asc, created_at asc
  `;

  const gridOut: SerializedProject["grid"] = [];

  for (const grid of grids) {
    const elements = await sql<
      Array<{
        id: string;
        element_type: string;
        name: string;
        x_pos: number;
        y_pos: number;
        x_scale: number;
        y_scale: number;
        content: any;
      }>
    >`
      select id, element_type, name, x_pos, y_pos, x_scale, y_scale, content
      from screen_elements
      where grid_id = ${grid.id}
      order by sort_order asc, created_at asc
    `;

    const screenElements: any[] = [];

    for (const el of elements) {
      const base = {
        type: el.element_type,
        id: el.id, // stable element uuid (Phase 6b, additive)
        name: el.name,
        x_pos: el.x_pos,
        y_pos: el.y_pos,
        x_scale: el.x_scale,
        y_scale: el.y_scale,
      };
      const content = el.content ?? {};

      if (el.element_type === "Text_document") {
        screenElements.push({
          ...base,
          Text_field: content.Text_field ?? "",
          // B3: collaborative Yjs state (base64). Only emit when present so
          // non-collab text docs keep their old shape.
          ...(content.ydoc != null ? { ydoc: content.ydoc } : {}),
        });
      } else if (el.element_type === "Image") {
        screenElements.push({ ...base, imagepath: content.imagepath ?? "" });
      } else if (el.element_type === "Video") {
        screenElements.push({ ...base, VideoPath: content.VideoPath ?? "" });
      } else if (el.element_type === "ToDoLst") {
        const taskRows = await sql<
          Array<{
            id: string;
            taskname: string;
            priority: number;
            is_done: boolean;
            time: Date | null;
            completion_time: Date | null;
            completed_by_username: string | null;
            creation_time: Date | null;
            calendar_event_id: string | null;
            notified: boolean;
            repeat: string;
            status: string;
          }>
        >`
          select t.id, t.taskname, t.priority, t.is_done, t.time,
                 t.completion_time, t.creation_time, t.calendar_event_id,
                 t.notified, t.repeat, t.status, cu.username as completed_by_username
          from tasks t
          left join users cu on cu.id = t.completed_by
          where t.element_id = ${el.id}
          order by t.sort_order asc, t.creation_time asc
        `;

        const scheduled_tasks = taskRows.map((t) => ({
          type: "scheduled_task",
          id: t.id,
          taskname: t.taskname,
          priority: t.priority,
          is_done: t.is_done,
          time: t.time ? t.time.toISOString() : "",
          completion_time: t.completion_time
            ? t.completion_time.toISOString()
            : null,
          completed_by: t.completed_by_username ?? null,
          creation_time: t.creation_time
            ? t.creation_time.toISOString()
            : "",
          calendar_event_id: t.calendar_event_id ?? null,
          notified: t.notified,
          repeat: t.repeat ?? "none",
          // N6: derive the lane from is_done for rows predating the status column.
          status: t.status ?? (t.is_done ? "done" : "todo"),
        }));

        screenElements.push({
          ...base,
          scheduled_tasks,
          collaborators: Array.isArray(content.collaborators)
            ? content.collaborators
            : [],
          tags: Array.isArray(content.tags) ? content.tags : [],
          dependsOn: Array.isArray(content.dependsOn) ? content.dependsOn : [],
        });
      } else {
        // Unknown type — pass through content fields defensively.
        screenElements.push({ ...base, ...content });
      }
    }

    gridOut.push({ id: grid.id, name: grid.name, Screen_elements: screenElements });
  }

  return {
    owner_name: project.owner_username,
    name: project.name,
    projectType: project.project_type,
    grid: gridOut,
    lastModified: project.updated_at.toISOString(),
  };
}

// ─── SAVE ────────────────────────────────────────────────────────────────────

/**
 * A16: does `ownerName` already own a project with this (name, projectType)?
 * Scoped by owner so it matches the `(owner_id, name, project_type)` unique
 * constraint that saveProject upserts on — lets the gateway give explicit
 * "already exists" feedback on a create instead of silently overwriting.
 */
export async function projectExistsForOwner(
  ownerName: string,
  name: string,
  projectType: ProjectType
): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    select p.id
    from projects p
    join users u on u.id = p.owner_id
    where u.username = ${ownerName}
      and p.name = ${name}
      and p.project_type = ${projectType}
    limit 1
  `;
  return rows.length > 0;
}

function toTimestampOrNull(v: any): string | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// N7: guard the recurrence rule against the DB CHECK constraint. Any unknown /
// missing value degrades to 'none' (a one-off) rather than failing the save.
const ALLOWED_REPEAT = new Set(["none", "daily", "weekly", "monthly"]);
function normalizeRepeat(v: any): string {
  return typeof v === "string" && ALLOWED_REPEAT.has(v) ? v : "none";
}

// N6: guard the kanban lane against the DB CHECK constraint AND the done/is_done
// invariant. A done task is always 'done'; otherwise an unknown/'done' value
// degrades to 'todo'. Mirrors normalizeStatus in the shared model.
function normalizeStatus(v: any, isDone: boolean): string {
  if (isDone) return "done";
  return v === "todo" || v === "in_progress" ? v : "todo";
}

/**
 * Full-replace save of a project. `serialized` is the ProjectHandler-serialized
 * shape (post calendar diff). Returns the saved project id.
 */
export async function saveProject(
  serialized: SerializedProject,
  projectType: ProjectType
): Promise<string> {
  const owner = await ensureUser(serialized.owner_name);

  // Pre-resolve every distinct completed_by username -> UUID before the tx so
  // the identity upserts don't nest inside the replace transaction.
  const completedByCache = new Map<string, string | null>();
  const grids = Array.isArray(serialized.grid) ? serialized.grid : [];
  for (const grid of grids) {
    for (const el of grid.Screen_elements ?? []) {
      if (Array.isArray(el.scheduled_tasks)) {
        for (const t of el.scheduled_tasks) {
          const cb = t?.completed_by;
          if (cb && typeof cb === "string" && !completedByCache.has(cb)) {
            const u = await resolveUser(cb);
            completedByCache.set(cb, u ? u.id : null);
          }
        }
      }
    }
  }

  return await sql.begin(async (tx) => {
    // A3: serialize with any concurrent full-replace save AND granular
    // element:create on the same project. Held until the tx commits/rolls back.
    await tx`select pg_advisory_xact_lock(hashtext(${projectLockKey(serialized.name, projectType)}))`;

    // UPSERT projects on (owner_id, name, project_type).
    // N1: a NEWLY created hosted project defaults to public link sharing
    // ('editor'), preserving the prior "hosted = anyone can edit" behaviour;
    // local projects start private ('none'). On an existing project the
    // conflict branch only bumps updated_at, so the owner's link-share choice is
    // preserved across saves (never reset by a content save).
    const defaultLinkRole: LinkShareRole = projectType === "hosted" ? "editor" : "none";
    const projRows = await tx<Array<{ id: string }>>`
      insert into projects (name, owner_id, project_type, link_share_role, link_share_token)
      values (
        ${serialized.name}, ${owner.id}, ${projectType}, ${defaultLinkRole},
        ${defaultLinkRole === "none" ? null : sql`gen_random_uuid()`}
      )
      on conflict (owner_id, name, project_type)
      do update set updated_at = now()
      returning id
    `;
    const projectId = projRows[0]!.id;

    // Full replace: drop grids (CASCADE clears elements + tasks).
    await tx`delete from grids where project_id = ${projectId}`;

    for (let gi = 0; gi < grids.length; gi++) {
      const grid = grids[gi]!;
      const gridRows = await tx<Array<{ id: string }>>`
        insert into grids (project_id, name, sort_order)
        values (${projectId}, ${grid.name ?? `grid_${gi}`}, ${gi})
        returning id
      `;
      const gridId = gridRows[0]!.id;

      const elements = Array.isArray(grid.Screen_elements)
        ? grid.Screen_elements
        : [];

      for (let ei = 0; ei < elements.length; ei++) {
        const el = elements[ei]!;
        const elementType = resolveElementType(el);
        const content = buildElementContent(elementType, el);

        // Reuse the incoming stable id as the row PK when present (Phase 6b) so
        // element ids survive whole-project saves; otherwise let Postgres
        // generate one. `id` is validated as a uuid-ish string; on any conflict
        // (extremely unlikely, since grids were just dropped) Postgres errors and
        // the tx rolls back — acceptable for a full-replace save.
        const incomingId =
          typeof el.id === "string" && el.id.length > 0 ? el.id : null;

        const elemRows = incomingId
          ? await tx<Array<{ id: string }>>`
              insert into screen_elements
                (id, grid_id, element_type, name, x_pos, y_pos, x_scale, y_scale, content, sort_order)
              values (
                ${incomingId}, ${gridId}, ${elementType}, ${el.name ?? ""},
                ${num(el.x_pos)}, ${num(el.y_pos)},
                ${num(el.x_scale, 1)}, ${num(el.y_scale, 1)},
                ${sql.json(content as any)}, ${ei}
              )
              returning id
            `
          : await tx<Array<{ id: string }>>`
              insert into screen_elements
                (grid_id, element_type, name, x_pos, y_pos, x_scale, y_scale, content, sort_order)
              values (
                ${gridId}, ${elementType}, ${el.name ?? ""},
                ${num(el.x_pos)}, ${num(el.y_pos)},
                ${num(el.x_scale, 1)}, ${num(el.y_scale, 1)},
                ${sql.json(content as any)}, ${ei}
              )
              returning id
            `;
        const elementId = elemRows[0]!.id;

        if (elementType === "ToDoLst" && Array.isArray(el.scheduled_tasks)) {
          for (let ti = 0; ti < el.scheduled_tasks.length; ti++) {
            const t = el.scheduled_tasks[ti]!;
            const completedBy =
              t.completed_by && typeof t.completed_by === "string"
                ? completedByCache.get(t.completed_by) ?? null
                : null;

            // Reuse the incoming stable task id as the row PK when present so
            // task ids survive whole-project saves (mirrors the screen_elements
            // pattern above). Combined with task_comments no longer cascading on
            // task delete (migration 0004), this keeps comments attached across
            // full-replace saves. New (unsaved) tasks let Postgres generate one.
            const incomingTaskId =
              typeof t.id === "string" && t.id.length > 0 ? t.id : null;

            if (incomingTaskId) {
              await tx`
                insert into tasks
                  (id, element_id, taskname, priority, is_done, time, completion_time,
                   completed_by, notified, calendar_event_id, creation_time, sort_order, repeat, status)
                values (
                  ${incomingTaskId}, ${elementId},
                  ${t.taskname ?? ""},
                  ${typeof t.priority === "number" ? t.priority : parseInt(t.priority, 10) || 2},
                  ${!!t.is_done},
                  ${toTimestampOrNull(t.time)},
                  ${toTimestampOrNull(t.completion_time)},
                  ${completedBy},
                  ${!!t.notified},
                  ${t.calendar_event_id ?? null},
                  ${toTimestampOrNull(t.creation_time) ?? new Date().toISOString()},
                  ${ti},
                  ${normalizeRepeat(t.repeat)},
                  ${normalizeStatus(t.status, !!t.is_done)}
                )
              `;
            } else {
              await tx`
                insert into tasks
                  (element_id, taskname, priority, is_done, time, completion_time,
                   completed_by, notified, calendar_event_id, creation_time, sort_order, repeat, status)
                values (
                  ${elementId},
                  ${t.taskname ?? ""},
                  ${typeof t.priority === "number" ? t.priority : parseInt(t.priority, 10) || 2},
                  ${!!t.is_done},
                  ${toTimestampOrNull(t.time)},
                  ${toTimestampOrNull(t.completion_time)},
                  ${completedBy},
                  ${!!t.notified},
                  ${t.calendar_event_id ?? null},
                  ${toTimestampOrNull(t.creation_time) ?? new Date().toISOString()},
                  ${ti},
                  ${normalizeRepeat(t.repeat)},
                  ${normalizeStatus(t.status, !!t.is_done)}
                )
              `;
            }
          }
        }
      }
    }

    return projectId;
  });
}

function num(v: any, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function resolveElementType(el: any): string {
  // Delegate to the single canonical detector (shared model). Adding a new
  // element type no longer means editing this duplicated ladder.
  return objects_builder.typeOf(el);
}

function buildElementContent(_elementType: string, el: any): Record<string, unknown> {
  // Polymorphic: each Screen_Element subclass owns its own `content` shape via
  // toContent(). Adding an element type no longer means editing this function.
  return objects_builder.contentOf(el);
}

// ─── GRANULAR ELEMENT OPS (Phase 6b) ─────────────────────────────────────────
//
// Additive per-element persistence used by the collab gateway. These operate on
// a single `screen_elements` row (by grid_id or element id) so that concurrent
// editors sync at element granularity with last-write-wins per element. The
// whole-project saveProject/loadProject path is unchanged and remains the
// fallback / initial-load mechanism.

interface ElementRow {
  id: string;
  grid_id: string;
  element_type: string;
  name: string;
  x_pos: number;
  y_pos: number;
  x_scale: number;
  y_scale: number;
  content: any;
}

/**
 * Serialize a single screen_elements row to the client element shape (the same
 * per-type shape the whole-project LOAD path produces, including the stable
 * `id`). For ToDoLst, task rows are joined in.
 */
async function serializeElementRow(el: ElementRow): Promise<any> {
  const base = {
    type: el.element_type,
    id: el.id,
    name: el.name,
    x_pos: el.x_pos,
    y_pos: el.y_pos,
    x_scale: el.x_scale,
    y_scale: el.y_scale,
  };
  const content = el.content ?? {};

  // Non-ToDoLst types store their full client shape in `content` JSONB, so a
  // generic spread reconstructs them — no per-type branch needed. ToDoLst is the
  // one special case: its tasks live in the `tasks` table, joined below.
  if (el.element_type !== "ToDoLst") {
    return { ...base, ...content };
  }

  // ToDoLst: base + content (collaborators/tags/dependsOn) + joined task rows.
  {
    const taskRows = await sql<
      Array<{
        id: string;
        taskname: string;
        priority: number;
        is_done: boolean;
        time: Date | null;
        completion_time: Date | null;
        completed_by_username: string | null;
        creation_time: Date | null;
        calendar_event_id: string | null;
        notified: boolean;
        repeat: string;
        status: string;
      }>
    >`
      select t.id, t.taskname, t.priority, t.is_done, t.time,
             t.completion_time, t.creation_time, t.calendar_event_id,
             t.notified, t.repeat, t.status, cu.username as completed_by_username
      from tasks t
      left join users cu on cu.id = t.completed_by
      where t.element_id = ${el.id}
      order by t.sort_order asc, t.creation_time asc
    `;
    // Field set MUST match the whole-project loadProject serialization (incl.
    // repeat/status) so a live element:created broadcast and a later reload
    // produce the same task shape — otherwise recurrence/kanban-lane data is
    // dropped for collaborators until they refresh (H3).
    const scheduled_tasks = taskRows.map((t) => ({
      type: "scheduled_task",
      id: t.id,
      taskname: t.taskname,
      priority: t.priority,
      is_done: t.is_done,
      time: t.time ? t.time.toISOString() : "",
      completion_time: t.completion_time ? t.completion_time.toISOString() : null,
      completed_by: t.completed_by_username ?? null,
      creation_time: t.creation_time ? t.creation_time.toISOString() : "",
      calendar_event_id: t.calendar_event_id ?? null,
      notified: t.notified,
      repeat: t.repeat ?? "none",
      // N6: derive the lane from is_done for rows predating the status column.
      status: t.status ?? (t.is_done ? "done" : "todo"),
    }));
    return {
      ...base,
      scheduled_tasks,
      collaborators: Array.isArray(content.collaborators) ? content.collaborators : [],
      tags: Array.isArray(content.tags) ? content.tags : [],
      dependsOn: Array.isArray(content.dependsOn) ? content.dependsOn : [],
    };
  }
}

/**
 * Insert ONE screen_elements row into the given grid and return the serialized
 * element (with its new stable `id`). Appends after existing elements.
 */
export async function insertElement(
  gridId: string,
  element: any
): Promise<any | null> {
  const gridRows = await sql<Array<{ id: string }>>`
    select id from grids where id = ${gridId} limit 1
  `;
  if (gridRows.length === 0) return null;

  const elementType = resolveElementType(element);
  const content = buildElementContent(elementType, element);

  // Append: sort_order = current max + 1.
  const orderRows = await sql<Array<{ next_order: number }>>`
    select coalesce(max(sort_order) + 1, 0) as next_order
    from screen_elements where grid_id = ${gridId}
  `;
  const sortOrder = Number(orderRows[0]?.next_order ?? 0);

  const rows = await sql<ElementRow[]>`
    insert into screen_elements
      (grid_id, element_type, name, x_pos, y_pos, x_scale, y_scale, content, sort_order)
    values (
      ${gridId}, ${elementType}, ${element.name ?? ""},
      ${num(element.x_pos)}, ${num(element.y_pos)},
      ${num(element.x_scale, 1)}, ${num(element.y_scale, 1)},
      ${sql.json(content as any)}, ${sortOrder}
    )
    returning id, grid_id, element_type, name, x_pos, y_pos, x_scale, y_scale, content
  `;

  const row = rows[0];
  if (!row) return null;

  // Insert any ToDoLst tasks that came with the element (best-effort).
  if (elementType === "ToDoLst" && Array.isArray(element.scheduled_tasks)) {
    for (let ti = 0; ti < element.scheduled_tasks.length; ti++) {
      const t = element.scheduled_tasks[ti]!;
      await sql`
        insert into tasks
          (element_id, taskname, priority, is_done, time, notified,
           calendar_event_id, creation_time, sort_order, status)
        values (
          ${row.id}, ${t.taskname ?? ""},
          ${typeof t.priority === "number" ? t.priority : parseInt(t.priority, 10) || 2},
          ${!!t.is_done}, ${toTimestampOrNull(t.time)}, ${!!t.notified},
          ${t.calendar_event_id ?? null},
          ${toTimestampOrNull(t.creation_time) ?? new Date().toISOString()}, ${ti},
          ${normalizeStatus(t.status, !!t.is_done)}
        )
      `;
    }
  }

  return await serializeElementRow(row);
}

/**
 * Atomically create ONE element in a project (A3). Resolves the project + target
 * grid and inserts the element inside a single transaction that holds the
 * project advisory lock, so it can NOT interleave with a concurrent
 * full-replace saveProject (which drops + recreates grids). This closes the race
 * where a double-clicked save deleted the grid between the caller resolving a
 * gridId and inserting, yielding "grid missing" and silently lost elements.
 *
 * `gridId` (optional) is honored only if it belongs to the project; otherwise
 * (or when omitted) the project's first grid is used. Returns the serialized
 * element on success, or `{ ok: false, reason }` when the project/grid is gone.
 */
export async function createElement(
  name: string,
  projectType: ProjectType,
  gridId: string | null,
  element: any
): Promise<
  | { ok: true; gridId: string; element: any }
  | { ok: false; reason: "no_project" | "no_grid" }
> {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${projectLockKey(name, projectType)}))`;

    const projRows = await tx<Array<{ id: string }>>`
      select id from projects where name = ${name} and project_type = ${projectType} limit 1
    `;
    const projectId = projRows[0]?.id;
    if (!projectId) return { ok: false as const, reason: "no_project" as const };

    // Resolve the target grid inside the lock so it can't vanish under us.
    let resolvedGridId: string | null = null;
    if (gridId) {
      const g = await tx<Array<{ id: string }>>`
        select id from grids where id = ${gridId} and project_id = ${projectId} limit 1
      `;
      resolvedGridId = g[0]?.id ?? null;
    }
    if (!resolvedGridId) {
      const g = await tx<Array<{ id: string }>>`
        select id from grids where project_id = ${projectId}
        order by sort_order asc, created_at asc limit 1
      `;
      resolvedGridId = g[0]?.id ?? null;
    }
    if (!resolvedGridId) return { ok: false as const, reason: "no_grid" as const };

    const elementType = resolveElementType(element);
    const content = buildElementContent(elementType, element);

    const orderRows = await tx<Array<{ next_order: number }>>`
      select coalesce(max(sort_order) + 1, 0) as next_order
      from screen_elements where grid_id = ${resolvedGridId}
    `;
    const sortOrder = Number(orderRows[0]?.next_order ?? 0);

    const rows = await tx<ElementRow[]>`
      insert into screen_elements
        (grid_id, element_type, name, x_pos, y_pos, x_scale, y_scale, content, sort_order)
      values (
        ${resolvedGridId}, ${elementType}, ${element.name ?? ""},
        ${num(element.x_pos)}, ${num(element.y_pos)},
        ${num(element.x_scale, 1)}, ${num(element.y_scale, 1)},
        ${sql.json(content as any)}, ${sortOrder}
      )
      returning id, grid_id, element_type, name, x_pos, y_pos, x_scale, y_scale, content
    `;
    const row = rows[0];
    if (!row) return { ok: false as const, reason: "no_grid" as const };

    if (elementType === "ToDoLst" && Array.isArray(element.scheduled_tasks)) {
      for (let ti = 0; ti < element.scheduled_tasks.length; ti++) {
        const t = element.scheduled_tasks[ti]!;
        await tx`
          insert into tasks
            (element_id, taskname, priority, is_done, time, notified,
             calendar_event_id, creation_time, sort_order, status)
          values (
            ${row.id}, ${t.taskname ?? ""},
            ${typeof t.priority === "number" ? t.priority : parseInt(t.priority, 10) || 2},
            ${!!t.is_done}, ${toTimestampOrNull(t.time)}, ${!!t.notified},
            ${t.calendar_event_id ?? null},
            ${toTimestampOrNull(t.creation_time) ?? new Date().toISOString()}, ${ti},
            ${normalizeStatus(t.status, !!t.is_done)}
          )
        `;
      }
    }

    return { ok: true as const, gridId: resolvedGridId, row };
  });

  if (!result.ok) return result;
  // Serialize AFTER commit so any freshly-inserted ToDoLst tasks are visible.
  return { ok: true, gridId: result.gridId, element: await serializeElementRow(result.row) };
}

/**
 * Update a single element's transform (position + scale). Returns true if a row
 * was updated. Only fields that are provided (non-undefined) are written.
 */
export async function updateElementTransform(
  elementId: string,
  transform: {
    x_pos?: number;
    y_pos?: number;
    x_scale?: number;
    y_scale?: number;
  }
): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    update screen_elements set
      x_pos   = ${transform.x_pos !== undefined ? num(transform.x_pos) : sql`x_pos`},
      y_pos   = ${transform.y_pos !== undefined ? num(transform.y_pos) : sql`y_pos`},
      x_scale = ${transform.x_scale !== undefined ? num(transform.x_scale, 1) : sql`x_scale`},
      y_scale = ${transform.y_scale !== undefined ? num(transform.y_scale, 1) : sql`y_scale`}
    where id = ${elementId}
    returning id
  `;
  return rows.length > 0;
}

/**
 * Merge a partial content patch into an element's JSONB `content` (shallow
 * merge via jsonb ||). Returns true if a row was updated.
 */
export async function updateElementContent(
  elementId: string,
  contentPatch: Record<string, unknown>
): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    update screen_elements
    set content = content || ${sql.json(contentPatch as any)}
    where id = ${elementId}
    returning id
  `;
  return rows.length > 0;
}

/**
 * Read a single element's JSONB `content` (or null if the row is missing).
 * Used by the B3 ydoc registry to hydrate the authoritative server Y.Doc from
 * the persisted `content.ydoc` on first access.
 */
export async function getElementContent(
  elementId: string
): Promise<Record<string, any> | null> {
  const rows = await sql<Array<{ content: any }>>`
    select content from screen_elements where id = ${elementId}
  `;
  const row = rows[0];
  if (!row) return null;
  return (row.content ?? {}) as Record<string, any>;
}

/** Delete a single element (CASCADE removes its tasks). Returns true if removed. */
export async function deleteElement(elementId: string): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    delete from screen_elements where id = ${elementId} returning id
  `;
  return rows.length > 0;
}

/**
 * Resolve the first grid id of a project by name + type. Element `create` ops
 * that don't carry a gridId can fall back to the project's first grid.
 */
export async function findFirstGridId(
  name: string,
  projectType: ProjectType
): Promise<string | null> {
  const project = await findProjectRow(name, projectType);
  if (!project) return null;
  const rows = await sql<Array<{ id: string }>>`
    select id from grids where project_id = ${project.id}
    order by sort_order asc, created_at asc
    limit 1
  `;
  return rows.length > 0 ? rows[0]!.id : null;
}

// ─── LIST / DELETE ───────────────────────────────────────────────────────────

export interface ProjectListItem {
  name: string;
  owner_name: string;
  filename: string;
  projectType: ProjectType;
  gridCount: number;
  lastModified: string;
}

/** List projects of a type with the metadata shape the frontend expects. */
export async function listProjects(
  projectType: ProjectType
): Promise<ProjectListItem[]> {
  const rows = await sql<
    Array<{
      name: string;
      owner_username: string;
      updated_at: Date;
      grid_count: string;
    }>
  >`
    select p.name,
           u.username as owner_username,
           p.updated_at,
           count(g.id) as grid_count
    from projects p
    join users u on u.id = p.owner_id
    left join grids g on g.project_id = p.id
    where p.project_type = ${projectType}
    group by p.id, u.username
    order by p.updated_at desc
  `;
  return rows.map((r) => ({
    name: r.name,
    owner_name: r.owner_username,
    filename: `${r.name}.json`,
    projectType,
    gridCount: Number(r.grid_count),
    lastModified: r.updated_at.toISOString(),
  }));
}

/** Delete a project by name + type. Returns true if a row was removed. */
export async function deleteProject(
  name: string,
  projectType: ProjectType
): Promise<boolean> {
  const rows = await sql<Array<{ id: string }>>`
    delete from projects
    where name = ${name} and project_type = ${projectType}
    returning id
  `;
  return rows.length > 0;
}
