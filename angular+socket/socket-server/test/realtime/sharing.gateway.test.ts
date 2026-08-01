/**
 * Socket.IO integration test for the sharing gateway (N1) — the exact wire
 * contract the frontend Share dialog uses.
 *
 * Boots a minimal in-process server wiring the real socketAuth handshake + the
 * real sharing AND collab gateways (so edit-gating is exercised end to end), then:
 *   - an OWNER invites an existing user by email → immediate membership (ack),
 *   - that VIEWER is denied an edit op (element:create) by the collab gateway,
 *   - after the owner upgrades them to EDITOR the same op is authorized,
 *   - a non-manager (editor) is denied a manage op (sharing:invite).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import type { Socket as ServerSocket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

import { sql } from "@src/infrastructure/db.js";
import { socketAuth } from "@src/middleware/socketAuth.js";
import { register as registerSharingGateway } from "@src/realtime/sharing.gateway.js";
import { register as registerCollabGateway } from "@src/realtime/collab.gateway.js";
import { CollabService } from "@services/collab.service.js";
import { SharingService } from "@services/sharing.service.js";
import { PresenceRegistry } from "@src/realtime/presence.registry.js";
import type { GatewayDeps, Identity } from "@src/realtime/types.js";
import { issueJwt } from "@services/auth.service.js";
import { ensureUser } from "@src/repositories/identity.repository.js";
import { saveProject } from "@src/repositories/project.repository.js";

let server: http.Server;
let io: Server;
let port: number;
const createdUsers = new Set<string>();

function unique(prefix: string): string {
  return `test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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

function connect(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}`, { transports: ["websocket"], forceNew: true, auth: { token } });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

async function makeUser(prefix: string): Promise<{ username: string; email: string; token: string; id: string }> {
  const row = await ensureUser(unique(prefix));
  createdUsers.add(row.username);
  const token = issueJwt({ id: row.id, username: row.username, email: row.email });
  return { username: row.username, email: row.email, token, id: row.id };
}

beforeAll(async () => {
  server = http.createServer();
  io = new Server(server);
  io.use(socketAuth);

  const collab = new CollabService();
  const sharing = new SharingService();

  io.on("connection", (socket: ServerSocket) => {
    const identity = (payloadName?: string): Identity =>
      socket.data.user
        ? { username: socket.data.user.username, email: socket.data.user.email }
        : { username: payloadName, email: payloadName };
    const deps = {
      collab,
      sharing,
      presence: new PresenceRegistry(),
      identity,
    } as unknown as GatewayDeps;
    registerSharingGateway(io, socket, deps);
    registerCollabGateway(io, socket, deps);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  io.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const username of createdUsers) await sql`delete from users where username = ${username}`;
  await sql.end();
});

describe("sharing gateway (N1)", () => {
  it("owner invites → member; viewer edit denied → editor edit allowed; non-manager manage denied", async () => {
    const owner = await makeUser("owner");
    const alice = await makeUser("alice");

    const projectName = unique("proj");
    await saveProject(
      {
        owner_name: owner.username,
        name: projectName,
        projectType: "local",
        grid: [{ name: "Grid 1", Screen_elements: [] }],
        lastModified: new Date().toISOString(),
      },
      "local"
    );

    const ownerSock = await connect(owner.token);
    const aliceSock = await connect(alice.token);
    const target = { projectName, projectType: "local" as const };
    const element = { type: "Text_document", name: "t", x_pos: 0, y_pos: 0, x_scale: 1, y_scale: 1, Text_field: "" };

    try {
      // Owner invites Alice as a viewer → immediate membership.
      const invite = await emitAck(ownerSock, "sharing:invite", { ...target, email: alice.email, role: "viewer" });
      expect(invite.success).toBe(true);
      expect(invite.kind).toBe("member");
      expect(invite.member.username).toBe(alice.username);

      // Viewer cannot edit — collab gateway rejects element:create.
      const denied = await emitAck(aliceSock, "element:create", { ...target, element });
      expect(denied.success).toBe(false);

      // Owner promotes Alice to editor.
      const promote = await emitAck(ownerSock, "sharing:updateRole", { ...target, userId: alice.id, role: "editor" });
      expect(promote.success).toBe(true);

      // Now the same edit is authorized (a grid exists, so it persists).
      const allowed = await emitAck(aliceSock, "element:create", { ...target, element });
      expect(allowed.success).toBe(true);

      // A non-manager (editor) cannot manage sharing.
      const manageDenied = await emitAck(aliceSock, "sharing:invite", { ...target, email: "someone@example.com", role: "viewer" });
      expect(manageDenied.success).toBe(false);
    } finally {
      ownerSock.close();
      aliceSock.close();
    }
  });

  it("link sharing grants view access to a stranger", async () => {
    const owner = await makeUser("owner2");
    const stranger = await makeUser("stranger2");
    const projectName = unique("proj2");
    await saveProject(
      { owner_name: owner.username, name: projectName, projectType: "local", grid: [], lastModified: new Date().toISOString() },
      "local"
    );

    const ownerSock = await connect(owner.token);
    const strangerSock = await connect(stranger.token);
    const target = { projectName, projectType: "local" as const };
    try {
      // Before: stranger cannot even read sharing state.
      const before = await emitAck(strangerSock, "sharing:get", target);
      expect(before.success).toBe(false);

      // Owner enables viewer link sharing.
      const setLink = await emitAck(ownerSock, "sharing:setLink", { ...target, role: "viewer" });
      expect(setLink.success).toBe(true);
      expect(setLink.link.role).toBe("viewer");
      expect(setLink.link.token).toBeTruthy();

      // Now the stranger has view access (can read sharing state) but not manage.
      const after = await emitAck(strangerSock, "sharing:get", target);
      expect(after.success).toBe(true);
      const cantManage = await emitAck(strangerSock, "sharing:setLink", { ...target, role: "editor" });
      expect(cantManage.success).toBe(false);
    } finally {
      ownerSock.close();
      strangerSock.close();
    }
  });
});
