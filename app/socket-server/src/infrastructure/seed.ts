/**
 * Development seed script — inserts demo data so a freshly-migrated database is
 * immediately usable.
 *
 *   npm run db:seed                 (tsx src/infrastructure/seed.ts)
 *   node dist/infrastructure/seed.js
 *
 * Creates:
 *   - one demo user (email/password login; password_hash is bcryptjs, matching
 *     the real registration path in src/services/auth.service.ts — same lib and
 *     the same cost factor of 10 rounds).
 *   - one sample "local" project owned by that user, with a grid, one Text
 *     document, one ToDoLst element, and a couple of demo tasks.
 *
 * Everything uses upserts (ON CONFLICT DO NOTHING / DO UPDATE) so the script is
 * safe to run repeatedly — it will not duplicate rows.
 *
 * Reuses the shared `sql` handle from infrastructure/db.ts; no new connection.
 */
import "../loadenv.js"; // load socket-server/.env before config/db read process.env
import bcrypt from "bcryptjs";
import { sql } from "./db.js";

// Must match auth.service.ts (BCRYPT_ROUNDS = 10) so the demo password verifies
// through the real login path.
const BCRYPT_ROUNDS = 10;

const DEMO = {
  username: "demo",
  email: "demo@clarity.local",
  password: "demo1234", // >= 6 chars (auth.service.ts minimum)
  projectName: "Getting Started",
  projectType: "local" as const,
};

export async function main(): Promise<void> {
  console.log("🌱  Seeding demo data …");

  const passwordHash = await bcrypt.hash(DEMO.password, BCRYPT_ROUNDS);

  // ─── User ──────────────────────────────────────────────────────────────────
  // Upsert on email; refresh the password_hash so re-runs keep credentials valid
  // even if the row already existed without one (e.g. created via ensureUser).
  const [user] = await sql<Array<{ id: string; created: boolean }>>`
    insert into users (username, email, password_hash)
    values (${DEMO.username}, ${DEMO.email}, ${passwordHash})
    on conflict (email) do update
      set password_hash = coalesce(users.password_hash, excluded.password_hash)
    returning id, (xmax = 0) as created
  `;
  if (!user) throw new Error("failed to upsert demo user");
  console.log(
    "   %s user %s <%s> (id=%s)",
    user.created ? "➕ created" : "↺ existing",
    DEMO.username,
    DEMO.email,
    user.id
  );

  // ─── Project ─────────────────────────────────────────────────────────────────
  // Unique on (owner_id, name, project_type).
  const [project] = await sql<Array<{ id: string; created: boolean }>>`
    insert into projects (name, owner_id, project_type)
    values (${DEMO.projectName}, ${user.id}, ${DEMO.projectType})
    on conflict (owner_id, name, project_type) do update
      set updated_at = now()
    returning id, (xmax = 0) as created
  `;
  if (!project) throw new Error("failed to upsert demo project");
  console.log(
    "   %s project '%s' (id=%s)",
    project.created ? "➕ created" : "↺ existing",
    DEMO.projectName,
    project.id
  );

  // ─── Grid ────────────────────────────────────────────────────────────────────
  // grids has no natural unique key, so guard on (project_id, name) manually to
  // stay re-runnable.
  const [grid] = await sql<Array<{ id: string }>>`
    with existing as (
      select id from grids
      where project_id = ${project.id} and name = 'Main' limit 1
    ), inserted as (
      insert into grids (project_id, name, sort_order)
      select ${project.id}, 'Main', 0
      where not exists (select 1 from existing)
      returning id
    )
    select id from inserted
    union all
    select id from existing
    limit 1
  `;
  if (!grid) throw new Error("failed to upsert demo grid");
  const gridId = grid.id;
  console.log("   grid 'Main' (id=%s)", gridId);

  // ─── Screen elements ─────────────────────────────────────────────────────────
  // Same manual guard pattern keyed on (grid_id, name).
  async function upsertElement(
    name: string,
    elementType: "Text_document" | "ToDoLst",
    x: number,
    content: Record<string, unknown>,
    sortOrder: number
  ): Promise<string> {
    const [row] = await sql<Array<{ id: string }>>`
      with existing as (
        select id from screen_elements
        where grid_id = ${gridId} and name = ${name} limit 1
      ), inserted as (
        insert into screen_elements
          (grid_id, element_type, name, x_pos, y_pos, content, sort_order)
        select ${gridId}, ${elementType}, ${name}, ${x}, 40,
               ${sql.json(content as any)}, ${sortOrder}
        where not exists (select 1 from existing)
        returning id
      )
      select id from inserted
      union all
      select id from existing
      limit 1
    `;
    if (!row) throw new Error(`failed to upsert element ${name}`);
    return row.id;
  }

  await upsertElement(
    "Welcome",
    "Text_document",
    40,
    { Text_field: "Welcome to Clarity! This is a seeded demo project." },
    0
  );

  const todoId = await upsertElement(
    "Onboarding Tasks",
    "ToDoLst",
    360,
    { collaborators: [], tags: ["demo"] },
    1
  );
  console.log("   elements: 'Welcome' (Text_document), 'Onboarding Tasks' (ToDoLst)");

  // ─── Tasks (rows of the ToDoLst element) ─────────────────────────────────────
  // tasks has no natural unique key; guard on (element_id, taskname).
  async function upsertTask(
    taskname: string,
    priority: number,
    isDone: boolean,
    sortOrder: number
  ): Promise<void> {
    await sql`
      insert into tasks (element_id, taskname, priority, is_done, sort_order)
      select ${todoId}, ${taskname}, ${priority}, ${isDone}, ${sortOrder}
      where not exists (
        select 1 from tasks
        where element_id = ${todoId} and taskname = ${taskname}
      )
    `;
  }

  await upsertTask("Explore the canvas", 1, false, 0);
  await upsertTask("Create your first project", 2, false, 1);
  await upsertTask("Sign in with the demo account", 3, true, 2);
  console.log("   tasks: 3 demo tasks on 'Onboarding Tasks'");

  console.log("\n✅  Seed complete.");
  console.log("   Demo login  ->  email: %s   password: %s", DEMO.email, DEMO.password);
  console.log("               (username '%s' also works as the login identifier)", DEMO.username);
}

// Run when invoked directly (tsx or `node dist/infrastructure/seed.js`).
const invoked = process.argv[1]
  ? process.argv[1].split(/[\\/]/).pop()?.replace(/\.[cm]?[jt]s$/, "") ?? ""
  : "";
if (invoked === "seed") {
  main()
    .then(() => sql.end())
    .catch(async (err) => {
      console.error("❌  Seed failed:", err);
      await sql.end();
      process.exit(1);
    });
}
