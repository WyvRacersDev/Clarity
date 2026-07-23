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
import { startNotificationService } from "@services/notification.service.js";
import {
  SERVER_HOST,
  SERVER_PORT,
  FRONTEND_URL,
  ALLOWED_ORIGINS,
  SOCKET_CORS_ORIGIN,
} from "./config/index.js";
import { socketAuth } from "./middleware/socketAuth.js";

// HTTP routers
import { authRouter } from "./http/auth.routes.js";
import { googleRouter } from "./http/google.routes.js";
import { analyticsRouter } from "./http/analytics.routes.js";
import { createAiRouter } from "./http/ai.routes.js";
import { miscRouter } from "./http/misc.routes.js";

// Socket.IO gateways
import type { GatewayDeps, Identity } from "./realtime/types.js";
import { register as registerProjectGateway } from "./realtime/project.gateway.js";
import { register as registerUserGateway } from "./realtime/user.gateway.js";
import { register as registerFileGateway } from "./realtime/file.gateway.js";
import { register as registerContactsGateway } from "./realtime/contacts.gateway.js";
import { register as registerCollabGateway } from "./realtime/collab.gateway.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: SOCKET_CORS_ORIGIN, // Configurable CORS origin
    methods: ["GET", "POST"],
    credentials: true,
  },
  maxHttpBufferSize: 1e8, // 100MB - maximum buffer size for file uploads
});

// Dynamic CORS middleware in TypeScript
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (Postman, CURL, mobile apps)
    if (!origin) return callback(null, true);

    const isAllowed = ALLOWED_ORIGINS.some((pattern) => {
      if (typeof pattern === "string") {
        return pattern === origin;
      } else {
        return pattern.test(origin);
      }
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}. Add it to ALLOWED_ORIGINS in config.ts`);
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
app.use(createAiRouter(agent));
app.use(miscRouter);

// === Socket.IO handshake auth (permissive by default; strict via AUTH_STRICT) ===
io.use(socketAuth);

// checkUpcomingTasks();
startNotificationService();

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

  const deps: GatewayDeps = { project_handler, user_handler, storage, identity };

  // Register each gateway (grouped by concern).
  registerProjectGateway(io, socket, deps);
  registerUserGateway(io, socket, deps, userSessions);
  registerFileGateway(io, socket, deps);
  registerContactsGateway(io, socket, deps);
  registerCollabGateway(io, socket, deps); // Phase 6b: granular realtime + presence
});

server.listen(SERVER_PORT, SERVER_HOST, () => {
  console.log(`🚀 Server running on http://${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`📡 Listening on all interfaces (0.0.0.0) - ready for external connections`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log(`\n📋 Port Forwarding Instructions:`);
  console.log(`   1. Forward external port ${SERVER_PORT} to ${SERVER_PORT} on this machine`);
  console.log(`   2. Use your public IP address for external connections`);
  console.log(`   3. Update client config to point to your public IP:PORT`);
});
