/**
 * Clarity backend bootstrap (Phase 6a).
 *
 * Thin entrypoint: create app + io, apply CORS + static serving, mount the HTTP
 * routers (src/http/*), install the Socket.IO handshake auth (io.use), start the
 * notification cron, and on each connection register the Socket.IO gateways
 * (src/realtime/*). All handler bodies now live in the gateways/routers — this
 * file only wires them together. Behavior (event names, response events,
 * broadcasts, permissive identity) is unchanged.
 */
// Load .env FIRST (resolved by module path, not CWD) so config/index.ts and
// everything downstream see env vars regardless of where the process started.
import './loadenv.js';

import express from "express";
import http from "http";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import cors from "cors";
import type { CorsOptions } from "cors";

import { ProjectHandler } from "@services/project.service.js";
import { UserHandler } from "@services/user.service.js";
import { Chat_Agent } from "@services/agent.service.js";
import { DiskStorageService } from "@services/storage/DiskStorageService.js";
import { startNotificationService, userRoom } from "@services/notification.service.js";
import {
  SERVER_HOST,
  SERVER_PORT,
  FRONTEND_URL,
  ALLOWED_ORIGINS,
  SOCKET_CORS_ORIGIN,
  IS_PRODUCTION,
  MAX_UPLOAD_BYTES,
  getExplicitAllowedOrigins,
} from "./config/index.js";
import { socketAuth } from "./middleware/socketAuth.js";
import { assertDbConnection } from "./infrastructure/db.js";

// HTTP routers
import { authRouter } from "./http/auth.routes.js";
import { googleRouter } from "./http/google.routes.js";
import { analyticsRouter } from "./http/analytics.routes.js";
import { createAiRouter } from "./http/ai.routes.js";
import { miscRouter } from "./http/misc.routes.js";
import { searchRouter } from "./http/search.routes.js";
import { createIntegrationsRouter } from "./http/integrations.routes.js";
import { createIcsRouter } from "./http/ics.routes.js";
import { createExportRouter } from "./http/export.routes.js";

// Socket.IO gateways
import type { GatewayDeps, Identity } from "./realtime/types.js";
import { register as registerProjectGateway } from "./realtime/project.gateway.js";
import { register as registerUserGateway } from "./realtime/user.gateway.js";
import { register as registerFileGateway } from "./realtime/file.gateway.js";
import { register as registerContactsGateway } from "./realtime/contacts.gateway.js";
import { register as registerCollabGateway } from "./realtime/collab.gateway.js";
import { register as registerChatGateway } from "./realtime/chat.gateway.js";
import { register as registerSharingGateway } from "./realtime/sharing.gateway.js";
import { register as registerNotificationGateway } from "./realtime/notification.gateway.js";
import { CollabService } from "@services/collab.service.js";
import { ChatService } from "@services/chat.service.js";
import { SharingService } from "@services/sharing.service.js";
import { ContactsService } from "@services/contacts.service.js";
import { NotificationCenterService } from "@services/notification-center.service.js";
import { IntegrationsService } from "@services/integrations.service.js";
import { PresenceRegistry } from "./realtime/presence.registry.js";

// H5: last-resort handlers so a stray async rejection/throw is logged instead of
// silently taking down (or half-crashing) an unsupervised Node process. These
// complement — they do not replace — the per-handler try/catch in the gateways.
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});

const app = express();
const server = http.createServer(app);

// === CORS: config-driven ===
// Production: only the explicit origins from SOCKET_CORS_ORIGIN / FRONTEND_URL
// are allowed (wildcard is refused at startup in config/index.ts).
// Development: keep the permissive localhost/LAN regex allow-list.
const PROD_ALLOWED_ORIGINS = getExplicitAllowedOrigins();

function isOriginAllowed(origin: string): boolean {
  if (IS_PRODUCTION) {
    return PROD_ALLOWED_ORIGINS.includes(origin);
  }
  return ALLOWED_ORIGINS.some((pattern) =>
    typeof pattern === "string" ? pattern === origin : pattern.test(origin)
  );
}

// Socket.IO CORS origin resolver — production uses the explicit list; dev is
// permissive (echo any origin) to match the express behavior below.
const socketCorsOrigin = IS_PRODUCTION
  ? PROD_ALLOWED_ORIGINS
  : (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return cb(null, true); // non-browser clients
      return cb(null, isOriginAllowed(origin));
    };

const io = new Server(server, {
  cors: {
    origin: socketCorsOrigin as any,
    methods: ["GET", "POST"],
    credentials: true,
  },
  // Bound the transport frame size slightly above MAX_UPLOAD_BYTES so oversized
  // frames are rejected at the transport layer (defense-in-depth with the
  // per-message check in the file gateway).
  maxHttpBufferSize: MAX_UPLOAD_BYTES + 1024 * 1024,
});

// Dynamic CORS middleware in TypeScript
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, CURL, mobile apps)
    if (!origin) return callback(null, true);

    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(
        `[CORS] Blocked origin: ${origin}. ` +
          (IS_PRODUCTION
            ? "Add it to SOCKET_CORS_ORIGIN / FRONTEND_URL."
            : "Add it to ALLOWED_ORIGINS in config.ts")
      );
      callback(new Error(`CORS blocked origin: ${origin}`));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

// === Shared singletons ===
const project_handler = new ProjectHandler();
const user_handler = new UserHandler();
const agent = new Chat_Agent(process.env.GEMINI_API_KEY!);
const storage = new DiskStorageService(project_handler);
const collab = new CollabService();
const chat = new ChatService();
const sharing = new SharingService();
const contacts = new ContactsService(user_handler);
const notifications = new NotificationCenterService();
const integrations = new IntegrationsService();
const presence = new PresenceRegistry();

