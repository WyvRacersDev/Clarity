/**
 * Socket.IO integration test for the collab gateway (Phase 6b / B1) —
 * granular per-element realtime ops.
 *
 * This is the automatable form of the "live 2-tab browser testing" B1 called
 * for: we boot a MINIMAL in-process Socket.IO server wiring the same production
 * pieces the real server uses (the real `socketAuth` handshake middleware + the
 * real `registerCollabGateway`), connect TWO authenticated clients ("tab A" and
 * "tab B") into the same project room, and assert that each granular op:
 *   1. acks the sender with the authoritative result (id for create), and
 *   2. broadcasts to the OTHER tab (not echoed to the sender), and
 *   3. is PERSISTED to Postgres (verified by reloading the project).
 *
 * Presence is asserted on join. Everything (server + both clients + DB handle)
 * is torn down so the process exits cleanly.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import type { Socket as ServerSocket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

import { sql } from "@src/infrastructure/db.js";
import { socketAuth } from "@src/middleware/socketAuth.js";
import { register as registerCollabGateway } from "@src/realtime/collab.gateway.js";
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

/** Resolve on the next occurrence of `event`, or reject after `ms`. */
function once<T = any>(socket: ClientSocket, event: string, ms = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for '${event}'`)), ms);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/** Emit `event` and resolve with the server ack. */
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

  // Same handshake auth the production server installs.
  io.use(socketAuth);

  const project_handler = new ProjectHandler();
  const user_handler = new UserHandler();

  io.on("connection", (socket: ServerSocket) => {
    // Identity resolver mirrors src/index.ts: JWT-first, legacy-payload fallback.
    const identity = (payloadName?: string): Identity => {
      if (socket.data.user) {
        return { username: socket.data.user.username, email: socket.data.user.email };
      }
      return { username: payloadName, email: payloadName };
    };
    const deps: GatewayDeps = {
      project_handler,
      user_handler,
      storage: {} as any, // not touched by the collab gateway
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

describe("collab.gateway — granular per-element realtime (2 clients)", () => {
  it("create/move/update/delete round-trip: broadcasts to the peer and persists to Postgres", async () => {
    // Seed one owner + a local project with a single empty grid.
    const username = unique("collab_owner");
    createdUsers.add(username);
    const owner = await ensureUser(username);
    const projectName = unique("collab_proj");
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
    expect(gridId).toBeTruthy();

    const token = issueJwt({ id: owner.id, username: owner.username, email: owner.email });
    // Two "tabs" for the same user (the canonical local 2-tab scenario).
    const tabA = await connect(token);
    const tabB = await connect(token);

    try {
      const room = { projectName, projectType: "local" as const };

      // --- Join: both tabs join, presence reflects two members. ---
      const joinA = await emitAck(tabA, "joinProjectRoom", room);
      expect(joinA.success).toBe(true);

      // tabA should be notified when tabB joins (presence broadcast).
      const presenceOnB = once(tabB, "presence:update");
      const joinB = await emitAck(tabB, "joinProjectRoom", room);
      expect(joinB.success).toBe(true);
      const presence = await presenceOnB;
      expect(presence.users.some((u: any) => u.username === username)).toBe(true);

      // --- CREATE on A -> ack carries the authoritative id; B receives it. ---
      const createdOnB = once(tabB, "element:created");
      const createAck = await emitAck(tabA, "element:create", {
        ...room,
        gridId,
        element: { type: "Text_document", name: "Note", x_pos: 10, y_pos: 20, Text_field: "hello" },
      });
      expect(createAck.success).toBe(true);
      expect(createAck.element?.id).toBeTruthy();
      const elementId: string = createAck.element.id;

      const bCreated = await createdOnB;
      expect(bCreated.element.id).toBe(elementId); // peer sees the same id

      // Persisted?
      let loaded = await loadProject(projectName, "local");
      let el = loaded!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
      expect(el).toBeDefined();
      expect(el.Text_field).toBe("hello");

      // --- MOVE on A -> B receives; persisted. ---
      const movedOnB = once(tabB, "element:moved");
      const moveAck = await emitAck(tabA, "element:move", {
        ...room,
        elementId,
        x_pos: 111,
        y_pos: 222,
      });
      expect(moveAck.success).toBe(true);
      const bMoved = await movedOnB;
      expect(bMoved.elementId).toBe(elementId);
      expect(bMoved.x_pos).toBe(111);

      loaded = await loadProject(projectName, "local");
      el = loaded!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
      expect(el.x_pos).toBe(111);
      expect(el.y_pos).toBe(222);

      // --- UPDATE content on A -> B receives; persisted (JSONB merge). ---
      const updatedOnB = once(tabB, "element:updated");
      const updateAck = await emitAck(tabA, "element:update", {
        ...room,
        elementId,
        content: { Text_field: "edited" },
      });
      expect(updateAck.success).toBe(true);
      const bUpdated = await updatedOnB;
      expect(bUpdated.elementId).toBe(elementId);
      expect(bUpdated.content.Text_field).toBe("edited");

      loaded = await loadProject(projectName, "local");
      el = loaded!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
      expect(el.Text_field).toBe("edited");

      // --- DELETE on A -> B receives; row gone. ---
      const deletedOnB = once(tabB, "element:deleted");
      const deleteAck = await emitAck(tabA, "element:delete", { ...room, elementId });
      expect(deleteAck.success).toBe(true);
      const bDeleted = await deletedOnB;
      expect(bDeleted.elementId).toBe(elementId);

      loaded = await loadProject(projectName, "local");
      el = loaded!.grid[0]!.Screen_elements.find((e: any) => e.id === elementId);
      expect(el).toBeUndefined();
    } finally {
      tabA.close();
      tabB.close();
    }
  });

  it("the sender does NOT receive its own element ops (broadcast-except-sender)", async () => {
    const username = unique("collab_solo");
    createdUsers.add(username);
    const owner = await ensureUser(username);
    const projectName = unique("collab_proj");
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
    const tabA = await connect(token);

    try {
      const room = { projectName, projectType: "local" as const };
      await emitAck(tabA, "joinProjectRoom", room);

      // Register a listener that MUST NOT fire for the sender's own create.
      let echoed = false;
      tabA.on("element:created", () => {
        echoed = true;
      });

      const createAck = await emitAck(tabA, "element:create", {
        ...room,
        gridId,
        element: { type: "Text_document", name: "Solo", x_pos: 0, y_pos: 0, Text_field: "x" },
      });
      expect(createAck.success).toBe(true);

      // Give any (erroneous) echo a moment to arrive.
      await new Promise((r) => setTimeout(r, 200));
      expect(echoed).toBe(false);
    } finally {
      tabA.close();
    }
  });
});
