/**
 * Two-user end-to-end smoke test for E8 — canvas version history / restore.
 *
 * Registers alice + bob (collaborators on a shared project) and carol (no
 * access), seeds a project with one canvas element, then drives the real
 * Socket.IO snapshot contract with two clients and asserts:
 *   create (manual) → ack + broadcast, list, restore → reverts state + broadcast +
 *   a safety "Before restore" auto snapshot, and edit-authorization (carol
 *   rejected). Additionally exercises the repository auto-snapshot path directly
 *   to prove content de-dup + throttle (a no-op / rapid save doesn't spam).
 * Cleans up its users (cascades to project/grids/elements/snapshots) at the end.
 *
 *   npx tsx --tsconfig socket-server/tsconfig.json socket-server/scripts/snapshot-smoke.ts
 */
import "../src/loadenv.js";
import { io, Socket } from "socket.io-client";
import { sql } from "../src/infrastructure/db.js";
import { maybeAutoSnapshot } from "../src/repositories/snapshot.repository.js";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const suffix = Date.now().toString(36);
const PW = "pw123456";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${detail}`); }
}

async function register(username: string): Promise<{ id: string; username: string; token: string }> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@t.local`, password: PW }),
  });
  if (!res.ok) throw new Error(`register ${username} failed: ${res.status} ${await res.text()}`);
  const { token, user } = await res.json();
  return { id: user.id, username: user.username, token };
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, forceNew: true, transports: ["websocket"] });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 8000);
  });
}

