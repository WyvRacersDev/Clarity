/**
 * Collab gateway (Phase 6b) — granular per-element realtime + presence + cursors.
 *
 * ADDITIVE on top of the whole-project saveProject/loadProject flow, which stays
 * as the fallback/initial-load path. This gateway adds:
 *
 *   - Project ROOMS keyed `${projectType}:${projectName}` (join/leave).
 *   - Per-ELEMENT ops (create/move/update/delete) persisted individually to
 *     Postgres via the project.repository element methods, then broadcast to the
 *     room EXCEPT the sender (last-write-wins per element).
 *   - PRESENCE: in-memory room membership, broadcast `presence:update` on
 *     join/leave/disconnect.
 *   - CURSORS: `cursor:move` broadcast to the room (NOT persisted).
 *   - TASK COMMENTS (A3): `task:comment:add` persists to Postgres, acks the
 *     created comment, and broadcasts `task:comment:added` to the room;
 *     `task:comment:list` acks a task's comment thread.
 *
 * Authorization reuses the existing permissive `identity()` pattern (token
 * identity when present; payload/session fallback) — nothing is tightened.
 *
 * Every mutating event is zod-validated; malformed payloads ack
 * `{ success:false, message }`. cursor:move is fire-and-forget (ignored on bad
 * input, never acked).
 */
import type { Server, Socket } from "socket.io";
import type { GatewayDeps } from "./types.js";
import {
  joinProjectRoomSchema,
  leaveProjectRoomSchema,
  elementCreateSchema,
  elementMoveSchema,
  elementUpdateSchema,
  elementDeleteSchema,
  cursorMoveSchema,
  taskCommentAddSchema,
  taskCommentListSchema,
  formatZodError,
} from "../validation/schemas.js";
import {
  insertElement,
  updateElementTransform,
  updateElementContent,
  deleteElement,
  findFirstGridId,
} from "../repositories/project.repository.js";
import {
  addComment,
  listComments,
} from "../repositories/comment.repository.js";

type Ack = (response: any) => void;

/** roomKey -> (socketId -> { username }). Module-level: shared across sockets. */
const roomMembers = new Map<string, Map<string, { username: string }>>();

function roomKeyFor(projectType: string, projectName: string): string {
  return `${projectType}:${projectName}`;
}

/** Distinct usernames currently in a room (for presence broadcasts). */
function presenceUsers(roomKey: string): Array<{ username: string }> {
  const members = roomMembers.get(roomKey);
  if (!members) return [];
  const seen = new Set<string>();
  const users: Array<{ username: string }> = [];
  for (const { username } of members.values()) {
    if (!seen.has(username)) {
      seen.add(username);
      users.push({ username });
    }
  }
  return users;
}

function addMember(roomKey: string, socketId: string, username: string): void {
  let members = roomMembers.get(roomKey);
  if (!members) {
    members = new Map();
    roomMembers.set(roomKey, members);
  }
  members.set(socketId, { username });
}

function removeMember(roomKey: string, socketId: string): void {
  const members = roomMembers.get(roomKey);
  if (!members) return;
  members.delete(socketId);
  if (members.size === 0) roomMembers.delete(roomKey);
}

/** Emit the current presence list to everyone in the room. */
function broadcastPresence(io: Server, roomKey: string): void {
  io.to(roomKey).emit("presence:update", {
    room: roomKey,
    users: presenceUsers(roomKey),
  });
}

