/**
 * E10 reconnect verify — the automatable form of the "drop network mid-drag,
 * reconnect → no dupes, no lost moves" browser test.
 *
 * Drives TWO real Socket.IO clients against the RUNNING server (localhost:3000)
 * and proves the exact server-side contract the frontend CollabService relies
 * on across a genuine transport drop + auto-reconnect:
 *
 *   1. baseline: a create on A broadcasts to B (both in the room);
 *   2. B's transport is dropped (engine.close) and Socket.IO auto-reconnects —
 *      B is now a FRESH server socket in NO room, so a move on A does NOT reach
 *      it (this is the gap CollabService.resyncAfterReconnect closes);
 *   3. after B RE-JOINS the room, a move on A DOES reach B (no lost move);
 *   4. replaying the create with the SAME opId dedups → exactly one row persists
 *      and peers get no second broadcast (no dupe).
 *
 *   npx tsx --tsconfig socket-server/tsconfig.json socket-server/scripts/verify-reconnect.ts
 */
import "../src/loadenv.js";
import { randomUUID } from "node:crypto";
import { io, Socket } from "socket.io-client";
import { sql } from "../src/infrastructure/db.js";
import {
  saveProject,
  loadProject,
  findFirstGridId,
} from "../src/repositories/project.repository.js";

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

/** Resolve true if `event` matching `pred` arrives before `ms`, else false. */
function expectEvent(s: Socket, event: string, pred: (d: any) => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { s.off(event, h); resolve(false); }, ms);
    const h = (d: any) => { if (pred(d)) { clearTimeout(t); s.off(event, h); resolve(true); } };
    s.on(event, h);
  });
}

/** Wait for the next `connect` (reconnect) on `s`. */
function nextConnect(s: Socket, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("reconnect timeout")), ms);
    s.once("connect", () => { clearTimeout(t); resolve(); });
  });
}

async function main(): Promise<void> {
  console.log(`\n🔎 E10 reconnect verify (suffix ${suffix})\n`);

  const owner = await register(`recon_${suffix}`);
  const projectName = `recon_proj_${suffix}`;
  await saveProject(
    {
      owner_name: owner.username,
      name: projectName,
      projectType: "local",
      grid: [{ name: "Main", Screen_elements: [] }],
      lastModified: new Date().toISOString(),
    },
    "local"
  );
  const gridId = await findFirstGridId(projectName, "local");
  check("seeded project with a grid", !!gridId);

  const room = { projectName, projectType: "local" as const };
  const tabA = await connect(owner.token);
  const tabB = await connect(owner.token);

  try {
    await emitAck(tabA, "joinProjectRoom", room);
    await emitAck(tabB, "joinProjectRoom", room);
    check("both tabs joined the room", true);

    // 1) Baseline: create on A reaches B.
    const opId = `op_${randomUUID()}`;
    const createdOnB = expectEvent(tabB, "element:created", () => true, 6000);
    const createAck = await emitAck(tabA, "element:create", {
      ...room,
      gridId,
      opId,
      element: { type: "Text_document", name: "Drag", x_pos: 10, y_pos: 10, Text_field: "x" },
    });
    const elementId: string = createAck.element?.id;
    check("create acked with an id", !!elementId);
    check("peer B received element:created (baseline broadcast)", await createdOnB);

    // 2) Drop B's transport; Socket.IO auto-reconnects to a FRESH server socket.
    tabB.io.engine.close();
    await nextConnect(tabB);
    check("tab B auto-reconnected after transport drop", tabB.connected);

    // Without a rejoin, B is in no room: a move on A must NOT reach it.
    const leakWatch = expectEvent(tabB, "element:moved", (d) => d.elementId === elementId, 1200);
    await emitAck(tabA, "element:move", { ...room, elementId, x_pos: 500, y_pos: 500 });
    const leakedBeforeRejoin = await leakWatch;
    check("no ops leak to B before it re-joins (room was dropped)", leakedBeforeRejoin === false);

    // 3) B re-joins (what CollabService.resyncAfterReconnect does) → ops resume.
    await emitAck(tabB, "joinProjectRoom", room);
    const movedOnB = expectEvent(tabB, "element:moved", (d) => d.elementId === elementId && d.x_pos === 999, 6000);
    await emitAck(tabA, "element:move", { ...room, elementId, x_pos: 999, y_pos: 999 });
    check("after re-join, final move reaches B (no lost move)", await movedOnB);

    const reloadedMove = await loadProject(projectName, "local");
    const movedEl = reloadedMove!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
    check("final position persisted (x=999)", movedEl?.x_pos === 999);

    // 4) Replay the create with the SAME opId → dedup, no dupe row, no re-broadcast.
    let secondBroadcast = false;
    tabB.on("element:created", () => { secondBroadcast = true; });
    const replay = await emitAck(tabA, "element:create", {
      ...room,
      gridId,
      opId,
      element: { type: "Text_document", name: "Drag", x_pos: 10, y_pos: 10, Text_field: "x" },
    });
    check("replayed create acked deduped", replay.deduped === true && replay.element?.id === elementId);
    await new Promise((r) => setTimeout(r, 300));
    check("no second broadcast to peers on replay", secondBroadcast === false);

    const reloaded = await loadProject(projectName, "local");
    const count = reloaded!.grid[0]!.Screen_elements.filter((e: any) => e.id === elementId).length;
    check("exactly ONE row persisted (no dupe)", count === 1 && reloaded!.grid[0]!.Screen_elements.length === 1);
  } finally {
    tabA.close();
    tabB.close();
    await sql`delete from users where username = ${owner.username}`;
  }

  console.log(`\n${failed === 0 ? "✅" : "❌"} reconnect verify: ${passed} passed, ${failed} failed\n`);
  await sql.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("verify-reconnect crashed:", err);
  try { await sql.end(); } catch { /* ignore */ }
  process.exit(1);
});
