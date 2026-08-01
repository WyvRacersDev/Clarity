/**
 * Socket.IO integration test for the collab gateway (B3) — collaborative text
 * (Yjs) for Text_document co-editing.
 *
 * Boots the SAME in-process pieces as the B1 collab test (real `socketAuth` +
 * real `registerCollabGateway`), connects TWO authenticated clients into one
 * project room, and drives the real Yjs sync protocol between them:
 *
 *   1. `ydoc:update` from A relays the raw update to B (broadcast-except-sender)
 *      and B, applying it to its own Y.Doc, converges on the same text.
 *   2. The authoritative server doc PERSISTS to Postgres — `content.ydoc`
 *      (base64) + a `Text_field` plain-text mirror — verified by reload.
 *   3. `ydoc:sync` lets a LATE joiner (a fresh empty Y.Doc) catch up to the full
 *      server state.
 *   4. CONCURRENT edits from both tabs MERGE (no last-write-wins clobbering) —
 *      the CRDT property B3 exists to provide.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import type { Socket as ServerSocket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import * as Y from "yjs";

import { sql } from "@src/infrastructure/db.js";
import { socketAuth } from "@src/middleware/socketAuth.js";
import { register as registerCollabGateway } from "@src/realtime/collab.gateway.js";
import { CollabService } from "@src/services/collab.service.js";
import { PresenceRegistry } from "@src/realtime/presence.registry.js";
import { flushPersist, _resetRegistry } from "@src/realtime/ydoc-registry.js";
import type { GatewayDeps, Identity } from "@src/realtime/types.js";
import { ProjectHandler } from "@services/project.service.js";
import { UserHandler } from "@services/user.service.js";
import { issueJwt } from "@src/services/auth.service.js";
import { ensureUser } from "@src/repositories/identity.repository.js";
import {
  saveProject,
  loadProject,
  findFirstGridId,
} from "@src/repositories/project.repository.js";

let server: http.Server;
let io: Server;
let port: number;

const createdUsers = new Set<string>();

function unique(prefix: string): string {
  return `test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

function once<T = any>(socket: ClientSocket, event: string, ms = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for '${event}'`)), ms);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function emitAck<T = any>(socket: ClientSocket, event: string, payload: any, ms = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ack of '${event}'`)), ms);
    socket.emit(event, payload, (ack: T) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

beforeAll(async () => {
  server = http.createServer();
  io = new Server(server);
  io.use(socketAuth);

  const project_handler = new ProjectHandler();
  const user_handler = new UserHandler();

  io.on("connection", (socket: ServerSocket) => {
    const identity = (payloadName?: string): Identity => {
      if (socket.data.user) {
        return { username: socket.data.user.username, email: socket.data.user.email };
      }
      return { username: payloadName, email: payloadName };
    };
    const deps: GatewayDeps = {
      project_handler,
      user_handler,
      storage: {} as any,
      collab: new CollabService(),
      presence: new PresenceRegistry(),
      identity,
    };
    registerCollabGateway(io, socket, deps);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterEach(async () => {
  _resetRegistry(); // drop in-memory Y.Docs so tests don't share state
  for (const username of createdUsers) {
    await sql`delete from users where username = ${username}`;
  }
  createdUsers.clear();
});

afterAll(async () => {
  io.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sql.end();
});

function connect(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      auth: { token },
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

/** Seed an owner + a local project with one empty grid and a Text_document. */
async function seedTextDoc(): Promise<{ token: string; room: any; elementId: string }> {
  const username = unique("ydoc_owner");
  createdUsers.add(username);
  const owner = await ensureUser(username);
  const projectName = unique("ydoc_proj");
  await saveProject(
    {
      owner_name: username,
      name: projectName,
      projectType: "local",
      grid: [{ name: "Main", Screen_elements: [] }],
      lastModified: new Date().toISOString(),
    },
    "local"
  );
  const gridId = await findFirstGridId(projectName, "local");
  const token = issueJwt({ id: owner.id, username: owner.username, email: owner.email });
  const room = { projectName, projectType: "local" as const };

  // Create the element up front (via a throwaway socket) to get a stable id.
  const seed = await connect(token);
  await emitAck(seed, "joinProjectRoom", room);
  const createAck = await emitAck(seed, "element:create", {
    ...room,
    gridId,
    element: { type: "Text_document", name: "Doc", x_pos: 0, y_pos: 0, Text_field: "" },
  });
  seed.close();
  return { token, room, elementId: createAck.element.id };
}