export function register(io: Server, socket: Socket, deps: GatewayDeps): void {
  const { identity } = deps;

  // Track which rooms this socket joined so disconnect can clean them all up.
  const joinedRooms = new Set<string>();

  const currentUsername = (): string => identity().username ?? `anon:${socket.id.slice(0, 6)}`;

  // ─── Rooms + presence ──────────────────────────────────────────────────────

  socket.on(
    "joinProjectRoom",
    (data: { projectName: string; projectType: "local" | "hosted" }, ack?: Ack) => {
      const parsed = joinProjectRoomSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      const roomKey = roomKeyFor(data.projectType, data.projectName);
      const username = currentUsername();

      socket.join(roomKey);
      joinedRooms.add(roomKey);
      addMember(roomKey, socket.id, username);

      console.log(`[Collab] ${username} (${socket.id}) joined room ${roomKey}`);

      // Ack with the current presence list, then broadcast to the room.
      ack?.({ success: true, room: roomKey, users: presenceUsers(roomKey) });
      broadcastPresence(io, roomKey);
    }
  );

  socket.on(
    "leaveProjectRoom",
    (data: { projectName: string; projectType: "local" | "hosted" }, ack?: Ack) => {
      const parsed = leaveProjectRoomSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      const roomKey = roomKeyFor(data.projectType, data.projectName);

      socket.leave(roomKey);
      joinedRooms.delete(roomKey);
      removeMember(roomKey, socket.id);

      console.log(`[Collab] ${socket.id} left room ${roomKey}`);

      ack?.({ success: true, room: roomKey });
      broadcastPresence(io, roomKey);
    }
  );

  // ─── Element ops ───────────────────────────────────────────────────────────

  socket.on(
    "element:create",
    async (
      data: {
        projectName: string;
        projectType: "local" | "hosted";
        gridId?: string;
        element: any;
      },
      ack?: Ack
    ) => {
      const parsed = elementCreateSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const roomKey = roomKeyFor(data.projectType, data.projectName);
        const gridId =
          data.gridId ?? (await findFirstGridId(data.projectName, data.projectType));
        if (!gridId) {
          ack?.({ success: false, message: "No grid found for project" });
          return;
        }

        const element = await insertElement(gridId, data.element);
        if (!element) {
          ack?.({ success: false, message: "Failed to insert element (grid missing?)" });
          return;
        }

        // Broadcast to the room EXCEPT the sender.
        socket.to(roomKey).emit("element:created", { gridId, element });
        ack?.({ success: true, gridId, element });
      } catch (error: any) {
        console.error("[Collab] element:create error:", error);
        ack?.({ success: false, message: `Error: ${error.message}` });
      }
    }
  );

  socket.on(
    "element:move",
    async (
      data: {
        projectName: string;
        projectType: "local" | "hosted";
        elementId: string;
        x_pos?: number;
        y_pos?: number;
        x_scale?: number;
        y_scale?: number;
      },
      ack?: Ack
    ) => {
      const parsed = elementMoveSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const roomKey = roomKeyFor(data.projectType, data.projectName);
        // Only include fields that were actually provided (exactOptionalPropertyTypes).
        const transform: {
          x_pos?: number;
          y_pos?: number;
          x_scale?: number;
          y_scale?: number;
        } = {};
        if (data.x_pos !== undefined) transform.x_pos = data.x_pos;
        if (data.y_pos !== undefined) transform.y_pos = data.y_pos;
        if (data.x_scale !== undefined) transform.x_scale = data.x_scale;
        if (data.y_scale !== undefined) transform.y_scale = data.y_scale;
        const ok = await updateElementTransform(data.elementId, transform);
        if (!ok) {
          ack?.({ success: false, message: "Element not found" });
          return;
        }

        const payload = {
          elementId: data.elementId,
          x_pos: data.x_pos,
          y_pos: data.y_pos,
          x_scale: data.x_scale,
          y_scale: data.y_scale,
        };
        socket.to(roomKey).emit("element:moved", payload);
        ack?.({ success: true, ...payload });
      } catch (error: any) {
        console.error("[Collab] element:move error:", error);
        ack?.({ success: false, message: `Error: ${error.message}` });
      }
    }
  );

  socket.on(
    "element:update",
    async (
      data: {
        projectName: string;
        projectType: "local" | "hosted";
        elementId: string;
        content: Record<string, unknown>;
      },
      ack?: Ack
    ) => {
      const parsed = elementUpdateSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const roomKey = roomKeyFor(data.projectType, data.projectName);
        const ok = await updateElementContent(data.elementId, data.content);
        if (!ok) {
          ack?.({ success: false, message: "Element not found" });
          return;
        }

        const payload = { elementId: data.elementId, content: data.content };
        socket.to(roomKey).emit("element:updated", payload);
        ack?.({ success: true, ...payload });
      } catch (error: any) {
        console.error("[Collab] element:update error:", error);
        ack?.({ success: false, message: `Error: ${error.message}` });
      }
    }
  );

  socket.on(
    "element:delete",
    async (
      data: { projectName: string; projectType: "local" | "hosted"; elementId: string },
      ack?: Ack
    ) => {
      const parsed = elementDeleteSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const roomKey = roomKeyFor(data.projectType, data.projectName);
        const ok = await deleteElement(data.elementId);
        if (!ok) {
          ack?.({ success: false, message: "Element not found" });
          return;
        }

        socket.to(roomKey).emit("element:deleted", { elementId: data.elementId });
        ack?.({ success: true, elementId: data.elementId });
      } catch (error: any) {
        console.error("[Collab] element:delete error:", error);
        ack?.({ success: false, message: `Error: ${error.message}` });
      }
    }
  );

  // ─── Cursors (fire-and-forget, NOT persisted) ──────────────────────────────

  socket.on(
    "cursor:move",
    (data: { projectName: string; projectType: "local" | "hosted"; x: number; y: number }) => {
      const parsed = cursorMoveSchema.safeParse(data);
      if (!parsed.success) return; // ignore malformed cursor updates
      const roomKey = roomKeyFor(data.projectType, data.projectName);
      socket.to(roomKey).emit("cursor:moved", {
        username: currentUsername(),
        x: data.x,
        y: data.y,
      });
    }
  );

  // ─── Task comments (A3) ─────────────────────────────────────────────────────
  //
  // Persisted to Postgres (task_comments). `author` is taken from the socket's
  // identity, never trusted from the payload. On add: ack the created comment to
  // the sender AND broadcast `task:comment:added` to the whole project room
  // (INCLUDING the sender — comments are low-frequency, so echoing keeps every
  // client's thread consistent without special-casing the author's own view).

  socket.on(
    "task:comment:add",
    async (
      data: {
        projectName: string;
        projectType: "local" | "hosted";
        taskId: string;
        body: string;
      },
      ack?: Ack
    ) => {
      const parsed = taskCommentAddSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const roomKey = roomKeyFor(data.projectType, data.projectName);
        const author = currentUsername();
        const comment = await addComment(data.taskId, author, data.body);

        // Broadcast to everyone in the room (including the sender).
        io.to(roomKey).emit("task:comment:added", { comment });
        ack?.({ success: true, comment });
      } catch (error: any) {
        console.error("[Collab] task:comment:add error:", error);
        ack?.({ success: false, message: `Error: ${error.message}` });
      }
    }
  );

  socket.on(
    "task:comment:list",
    async (
      data: { projectName: string; projectType: "local" | "hosted"; taskId: string },
      ack?: Ack
    ) => {
      const parsed = taskCommentListSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      try {
        const comments = await listComments(data.taskId);
        ack?.({ success: true, comments });
      } catch (error: any) {
        console.error("[Collab] task:comment:list error:", error);
        ack?.({ success: false, message: `Error: ${error.message}` });
      }
    }
  );

  // ─── Disconnect cleanup ────────────────────────────────────────────────────
  // Additional `disconnect` listener (the user gateway has its own). Socket.IO
  // supports multiple listeners for the same event, so this cleans up room
  // presence without touching the existing handler.
  socket.on("disconnect", () => {
    for (const roomKey of joinedRooms) {
      removeMember(roomKey, socket.id);
      broadcastPresence(io, roomKey);
    }
    joinedRooms.clear();
  });
}
