/**
 * N8 — integration proof that the server Y.Doc is AUTHORITATIVE on a whole-project
 * save, closing the B3 stale-snapshot limit.
 *
 * Scenario: a Text_document is being co-edited (a live server Y.Doc holds "Live
 * edit"), while some out-of-band caller still holds a STALE in-memory snapshot of
 * the same project (older text, e.g. an AI `create_task` save or a canvas save of
 * a different element). Before the fix, that whole-project save wrote the stale
 * text straight over the live collaborative content. Now `ProjectHandler.saveProject`
 * reconciles each Text_document against the registry first, so live edits survive.
 *
 * These use the real repository + the real ydoc-registry (no socket server needed:
 * the registry singleton is shared in-process, exactly as in the running app).
 */
import { randomUUID } from "node:crypto";
import { afterEach, afterAll, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { sql } from "@src/infrastructure/db.js";
import { ensureUser } from "@src/repositories/identity.repository.js";
import { saveProject, loadProject } from "@src/repositories/project.repository.js";
import { ProjectHandler } from "@services/project.service.js";
import { Project } from "@models/project.model.js";
import { Text_document } from "@models/screen-elements.model.js";
import { applyUpdate, flushPersist, _resetRegistry } from "@src/realtime/ydoc-registry.js";

const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const createdUsers = new Set<string>();

function unique(prefix: string): string {
  return `test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

/** Seed an owner + a local project with one grid holding a Text_document (stable id). */
async function seedProjectWithTextDoc(
  initialText: string
): Promise<{ username: string; projectName: string; elementId: string }> {
  const username = unique("n8_owner");
  createdUsers.add(username);
  await ensureUser(username);
  const projectName = unique("n8_proj");
  const elementId = randomUUID();
  await saveProject(
    {
      owner_name: username,
      name: projectName,
      projectType: "local",
      grid: [
        {
          name: "Main",
          Screen_elements: [
            { type: "Text_document", id: elementId, name: "Doc", x_pos: 0, y_pos: 0, Text_field: initialText },
          ],
        },
      ],
    } as any,
    "local"
  );
  return { username, projectName, elementId };
}

/** Build the STALE in-memory snapshot a whole-project save would carry. */
function staleSnapshot(
  username: string,
  projectName: string,
  elementId: string,
  staleText: string
): Project {
  const project = new Project(projectName, username, "local");
  project.create_grid("Main");
  const doc = new Text_document("Doc", 0, 0, staleText); // no ydoc — a plain-text snapshot
  doc.id = elementId;
  project.grid[0]!.add_element(doc);
  return project;
}

afterEach(async () => {
  _resetRegistry();
  for (const username of createdUsers) {
    await sql`delete from users where username = ${username}`;
  }
  createdUsers.clear();
});

afterAll(async () => {
  await sql.end();
});

describe("whole-project save vs live Y.Doc (N8 / B3)", () => {
  it("does NOT clobber live collaborative text with a stale snapshot", async () => {
    const { username, projectName, elementId } = await seedProjectWithTextDoc("");

    // A live co-editing session advances the authoritative server doc.
    const live = new Y.Doc();
    live.getText("content").insert(0, "Live edit");
    await applyUpdate(elementId, b64(Y.encodeStateAsUpdate(live)));
    await flushPersist(elementId);

    // An out-of-band whole-project save fires with an OLDER snapshot of the doc.
    const handler = new ProjectHandler();
    const saved = await handler.saveProject(
      staleSnapshot(username, projectName, elementId, "stale offline edit"),
      "local"
    );
    expect(saved.success).toBe(true);

    // The live edit survives; the stale text did not win.
    const reloaded = await loadProject(projectName, "local");
    const el = reloaded!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
    expect(el.Text_field).toBe("Live edit");
    expect(el.Text_field).not.toBe("stale offline edit");
    expect(typeof el.ydoc).toBe("string");
    expect(el.ydoc.length).toBeGreaterThan(0);
  });

  it("keeps a non-empty snapshot when the resident doc is an un-seeded empty (no clobber-to-empty)", async () => {
    const { username, projectName, elementId } = await seedProjectWithTextDoc("legacy text");

    // A doc becomes resident but stays EMPTY (e.g. a viewer opened it; it was
    // never seeded from the legacy Text_field). It must not wipe the real text.
    const empty = new Y.Doc();
    await applyUpdate(elementId, b64(Y.encodeStateAsUpdate(empty)));

    const handler = new ProjectHandler();
    await handler.saveProject(
      staleSnapshot(username, projectName, elementId, "legacy text"),
      "local"
    );

    const reloaded = await loadProject(projectName, "local");
    const el = reloaded!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
    expect(el.Text_field).toBe("legacy text");
  });
});
