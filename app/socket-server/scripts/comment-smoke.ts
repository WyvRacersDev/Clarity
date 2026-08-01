/**
 * Two-user end-to-end smoke test for E6 — canvas comment pins.
 *
 * Registers alice + bob (collaborators on a shared project) and carol (no
 * access), seeds a project with one canvas element, then drives the real
 * Socket.IO comment contract with two clients and asserts:
 *   create → broadcast, list, @mention live push, resolve → broadcast,
 *   delete → broadcast, and edit-authorization (carol rejected).
 * Cleans up its users (cascades to project/grids/elements/comments) at the end.
 *
 *   npx tsx --tsconfig socket-server/tsconfig.json socket-server/scripts/comment-smoke.ts
 */
import "../src/loadenv.js";
import { io, Socket } from "socket.io-client";
import { sql } from "../src/infrastructure/db.js";

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

async function main(): Promise<void> {
  console.log(`\n🔎 E6 comment smoke test (suffix ${suffix})\n`);

  const alice = await register(`alice_${suffix}`);
  const bob = await register(`bob_${suffix}`);
  const carol = await register(`carol_${suffix}`);
  console.log(`registered: ${alice.username}, ${bob.username}, ${carol.username}`);

  // Seed a project owned by alice, with bob as an editor collaborator, plus one
  // grid and one canvas element to pin comments to.
  const projectName = `csmoke_${suffix}`;
  const projectType = "local";
  const [proj] = await sql<Array<{ id: string }>>`
    insert into projects (name, owner_id, project_type)
    values (${projectName}, ${alice.id}, ${projectType})
    returning id
  `;
  await sql`
    insert into project_collaborators (project_id, user_id, role)
    values (${proj!.id}, ${bob.id}, 'editor')
  `;
  const [grid] = await sql<Array<{ id: string }>>`
    insert into grids (project_id, name) values (${proj!.id}, 'Canvas') returning id
  `;
  const [element] = await sql<Array<{ id: string }>>`
    insert into screen_elements (grid_id, element_type, name)
    values (${grid!.id}, 'ToDoLst', 'Sprint tasks')
    returning id
  `;
  const elementId = element!.id;
  console.log(`seeded project ${projectName} + element ${elementId}\n`);

  const a = await connect(alice.token);
  const b = await connect(bob.token);
  const c = await connect(carol.token);

  const ja = await emitAck(a, "joinProjectRoom", { projectName, projectType });
  const jb = await emitAck(b, "joinProjectRoom", { projectName, projectType });
  check("both join project room", ja?.success === true && jb?.success === true, JSON.stringify({ ja, jb }));

  // 1) Create: alice pins a comment; bob receives the broadcast with same id.
  const gotCreate = waitFor(b, "comment:created", (d) => d?.comment?.elementId === elementId);
  const created = await emitAck(a, "comment:create", { projectName, projectType, elementId, body: "needs a review" });
  const createEvt = await gotCreate;
  check("create acked with comment", created?.success === true && !!created?.comment?.id, JSON.stringify(created));
  check("comment author derived server-side", created?.comment?.author === alice.username);
  check("create broadcast to peer (same id)", createEvt?.comment?.id === created?.comment?.id);
  const commentId = created?.comment?.id;

  // 2) List: the comment is returned for the project, open (not resolved).
  const list1 = await emitAck(a, "comment:list", { projectName, projectType });
  const listed = Array.isArray(list1?.comments) && list1.comments.find((x: any) => x.id === commentId);
  check("list returns the comment", !!listed, JSON.stringify(list1));
  check("comment starts unresolved", !!listed && listed.resolvedBy === null);

  // 3) @mention: a comment naming bob delivers a live mention push to bob.
  const gotMention = waitFor(b, "mention:notified", (d) => d?.elementId === elementId && d?.author === alice.username);
  const mentioned = await emitAck(a, "comment:create", { projectName, projectType, elementId, body: `@${bob.username} thoughts?` });
  const mentionEvt = await gotMention;
  check("mention comment acked", mentioned?.success === true);
  check("mentioned user gets live push", mentionEvt?.author === alice.username, JSON.stringify(mentionEvt));

  // 4) Resolve: alice resolves the first comment; bob sees it, resolvedBy set.
  const gotResolve = waitFor(b, "comment:resolved", (d) => d?.comment?.id === commentId);
  const resolved = await emitAck(a, "comment:resolve", { projectName, projectType, commentId, resolved: true });
  const resolveEvt = await gotResolve;
  check("resolve acked + stamped", resolved?.success === true && resolved?.comment?.resolvedBy === alice.username, JSON.stringify(resolved));
  check("resolve broadcast to peer", resolveEvt?.comment?.resolvedBy === alice.username);

  // 5) Delete: alice deletes the comment; bob sees the removal (with elementId).
  const gotDelete = waitFor(b, "comment:deleted", (d) => d?.commentId === commentId);
  const deleted = await emitAck(a, "comment:delete", { projectName, projectType, commentId });
  const deleteEvt = await gotDelete;
  check("delete acked", deleted?.success === true);
  check("delete broadcast carries elementId", deleteEvt?.elementId === elementId);
  const list2 = await emitAck(a, "comment:list", { projectName, projectType });
  check("deleted comment gone from list", Array.isArray(list2?.comments) && !list2.comments.some((x: any) => x.id === commentId));

  // 6) Auth: carol shares no access to this project -> create rejected.
  const badCreate = await emitAck(c, "comment:create", { projectName, projectType, elementId, body: "intruder" });
  check("comment by non-collaborator rejected", badCreate?.success === false, JSON.stringify(badCreate));

  a.close(); b.close(); c.close();

  // Cleanup: removing the users cascades to project/grids/elements/comments.
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
