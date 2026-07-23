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

interface ProjectRow {
  id: string;
  name: string;
  owner_id: string;
  project_type: ProjectType;
  updated_at: Date;
  owner_username: string;
}

async function findProjectRow(
  name: string,
  projectType: ProjectType
): Promise<ProjectRow | null> {
  const rows = await sql<ProjectRow[]>`
    select p.id, p.name, p.owner_id, p.project_type, p.updated_at,
           u.username as owner_username
    from projects p
    join users u on u.id = p.owner_id
    where p.name = ${name} and p.project_type = ${projectType}
    limit 1
  `;
  return rows.length > 0 ? rows[0]! : null;
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
        screenElements.push({ ...base, Text_field: content.Text_field ?? "" });
      } else if (el.element_type === "Image") {
        screenElements.push({ ...base, imagepath: content.imagepath ?? "" });
      } else if (el.element_type === "Video") {
        screenElements.push({ ...base, VideoPath: content.VideoPath ?? "" });
      } else if (el.element_type === "ToDoLst") {
        const taskRows = await sql<
          Array<{
            taskname: string;
            priority: number;
            is_done: boolean;
            time: Date | null;
            completion_time: Date | null;
            completed_by_username: string | null;
            creation_time: Date | null;
            calendar_event_id: string | null;
            notified: boolean;
          }>
        >`
          select t.taskname, t.priority, t.is_done, t.time,
                 t.completion_time, t.creation_time, t.calendar_event_id,
                 t.notified, cu.username as completed_by_username
          from tasks t
          left join users cu on cu.id = t.completed_by
          where t.element_id = ${el.id}
          order by t.sort_order asc, t.creation_time asc
        `;

        const scheduled_tasks = taskRows.map((t) => ({
          type: "scheduled_task",
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
        }));

        screenElements.push({
          ...base,
          scheduled_tasks,
          collaborators: Array.isArray(content.collaborators)
            ? content.collaborators
            : [],
          tags: Array.isArray(content.tags) ? content.tags : [],
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

function toTimestampOrNull(v: any): string | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
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
    // UPSERT projects on (owner_id, name, project_type).
    const projRows = await tx<Array<{ id: string }>>`
      insert into projects (name, owner_id, project_type)
      values (${serialized.name}, ${owner.id}, ${projectType})
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

            await tx`
              insert into tasks
                (element_id, taskname, priority, is_done, time, completion_time,
                 completed_by, notified, calendar_event_id, creation_time, sort_order)
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
                ${ti}
              )
            `;
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
  if (
    el.type === "Text_document" ||
    el.type === "Image" ||
    el.type === "Video" ||
    el.type === "ToDoLst"
  ) {
    return el.type;
  }
  // Fall back to property detection (mirrors serializeProject logic).
  if (el.scheduled_tasks !== undefined && Array.isArray(el.scheduled_tasks))
    return "ToDoLst";
  if (el.imagepath !== undefined || el.imagePath !== undefined) return "Image";
  if (el.VideoPath !== undefined || el.videoPath !== undefined) return "Video";
  if (el.Text_field !== undefined || el.text_field !== undefined)
    return "Text_document";
  return "Text_document";
}

function buildElementContent(elementType: string, el: any): Record<string, unknown> {
  switch (elementType) {
    case "Text_document":
      return { Text_field: el.Text_field ?? el.text_field ?? "" };
    case "Image":
      return { imagepath: el.imagepath ?? el.imagePath ?? "" };
    case "Video":
      return { VideoPath: el.VideoPath ?? el.videoPath ?? "" };
    case "ToDoLst":
      return {
        collaborators: Array.isArray(el.collaborators) ? el.collaborators : [],
        tags: Array.isArray(el.tags) ? el.tags : [],
      };
    default:
      return {};
  }
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

  if (el.element_type === "Text_document") {
    return { ...base, Text_field: content.Text_field ?? "" };
  }
  if (el.element_type === "Image") {
    return { ...base, imagepath: content.imagepath ?? "" };
  }
  if (el.element_type === "Video") {
    return { ...base, VideoPath: content.VideoPath ?? "" };
  }
  if (el.element_type === "ToDoLst") {
    const taskRows = await sql<
      Array<{
        taskname: string;
        priority: number;
        is_done: boolean;
        time: Date | null;
        completion_time: Date | null;
        completed_by_username: string | null;
        creation_time: Date | null;
        calendar_event_id: string | null;
        notified: boolean;
      }>
    >`
      select t.taskname, t.priority, t.is_done, t.time,
             t.completion_time, t.creation_time, t.calendar_event_id,
             t.notified, cu.username as completed_by_username
      from tasks t
      left join users cu on cu.id = t.completed_by
      where t.element_id = ${el.id}
      order by t.sort_order asc, t.creation_time asc
    `;
    const scheduled_tasks = taskRows.map((t) => ({
      type: "scheduled_task",
      taskname: t.taskname,
      priority: t.priority,
      is_done: t.is_done,
      time: t.time ? t.time.toISOString() : "",
      completion_time: t.completion_time ? t.completion_time.toISOString() : null,
      completed_by: t.completed_by_username ?? null,
      creation_time: t.creation_time ? t.creation_time.toISOString() : "",
      calendar_event_id: t.calendar_event_id ?? null,
      notified: t.notified,
    }));
    return {
      ...base,
      scheduled_tasks,
      collaborators: Array.isArray(content.collaborators) ? content.collaborators : [],
      tags: Array.isArray(content.tags) ? content.tags : [],
    };
  }
  return { ...base, ...content };
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
           calendar_event_id, creation_time, sort_order)
        values (
          ${row.id}, ${t.taskname ?? ""},
          ${typeof t.priority === "number" ? t.priority : parseInt(t.priority, 10) || 2},
          ${!!t.is_done}, ${toTimestampOrNull(t.time)}, ${!!t.notified},
          ${t.calendar_event_id ?? null},
          ${toTimestampOrNull(t.creation_time) ?? new Date().toISOString()}, ${ti}
        )
      `;
    }
  }

  return await serializeElementRow(row);
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