describe("collab.gateway — collaborative text / Yjs (B3, 2 clients)", () => {
  it("relays a Yjs update to the peer and persists ydoc + Text_field mirror", async () => {
    const { token, room, elementId } = await seedTextDoc();
    const tabA = await connect(token);
    const tabB = await connect(token);
    try {
      await emitAck(tabA, "joinProjectRoom", room);
      await emitAck(tabB, "joinProjectRoom", room);

      // A types into its local Y.Doc and ships the update.
      const docA = new Y.Doc();
      docA.getText("content").insert(0, "Hello world");

      const updatedOnB = once(tabB, "ydoc:updated");
      const ack = await emitAck(tabA, "ydoc:update", {
        ...room,
        elementId,
        update: b64(Y.encodeStateAsUpdate(docA)),
      });
      expect(ack.success).toBe(true);

      // B receives the raw update and converges on the same text.
      const relayed = await updatedOnB;
      expect(relayed.elementId).toBe(elementId);
      const docB = new Y.Doc();
      Y.applyUpdate(docB, unb64(relayed.update));
      expect(docB.getText("content").toString()).toBe("Hello world");

      // Server persisted the encoded doc + plain-text mirror.
      await flushPersist(elementId);
      const loaded = await loadProject(room.projectName, "local");
      const el = loaded!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
      expect(el.Text_field).toBe("Hello world");
      expect(typeof el.ydoc).toBe("string");
      expect(el.ydoc.length).toBeGreaterThan(0);
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it("ydoc:sync catches a late joiner up to the full server state", async () => {
    const { token, room, elementId } = await seedTextDoc();
    const tabA = await connect(token);
    try {
      await emitAck(tabA, "joinProjectRoom", room);
      const docA = new Y.Doc();
      docA.getText("content").insert(0, "Shared notes");
      await emitAck(tabA, "ydoc:update", {
        ...room,
        elementId,
        update: b64(Y.encodeStateAsUpdate(docA)),
      });

      // Late joiner with an EMPTY doc requests sync and catches up.
      const docLate = new Y.Doc();
      const sv = b64(Y.encodeStateVector(docLate));
      const syncAck = await emitAck(tabA, "ydoc:sync", { ...room, elementId, stateVector: sv });
      expect(syncAck.success).toBe(true);
      Y.applyUpdate(docLate, unb64(syncAck.update));
      expect(docLate.getText("content").toString()).toBe("Shared notes");
    } finally {
      tabA.close();
    }
  });

  it("merges CONCURRENT edits from both tabs (no last-write-wins clobbering)", async () => {
    const { token, room, elementId } = await seedTextDoc();
    const tabA = await connect(token);
    const tabB = await connect(token);
    try {
      await emitAck(tabA, "joinProjectRoom", room);
      await emitAck(tabB, "joinProjectRoom", room);

      // Both start from the same (empty) base and edit concurrently.
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      docA.getText("content").insert(0, "AAA");
      docB.getText("content").insert(0, "BBB");

      await emitAck(tabA, "ydoc:update", { ...room, elementId, update: b64(Y.encodeStateAsUpdate(docA)) });
      await emitAck(tabB, "ydoc:update", { ...room, elementId, update: b64(Y.encodeStateAsUpdate(docB)) });

      // The authoritative server doc contains BOTH edits (order is deterministic
      // per the CRDT, but both substrings must survive — nothing was clobbered).
      await flushPersist(elementId);
      const loaded = await loadProject(room.projectName, "local");
      const el = loaded!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
      expect(el.Text_field).toContain("AAA");
      expect(el.Text_field).toContain("BBB");
      expect(el.Text_field.length).toBe(6);
    } finally {
      tabA.close();
      tabB.close();
    }
  });
});
