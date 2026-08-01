/**
 * Two-user end-to-end smoke test for the chat feature.
 *
 * Registers alice + bob (and carol, who shares no project), seeds a shared
 * project so alice/bob are collaborators, then drives the real Socket.IO chat
 * contract with two clients and asserts delivery, history, DM auth, unread,
 * edit, and delete. Cleans up its users (cascades) at the end.
 *
 *   npx tsx --tsconfig socket-server/tsconfig.json socket-server/scripts/chat-smoke.ts
 */
import "../src/loadenv.js";
import { io, Socket } from "socket.io-client";
import { sql } from "../src/infrastructure/db.js";

const BASE = "http://localhost:3000";
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
  console.log(`\n🔎 Chat smoke test (suffix ${suffix})\n`);

  const alice = await register(`alice_${suffix}`);
  const bob = await register(`bob_${suffix}`);
  const carol = await register(`carol_${suffix}`);
  console.log(`registered: ${alice.username}, ${bob.username}, ${carol.username}`);

  // Seed a project owned by alice, with bob as an editor collaborator.
  const projectName = `smoke_${suffix}`;
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
  console.log(`seeded shared project ${projectName} (alice owner, bob editor)\n`);

  const a = await connect(alice.token);
  const b = await connect(bob.token);
  const c = await connect(carol.token);

  // Both join the project room so project-channel broadcasts reach them.
  const ja = await emitAck(a, "joinProjectRoom", { projectName, projectType });
  const jb = await emitAck(b, "joinProjectRoom", { projectName, projectType });
  check("both join project room", ja?.success === true && jb?.success === true, JSON.stringify({ ja, jb }));

  // 1) Project channel: alice sends, bob receives the broadcast.
  const gotProj = waitFor(b, "chat:message", (d) => d?.message?.body === "hello team");
  const sendProj = await emitAck(a, "chat:send", { scope: "project", projectName, projectType, body: "hello team" });
  const projMsg = await gotProj;
  check("project send acked", sendProj?.success === true, JSON.stringify(sendProj));
  check("project message broadcast to peer", projMsg?.message?.author === alice.username);
  const projMsgId = sendProj?.message?.id;

  // 2) History returns the message.
  const hist = await emitAck(a, "chat:history", { scope: "project", projectName, projectType });
  check("project history contains message", Array.isArray(hist?.messages) && hist.messages.some((m: any) => m.id === projMsgId));

  // 3) DM: alice -> bob, bob receives.
  const gotDm = waitFor(b, "chat:message", (d) => d?.message?.scope === "dm" && d?.message?.body === "hi bob");
  const sendDm = await emitAck(a, "chat:send", { scope: "dm", to: bob.username, body: "hi bob" });
  const dmMsg = await gotDm;
  check("DM send acked", sendDm?.success === true, JSON.stringify(sendDm));
  check("DM delivered to recipient", dmMsg?.message?.author === alice.username);

  // 4) DM auth: carol shares no project with alice -> rejected.
  const badDm = await emitAck(c, "chat:send", { scope: "dm", to: alice.username, body: "spam" });
  check("DM to non-collaborator rejected", badDm?.success === false, JSON.stringify(badDm));

  // 5) Conversations: bob sees alice with the last DM body.
  const convos = await emitAck(b, "chat:conversations", {});
  check("bob's conversation list shows alice",
    Array.isArray(convos?.conversations) && convos.conversations.some((cv: any) => cv.partner === alice.username && cv.lastBody === "hi bob"));

  // 6) Unread: bob has an unread project message from alice, then clears it.
  const unread1 = await emitAck(b, "chat:unread", { projectName, projectType });
  check("bob has project unread > 0", (unread1?.count ?? 0) >= 1, JSON.stringify(unread1));
  await emitAck(b, "chat:read", { scope: "project", projectName, projectType });
  const unread2 = await emitAck(b, "chat:unread", { projectName, projectType });
  check("project unread cleared after read", (unread2?.count ?? 0) === 0, JSON.stringify(unread2));

  // 7) Edit: alice edits her project message, bob sees the update.
  const gotEdit = waitFor(b, "chat:message:updated", (d) => d?.message?.id === projMsgId);
  const edit = await emitAck(a, "chat:edit", { scope: "project", projectName, projectType, id: projMsgId, body: "hello team!" });
  const editEvt = await gotEdit;
  check("edit acked + stamped", edit?.success === true && !!edit?.message?.edited_at);
  check("edit broadcast to peer", editEvt?.message?.body === "hello team!");

  // 8) Delete: alice deletes it, bob sees the removal.
  const gotDel = waitFor(b, "chat:message:deleted", (d) => d?.id === projMsgId);
  const del = await emitAck(a, "chat:delete", { scope: "project", projectName, projectType, id: projMsgId });
  const delEvt = await gotDel;
  check("delete acked", del?.success === true);
  check("delete broadcast to peer", delEvt?.id === projMsgId);

  // 9) Start call: alice mints ONE shared link; bob receives a chat message
  //    carrying the SAME link (everyone joins the same room). No Google token in
  //    the smoke env, so this exercises the Jitsi fallback path.
  const CALL_URL_RE = /https?:\/\/(?:meet\.google\.com|meet\.jit\.si)\/\S+/;
  const gotCall = waitFor(
    b,
    "chat:message",
    (d) => d?.message?.scope === "project" && CALL_URL_RE.test(d?.message?.body ?? "")
  );
  const startCall = await emitAck(a, "chat:call:start", { scope: "project", projectName, projectType });
  const callEvt = await gotCall;
  check("call start acked with link", startCall?.success === true && CALL_URL_RE.test(startCall?.link ?? ""), JSON.stringify(startCall));
  check("call link posted to conversation for peer", (callEvt?.message?.body ?? "").includes(startCall?.link));
  check("everyone gets the SAME room", startCall?.link === (callEvt?.message?.body ?? "").match(CALL_URL_RE)?.[0]);

  a.close(); b.close(); c.close();

  // Cleanup: removing the users cascades to the project, collaborators, messages.
  await sql`delete from users where id in (${alice.id}, ${bob.id}, ${carol.id})`;
  await sql`delete from chat_reads where reader in (${alice.username}, ${bob.username}, ${carol.username})`;

  console.log(`\n📊 ${passed} passed, ${failed} failed\n`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\n💥 Smoke test crashed:", err);
  try { await sql.end(); } catch {}
  process.exit(1);
});