// N10: mirror every persisted notification to the recipient's outbound webhook /
// Slack, if they configured one. Decoupled via a plain function (DIP).
notifications.setSideChannel((recipient, notification) =>
  integrations.deliverWebhookForUser(recipient, notification)
);

// === Auth routes (email/password + Google login) ===
app.use("/auth", authRouter);

// === Static asset serving (projects/<name>_assets/...) ===
app.use(
  "/projects",
  express.static(project_handler.get_base_path(), {
    setHeaders: (res, filePath) => {
      // Set appropriate content types
      if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
        res.setHeader("Content-Type", "image/jpeg");
      } else if (filePath.endsWith(".png")) {
        res.setHeader("Content-Type", "image/png");
      } else if (filePath.endsWith(".gif")) {
        res.setHeader("Content-Type", "image/gif");
      } else if (filePath.endsWith(".webp")) {
        res.setHeader("Content-Type", "image/webp");
      } else if (filePath.endsWith(".mp4")) {
        res.setHeader("Content-Type", "video/mp4");
      } else if (filePath.endsWith(".webm")) {
        res.setHeader("Content-Type", "video/webm");
      } else if (filePath.endsWith(".ogg")) {
        res.setHeader("Content-Type", "video/ogg");
      }
    },
  })
);

// === Root-mounted HTTP routers (Google/OAuth/Gmail, analytics, AI, misc) ===
app.use(googleRouter);
app.use(analyticsRouter);
app.use(searchRouter);
app.use(createAiRouter(agent));
app.use(createIntegrationsRouter(integrations)); // N10: per-user integration config
app.use(createIcsRouter(integrations));          // N10: unauthenticated ICS feed
app.use(createExportRouter());                   // N10: project export (JSON/Markdown)
app.use(miscRouter);

// === Socket.IO handshake auth (permissive by default; strict via AUTH_STRICT) ===
io.use(socketAuth);

// Pass io + agent so the cron ALSO pushes proactive `ai:suggestion` events
// (C2) to per-user rooms, in addition to the existing task-due emails.
// `notifications` lets the cron also persist durable `ai_suggestion` / `due_soon`
// inbox entries (N2) alongside the live push / email.
startNotificationService({ io, agent, notifications });

// === Socket Event Handlers ===

// Store user sessions: socketId -> username
const userSessions = new Map<string, string>();

io.on("connection", (socket: Socket) => {
  console.log("✅ User connected:", socket.id);

  // If this socket authenticated via JWT, seed the legacy session map with the
  // token's username so any code still reading userSessions stays consistent.
  if (socket.data.user?.username) {
    userSessions.set(socket.id, socket.data.user.username);
    console.log(`[Server] Authenticated socket ${socket.id} → ${socket.data.user.username}`);
  }

  /**
   * Resolve the effective identity (username / email) for this socket.
   * Prefers the verified JWT (socket.data.user); falls back to the legacy
   * payload/session value when no token was presented (permissive mode).
   */
  const identity = (payloadName?: string): Identity => {
    if (socket.data.user) {
      return { username: socket.data.user.username, email: socket.data.user.email };
    }
    const legacy = payloadName ?? userSessions.get(socket.id);
    return { username: legacy, email: legacy };
  };

  // Join this socket to its per-user room so the notification cron can push
  // targeted `ai:suggestion` events (C2). Re-joins on identifyUser below too,
  // covering the permissive path where the username arrives after connect.
  const joinUserRoom = (name?: string) => {
    if (name && name !== "Demo User") socket.join(userRoom(name));
  };
  joinUserRoom(identity().username);
  socket.on("identifyUser", (data: { username?: string }) => {
    joinUserRoom(socket.data.user?.username ?? data?.username);
  });

  const deps: GatewayDeps = { project_handler, user_handler, storage, collab, chat, sharing, contacts, notifications, presence, userSessions, identity };

  // Register each gateway (grouped by concern).
  registerProjectGateway(io, socket, deps);
  registerUserGateway(io, socket, deps);
  registerFileGateway(io, socket, deps);
  registerContactsGateway(io, socket, deps);
  registerCollabGateway(io, socket, deps); // Phase 6b: granular realtime + presence
  registerChatGateway(io, socket, deps); // Chat: project channels + 1:1 DMs
  registerSharingGateway(io, socket, deps); // N1: access control & sharing
  registerNotificationGateway(io, socket, deps); // N2: notification center + activity feed
});

// H4: fail fast if Postgres (the single source of truth) is unreachable, rather
// than booting "healthy" and having every socket op error at query time.
async function start(): Promise<void> {
  try {
    await assertDbConnection();
    console.log("🗄️  Database connection OK");
  } catch (err) {
    console.error("[FATAL] Cannot reach the database — refusing to start:", err);
    process.exit(1);
  }

  server.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`🚀 Server running on http://${SERVER_HOST}:${SERVER_PORT}`);
    console.log(`📡 Listening on all interfaces (0.0.0.0) - ready for external connections`);
    console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
    console.log(`\n📋 Port Forwarding Instructions:`);
    console.log(`   1. Forward external port ${SERVER_PORT} to ${SERVER_PORT} on this machine`);
    console.log(`   2. Use your public IP address for external connections`);
    console.log(`   3. Update client config to point to your public IP:PORT`);
  });
}

start();
