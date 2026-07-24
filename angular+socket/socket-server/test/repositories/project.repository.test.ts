/**
 * Integration tests for the project repository (whole-project save/load/list +
 * the Phase-6b granular element ops).
 *
 * Runs against the REAL local Postgres. Each test owns a unique test user +
 * project; afterEach deletes the user (CASCADE clears projects/grids/elements/
 * tasks), so the demo seed is untouched and the suite is re-runnable.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sql } from "@src/infrastructure/db.js";
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  insertElement,
  updateElementTransform,
  updateElementContent,
  deleteElement,
  findFirstGridId,
  type SerializedProject,
} from "@src/repositories/project.repository.js";

const createdUsers = new Set<string>();

function unique(prefix: string): string {
  return `test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

async function purge(): Promise<void> {
  for (const username of createdUsers) {
    await sql`delete from users where username = ${username}`;
  }
  createdUsers.clear();
}

afterEach(purge);
afterAll(async () => {
  await purge();
  await sql.end();
});

function sampleProject(owner: string, name: string): SerializedProject {
  return {
    owner_name: owner,
    name,
    projectType: "local",
    grid: [
      {
        name: "Main",
        Screen_elements: [
          {
            type: "Text_document",
            name: "note",
            x_pos: 10,
            y_pos: 20,
            x_scale: 1,
            y_scale: 1,
            Text_field: "hello world",
          },
        ],
      },
    ],
    lastModified: new Date().toISOString(),
  };
}

describe("project.repository — whole-project save/load", () => {
  it("saveProject then loadProject round-trips the serialized shape", async () => {
    const owner = unique("proj_owner");
    createdUsers.add(owner);
    const projectName = unique("proj");

    const projectId = await saveProject(sampleProject(owner, projectName), "local");
    expect(projectId).toBeTruthy();

    const loaded = await loadProject(projectName, "local");
    expect(loaded).not.toBeNull();
    expect(loaded!.owner_name).toBe(owner);
    expect(loaded!.name).toBe(projectName);
    expect(loaded!.projectType).toBe("local");
    expect(loaded!.grid).toHaveLength(1);
    expect(loaded!.grid[0]!.name).toBe("Main");

    const el = loaded!.grid[0]!.Screen_elements[0];
    expect(el.type).toBe("Text_document");
    expect(el.Text_field).toBe("hello world");
    expect(el.x_pos).toBe(10);
    expect(el.id).toBeTruthy(); // stable element uuid assigned
  });

  it("saveProject upserts on (owner, name, type) — no duplicate project row", async () => {
    const owner = unique("proj_upsert_owner");
    createdUsers.add(owner);
    const projectName = unique("proj_upsert");

    const firstId = await saveProject(sampleProject(owner, projectName), "local");
    const secondId = await saveProject(sampleProject(owner, projectName), "local");
    expect(secondId).toBe(firstId);

    const count = await sql<Array<{ n: string }>>`
      select count(*) as n from projects where name = ${projectName}
    `;
    expect(Number(count[0]!.n)).toBe(1);
  });

  it("loadProject returns null for a missing project", async () => {
    const loaded = await loadProject(unique("nope"), "local");
    expect(loaded).toBeNull();
  });

  it("listProjects includes a saved local project with grid count and filename", async () => {
    const owner = unique("proj_list_owner");
    createdUsers.add(owner);
    const projectName = unique("proj_list");
    await saveProject(sampleProject(owner, projectName), "local");

    const items = await listProjects("local");
    const mine = items.find((p) => p.name === projectName);
    expect(mine).toBeDefined();
    expect(mine!.owner_name).toBe(owner);
    expect(mine!.projectType).toBe("local");
    expect(mine!.filename).toBe(`${projectName}.json`);
    expect(mine!.gridCount).toBe(1);
  });

  it("deleteProject removes the project (returns true, then false)", async () => {
    const owner = unique("proj_del_owner");
    createdUsers.add(owner);
    const projectName = unique("proj_del");
    await saveProject(sampleProject(owner, projectName), "local");

    expect(await deleteProject(projectName, "local")).toBe(true);
    expect(await loadProject(projectName, "local")).toBeNull();
    expect(await deleteProject(projectName, "local")).toBe(false);
  });
});

describe("project.repository — granular element ops (Phase 6b)", () => {
  it("insert / update transform / update content / delete a single element", async () => {
    const owner = unique("elem_owner");
    createdUsers.add(owner);
    const projectName = unique("elem_proj");
    await saveProject(sampleProject(owner, projectName), "local");

    const gridId = await findFirstGridId(projectName, "local");
    expect(gridId).toBeTruthy();

    // INSERT — appends a new element with a fresh stable id.
    const inserted = await insertElement(gridId!, {
      type: "Text_document",
      name: "added",
      x_pos: 1,
      y_pos: 2,
      Text_field: "first",
    });
    expect(inserted).not.toBeNull();
    expect(inserted.id).toBeTruthy();
    expect(inserted.Text_field).toBe("first");

    // UPDATE TRANSFORM — only provided fields change.
    expect(
      await updateElementTransform(inserted.id, { x_pos: 99, y_scale: 2 })
    ).toBe(true);

    // UPDATE CONTENT — shallow merge into JSONB content.
    expect(
      await updateElementContent(inserted.id, { Text_field: "second" })
    ).toBe(true);

    const reloaded = await loadProject(projectName, "local");
    const el = reloaded!.grid[0]!.Screen_elements.find(
      (e: any) => e.id === inserted.id
    );
    expect(el).toBeDefined();
    expect(el.x_pos).toBe(99);
    expect(el.y_scale).toBe(2);
    expect(el.Text_field).toBe("second");

    // DELETE — removes exactly that element.
    expect(await deleteElement(inserted.id)).toBe(true);
    const afterDelete = await loadProject(projectName, "local");
    expect(
      afterDelete!.grid[0]!.Screen_elements.find((e: any) => e.id === inserted.id)
    ).toBeUndefined();
  });

  it("insertElement returns null for an unknown grid id", async () => {
    // A well-formed but non-existent uuid.
    const result = await insertElement("00000000-0000-0000-0000-000000000000", {
      type: "Text_document",
      Text_field: "x",
    });
    expect(result).toBeNull();
  });
});