function emitAck(s: Socket, event: string, payload: any, ms = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} ack timeout`)), ms);
    s.emit(event, payload, (ack: any) => { clearTimeout(t); resolve(ack); });
  });
}

/** Wait for the next `event` on `s` matching `pred`, else reject after ms. */
function waitFor(s: Socket, event: string, pred: (d: any) => boolean, ms = 6000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.off(event, h); reject(new Error(`${event} not received`)); }, ms);
    const h = (d: any) => { if (pred(d)) { clearTimeout(t); s.off(event, h); resolve(d); } };
    s.on(event, h);
  });
}

/** Current (x_pos, y_pos) of every element in the project, by joining grids. */
async function elementPositions(projectId: string): Promise<Array<{ id: string; x: number; y: number }>> {
  const rows = await sql<Array<{ id: string; x_pos: number; y_pos: number }>>`
    select e.id, e.x_pos, e.y_pos
    from screen_elements e
    join grids g on g.id = e.grid_id
    where g.project_id = ${projectId}
  `;
  return rows.map((r) => ({ id: r.id, x: Number(r.x_pos), y: Number(r.y_pos) }));
}

async function countAutoSnapshots(projectId: string): Promise<number> {
  const rows = await sql<Array<{ n: number }>>`
    select count(*)::int as n from project_snapshots
    where project_id = ${projectId} and kind = 'auto'
  `;
  return rows[0]!.n;
}

async function main(): Promise<void> {
  console.log(`\n🔎 E8 snapshot smoke test (suffix ${suffix})\n`);

  const alice = await register(`alice_${suffix}`);
  const bob = await register(`bob_${suffix}`);
  const carol = await register(`carol_${suffix}`);
  console.log(`registered: ${alice.username}, ${bob.username}, ${carol.username}`);

  // Seed a project owned by alice, bob as editor, one grid + one element at a
  // KNOWN position (100, 200) so restore can be asserted precisely.
  const projectName = `vsmoke_${suffix}`;
  const projectType = "local";
  const [proj] = await sql<Array<{ id: string }>>`
    insert into projects (name, owner_id, project_type)
    values (${projectName}, ${alice.id}, ${projectType})
    returning id
  `;
  const projectId = proj!.id;
  await sql`
    insert into project_collaborators (project_id, user_id, role)
    values (${projectId}, ${bob.id}, 'editor')
  `;
  const [grid] = await sql<Array<{ id: string }>>`
    insert into grids (project_id, name) values (${projectId}, 'Canvas') returning id
  `;
  const [element] = await sql<Array<{ id: string }>>`
    insert into screen_elements (grid_id, element_type, name, x_pos, y_pos)
    values (${grid!.id}, 'ToDoLst', 'Sprint tasks', 100, 200)
    returning id
  `;
  const elementId = element!.id;
  console.log(`seeded project ${projectName} + element ${elementId} @ (100,200)\n`);

  const a = await connect(alice.token);
  const b = await connect(bob.token);
  const c = await connect(carol.token);

  const ja = await emitAck(a, "joinProjectRoom", { projectName, projectType });
  const jb = await emitAck(b, "joinProjectRoom", { projectName, projectType });
  check("both join project room", ja?.success === true && jb?.success === true, JSON.stringify({ ja, jb }));

  // 1) Manual create: alice saves version "v1"; bob receives the broadcast.
  const gotCreated = waitFor(b, "snapshot:created", (d) => d?.snapshot?.kind === "manual");
  const created = await emitAck(a, "snapshot:create", { projectName, projectType, label: "v1" });
  const createdEvt = await gotCreated;
  check("create acked with snapshot", created?.success === true && !!created?.snapshot?.id, JSON.stringify(created));
  check("snapshot is a manual checkpoint labelled v1", created?.snapshot?.kind === "manual" && created?.snapshot?.label === "v1");
  check("createdBy derived server-side", created?.snapshot?.createdBy === alice.username);
  check("create broadcast to peer (same id)", createdEvt?.snapshot?.id === created?.snapshot?.id);
  const v1Id = created?.snapshot?.id;

  // 2) List: v1 is in the timeline.
  const list1 = await emitAck(a, "snapshot:list", { projectName, projectType });
  check("list returns v1", Array.isArray(list1?.snapshots) && list1.snapshots.some((x: any) => x.id === v1Id), JSON.stringify(list1));

  // 3) Mutate the canvas: move the element to (999, 999).
  const moved = await emitAck(a, "element:move", { projectName, projectType, elementId, x_pos: 999, y_pos: 999 });
  check("element moved to (999,999)", moved?.success === true);
  const afterMove = await elementPositions(projectId);
  check("db reflects the move", afterMove.length === 1 && afterMove[0]!.x === 999 && afterMove[0]!.y === 999, JSON.stringify(afterMove));

  // 4) Restore v1: canvas reverts to (100,200); bob is told to reload.
  const gotRestored = waitFor(b, "snapshot:restored", (d) => d?.snapshotId === v1Id);
  const restored = await emitAck(a, "snapshot:restore", { projectName, projectType, snapshotId: v1Id });
  const restoredEvt = await gotRestored;
  check("restore acked", restored?.success === true, JSON.stringify(restored));
  check("restore broadcast carries restoredBy", restoredEvt?.restoredBy === alice.username, JSON.stringify(restoredEvt));
  const afterRestore = await elementPositions(projectId);
  check("canvas reverted to (100,200)", afterRestore.length === 1 && afterRestore[0]!.x === 100 && afterRestore[0]!.y === 200, JSON.stringify(afterRestore));

  // 4b) Restore is itself reversible — a "Before restore" auto snapshot exists.
  const list2 = await emitAck(a, "snapshot:list", { projectName, projectType });
  check("a 'Before restore' safety version was saved",
    Array.isArray(list2?.snapshots) && list2.snapshots.some((x: any) => x.label === "Before restore" && x.kind === "auto"),
    JSON.stringify(list2?.snapshots?.map((s: any) => ({ label: s.label, kind: s.kind }))));

  // 5) Auto-snapshot dedup + throttle (repository-level). Age out the versions
  // created above so the throttle window is clear for the first insert.
  await sql`update project_snapshots set created_at = now() - interval '2 minutes' where project_id = ${projectId}`;
  const baseAuto = await countAutoSnapshots(projectId);
  const payloadA = { owner_name: alice.username, name: projectName, projectType, grid: [{ name: "Canvas", Screen_elements: [{ id: elementId, type: "ToDoLst", name: "Sprint tasks", x_pos: 100, y_pos: 200 }] }], lastModified: "x" };
  await maybeAutoSnapshot(payloadA as any, projectType);
  const afterFirstAuto = await countAutoSnapshots(projectId);
  check("auto-snapshot writes a new version on change", afterFirstAuto === baseAuto + 1, `${baseAuto} -> ${afterFirstAuto}`);

  await maybeAutoSnapshot(payloadA as any, projectType); // identical content
  check("auto-snapshot de-dups an unchanged save", (await countAutoSnapshots(projectId)) === afterFirstAuto);

  const payloadB = { ...payloadA, grid: [{ name: "Canvas", Screen_elements: [] }] }; // different content, same window
  await maybeAutoSnapshot(payloadB as any, projectType);
  check("auto-snapshot throttles rapid saves in the window", (await countAutoSnapshots(projectId)) === afterFirstAuto);

  // 6) Auth: carol has no access → every snapshot op is rejected.
  const badCreate = await emitAck(c, "snapshot:create", { projectName, projectType, label: "intruder" });
  const badList = await emitAck(c, "snapshot:list", { projectName, projectType });
  const badRestore = await emitAck(c, "snapshot:restore", { projectName, projectType, snapshotId: v1Id });
  check("create by non-collaborator rejected", badCreate?.success === false, JSON.stringify(badCreate));
  check("list by non-collaborator rejected", badList?.success === false, JSON.stringify(badList));
  check("restore by non-collaborator rejected", badRestore?.success === false, JSON.stringify(badRestore));

  a.close(); b.close(); c.close();

  // Cleanup: removing the users cascades to project/grids/elements/snapshots.
  await sql`delete from users where id in (${alice.id}, ${bob.id}, ${carol.id})`;

  console.log(`\n📊 ${passed} passed, ${failed} failed\n`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\n💥 Smoke test crashed:", err);
  try { await sql.end(); } catch {}
  process.exit(1);
});
