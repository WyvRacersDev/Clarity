/**
 * Socket.IO integration test for the notification gateway (N2) — the wire
 * contract the bell/inbox + activity feed use, plus the durable fan-out written
 * by the sharing and comment write-sites.
 *
 * Boots a minimal in-process server wiring the real socketAuth handshake + the
 * sharing AND notification gateways, then:
 *   - an OWNER invites an existing user → that user gets a durable `project_shared`
 *     notification (visible via notification:list; unreadCount = 1),
 *   - markRead / markAllRead drive the unread count to 0,
 *   - the project's activity feed surfaces the member-added event,
 *   - recordCommentNotifications fans a comment out to participants: a `mention`
 *     row for the @mentioned user, a `comment` row for the other collaborator,
 *     and NOTHING for the author.
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
import { register as registerNotificationGateway } from "@src/realtime/notification.gateway.js";
import { CollabService } from "@services/collab.service.js";
import { SharingService } from "@services/sharing.service.js";
import { NotificationCenterService } from "@services/notification-center.service.js";
import { PresenceRegistry } from "@src/realtime/presence.registry.js";
import type { GatewayDeps, Identity } from "@src/realtime/types.js";
import { issueJwt } from "@services/auth.service.js";
import { ensureUser } from "@src/repositories/identity.repository.js";
import { saveProject } from "@src/repositories/project.repository.js";

let server: http.Server;
let io: Server;
let port: number;
const notifications = new NotificationCenterService();
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
      notifications,
      presence: new PresenceRegistry(),
      identity,
    } as unknown as GatewayDeps;
    registerSharingGateway(io, socket, deps);
    registerNotificationGateway(io, socket, deps);
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
  for (const username of createdUsers) {
    await sql`delete from notifications where recipient = ${username}`;
    await sql`delete from users where username = ${username}`;
  }
  await sql.end();
});

async function projectIdByName(name: string): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`select id from projects where name = ${name} limit 1`;
  return rows[0]!.id;
}

describe("notification gateway (N2)", () => {
  it("sharing an existing user writes a durable project_shared notification; mark-read clears it; feed shows the member", async () => {
    const owner = await makeUser("n2owner");
    const alice = await makeUser("n2alice");

    const projectName = unique("n2proj");
    await saveProject(
      { owner_name: owner.username, name: projectName, projectType: "local", grid: [], lastModified: new Date().toISOString() },
      "local"
    );

    const ownerSock = await connect(owner.token);
    const aliceSock = await connect(alice.token);
    const target = { projectName, projectType: "local" as const };

    try {
      // Owner invites Alice (existing user) → immediate membership + N2 push.
      const invite = await emitAck(ownerSock, "sharing:invite", { ...target, email: alice.email, role: "editor" });
      expect(invite.success).toBe(true);
      expect(invite.kind).toBe("member");

      // Alice's inbox now has one unread project_shared notification.
      const list = await emitAck(aliceSock, "notification:list", {});
      expect(list.success).toBe(true);
      expect(list.unreadCount).toBe(1);
      const shared = list.notifications.find((n: any) => n.type === "project_shared");
      expect(shared).toBeTruthy();
      expect(shared.projectName).toBe(projectName);
      expect(shared.actor).toBe(owner.username);
      expect(shared.read).toBe(false);

      // Mark it read → unread count drops to 0.
      const marked = await emitAck(aliceSock, "notification:markRead", { id: shared.id });
      expect(marked.success).toBe(true);
      expect(marked.unreadCount).toBe(0);

      const after = await emitAck(aliceSock, "notification:unreadCount", {});
      expect(after.count).toBe(0);

      // The project's activity feed shows Alice being added (member_added).
      const feed = await emitAck(ownerSock, "notification:feed", target);
      expect(feed.success).toBe(true);
      const added = feed.items.find((i: any) => i.kind === "member_added" && i.actor === alice.username);
      expect(added).toBeTruthy();
      expect(added.detail).toBe("editor");
    } finally {
      ownerSock.close();
      aliceSock.close();
    }
  });

  it("recordCommentNotifications: mention row for the mentioned user, comment row for other participants, nothing for the author", async () => {
    const owner = await makeUser("n2cowner");
    const alice = await makeUser("n2calice");
    const bob = await makeUser("n2cbob");

    const projectName = unique("n2cproj");
    await saveProject(
      { owner_name: owner.username, name: projectName, projectType: "local", grid: [], lastModified: new Date().toISOString() },
      "local"
    );
    const projectId = await projectIdByName(projectName);

    // Make Alice + Bob collaborators (participants) via the sharing gateway.
    const ownerSock = await connect(owner.token);
    const target = { projectName, projectType: "local" as const };
    try {
      await emitAck(ownerSock, "sharing:invite", { ...target, email: alice.email, role: "editor" });
      await emitAck(ownerSock, "sharing:invite", { ...target, email: bob.email, role: "editor" });
    } finally {
      ownerSock.close();
    }

    // Owner comments and @mentions Alice.
    await notifications.recordCommentNotifications(io, {
      projectId,
      projectName,
      projectType: "local",
      author: owner.username,
      body: `Heads up @${alice.username}, please review`,
      mentioned: [alice.username],
    });

    // Alice: exactly one mention (no duplicate comment row).
    const aliceRows = await notifications.list(alice.username);
    expect(aliceRows.filter((n) => n.type === "mention")).toHaveLength(1);
    expect(aliceRows.filter((n) => n.type === "comment")).toHaveLength(0);

    // Bob (other participant): a comment row.
    const bobRows = await notifications.list(bob.username);
    expect(bobRows.filter((n) => n.type === "comment")).toHaveLength(1);

    // Owner (author): nothing — you're never notified of your own comment.
    const ownerRows = await notifications.list(owner.username);
    expect(ownerRows).toHaveLength(0);
  });
});
