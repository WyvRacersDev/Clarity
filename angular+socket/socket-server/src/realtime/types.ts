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
import type { CollabService } from "@services/collab.service.js";
import type { ChatService } from "@services/chat.service.js";
import type { SharingService } from "@services/sharing.service.js";
import type { ContactsService } from "@services/contacts.service.js";
import type { NotificationCenterService } from "@services/notification-center.service.js";
import type { PresenceRegistry } from "./presence.registry.js";

export interface Identity {
  username: string | undefined;
  email: string | undefined;
}

export interface GatewayDeps {
  project_handler: ProjectHandler;
  user_handler: UserHandler;
  storage: StorageService;
  /** Realtime collaboration business boundary (element/comment/ydoc + authz). */
  collab: CollabService;
  /** Chat business boundary (project channels + 1:1 DMs + read cursors). */
  chat: ChatService;
  /** Sharing / access-control boundary (members, invitations, link sharing). */
  sharing: SharingService;
  /** Google Contacts import business boundary. */
  contacts: ContactsService;
  /** Durable in-app notification inbox + activity feed boundary (N2). */
  notifications: NotificationCenterService;
  /** In-memory room presence store (shared across sockets). */
  presence: PresenceRegistry;
  /**
   * Legacy socketId → username session map (shared across sockets). Used by the
   * user gateway's identify/disconnect bookkeeping and the permissive identity
   * fallback. Carried in deps so every gateway conforms to the shared `Register`
   * signature (no bespoke extra parameter).
   */
  userSessions: Map<string, string>;
  /**
   * Resolve the effective identity for this socket. Prefers the verified JWT
   * (socket.data.user); falls back to the legacy payload/session value when no
   * token was presented (permissive mode).
   */
  identity: (payloadName?: string) => Identity;
}

export type Register = (io: Server, socket: Socket, deps: GatewayDeps) => void;
