/**
 * Shared dependency + identity types for the Socket.IO gateways (Phase 6a).
 *
 * The gateways are behavior-preserving extractions of the handlers that used to
 * live inline in `src/index.ts`. `register(io, socket, deps)` wires one concern
 * onto a connected socket; `deps` carries the shared singletons plus the
 * per-socket `identity()` resolver (JWT-first, legacy-payload fallback) exactly
 * as before.
 */
import type { Server, Socket } from "socket.io";
import type { ProjectHandler } from "@services/project.service.js";
import type { UserHandler } from "@services/user.service.js";
import type { StorageService } from "@services/storage/StorageService.js";

export interface Identity {
  username: string | undefined;
  email: string | undefined;
}

export interface GatewayDeps {
  project_handler: ProjectHandler;
  user_handler: UserHandler;
  storage: StorageService;
  /**
   * Resolve the effective identity for this socket. Prefers the verified JWT
   * (socket.data.user); falls back to the legacy payload/session value when no
   * token was presented (permissive mode).
   */
  identity: (payloadName?: string) => Identity;
}

export type Register = (io: Server, socket: Socket, deps: GatewayDeps) => void;
