/**
 * Socket.IO contract integration test for the project gateway.
 *
 * Rather than boot the whole app (which needs GEMINI_API_KEY, the notification
 * cron, express static serving, CORS wiring, etc.), we construct a MINIMAL
 * in-process Socket.IO server that wires the SAME production pieces the real
 * server uses:
 *   - the real `socketAuth` handshake middleware (io.use)
 *   - the real `registerProjectGateway(io, socket, deps)` with a real
 *     ProjectHandler and the same JWT-first identity resolver as src/index.ts
 *
 * We then connect a real `socket.io-client`, perform the JWT handshake, and
 * exercise one representative round-trip — `listProjects` (local) — asserting
 * the emitted `projectsListed_local` payload matches the contract and is
 * owner-filtered. Server + client + DB handle are torn down so the process
 * exits cleanly.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import type { Socket as ServerSocket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

import { sql } from "@src/infrastructure/db.js";
import { socketAuth } from "@src/middleware/socketAuth.js";
import { register as registerProjectGateway } from "@src/realtime/project.gateway.js";
import type { GatewayDeps, Identity } from "@src/realtime/types.js";
import { ProjectHandler } from "@services/project.service.js";
import { UserHandler } from "@services/user.service.js";
import { issueJwt } from "@src/services/auth.service.js";
import { ensureUser } from "@src/repositories/identity.repository.js";
import { saveProject } from "@src/repositories/project.repository.js";

let server: http.Server;
let io: Server;
let port: number;

const createdUsers = new Set<string>();

function unique(prefix: string): string {
  return `test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
      // storage isn't touched by the project gateway; the contract test never
      // exercises a file path, so a minimal stub keeps the wiring honest.
      storage: {} as any,
      identity,
    };
    registerProjectGateway(io, socket, deps);
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

function connect(token?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      ...(token ? { auth: { token } } : {}),
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

describe("project.gateway — listProjects contract (authenticated)", () => {
  it("emits projectsListed_local with the caller's own project after a JWT handshake", async () => {
    // Seed a unique owner + one local project via the real repository.
    const username = unique("sock_owner");
    createdUsers.add(username);
    const owner = await ensureUser(username);
    const projectName = unique("sock_proj");
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

    const token = issueJwt({ id: owner.id, username: owner.username, email: owner.email });
    const client = await connect(token);

    try {
      const payload = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for projectsListed_local")), 8000);
        client.on("projectsListed_local", (data: any) => {
          clearTimeout(timer);
          resolve(data);
        });
        client.emit("listProjects", { projectType: "local" });
      });

      // Contract: { success, projects: [...], message }.
      expect(payload.success).toBe(true);
      expect(Array.isArray(payload.projects)).toBe(true);

      // Owner-filtered: our project is present and owned by us.
      const mine = payload.projects.find((p: any) => p.name === projectName);
      expect(mine).toBeDefined();
      expect(mine.owner_name).toBe(username);
      expect(mine.projectType).toBe("local");

      // Isolation: it must NOT contain another user's local projects (the demo
      // seed's "Getting Started" is owned by "demo", not us).
      const foreign = payload.projects.find((p: any) => p.owner_name !== username);
      expect(foreign).toBeUndefined();
    } finally {
      client.close();
    }
  });
});
