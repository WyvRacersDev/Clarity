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
 * Authorization (A2): every mutating/persisting op is gated on project access
 * via `authorizeEdit()` — LOCAL projects are owner-only (identity().username must
 * match owner_name); HOSTED projects are publicly editable, mirroring the
 * loadProject `canEdit` contract. Element/ydoc ops additionally verify the target
 * element belongs to the named project so a client can't name its own project
 * while targeting an element in someone else's. joinProjectRoom (and thus the
 * ephemeral cursor/awareness relays that require room membership) is gated too.
 *
 * DRY (R6): every authorized event shares one preamble — validate → authorize →
 * (optionally) element-membership check → try/catch → `clientError` sanitize.
 * `onAuthed()` runs that once; each handler receives the parsed payload plus the
 * resolved `{ projectId, roomKey, username }` context and the ack, so it holds
 * only the op-specific work. cursor:move / ydoc:awareness stay fire-and-forget
 * (ignored on bad input, never acked); join/leave keep their bespoke presence
 * flow (leave is intentionally un-authorized).
 */
import type { Server, Socket } from "socket.io";
import type { ZodType } from "zod";
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
  ydocSyncSchema,
  ydocUpdateSchema,
  ydocAwarenessSchema,
  formatZodError,
} from "../validation/schemas.js";
import { clientError } from "../lib/clientError.js";
import { parseMentions } from "../lib/mentions.js";
import { userRoom } from "../services/notification.service.js";

type Ack = (response: any) => void;

/** Every authorized collab payload identifies its project by name + type. */
type CollabPayload = { projectName: string; projectType: "local" | "hosted" };

/** Resolved context handed to an `onAuthed` handler after the shared preamble. */
interface AuthedContext {
  projectId: string;
  roomKey: string;
  username: string;
}

function roomKeyFor(projectType: string, projectName: string): string {
  return `${projectType}:${projectName}`;
}

export function register(io: Server, socket: Socket, deps: GatewayDeps): void {
  // DIP: depend on the injected collaboration boundary + presence store, not on
  // repositories / ydoc-registry directly.
  const { identity, collab, presence, notifications } = deps;

  // Track which rooms this socket joined so disconnect can clean them all up.
  const joinedRooms = new Set<string>();

  const currentUsername = (): string => identity().username ?? `anon:${socket.id.slice(0, 6)}`;

  /** Emit the current presence list to everyone in the room. */
  const broadcastPresence = (roomKey: string): void => {
    io.to(roomKey).emit("presence:update", {
      room: roomKey,
      users: presence.users(roomKey),
    });
  };

  /**
   * Authorize the current socket to edit the named project (A2) — delegates the
   * business rule to CollabService (local = owner-only, hosted = open).
   */
  const authorizeEdit = (projectName: string, projectType: "local" | "hosted") =>
    collab.authorize(projectName, projectType, identity().username, "edit");

  /**
   * Authorize the current socket to VIEW the named project (N1) — viewers may
   * join the room to receive live updates + presence but cannot mutate.
   */
  const authorizeView = (projectName: string, projectType: "local" | "hosted") =>
    collab.authorize(projectName, projectType, identity().username, "view");

  /**
   * Higher-order registration for the authorized collab events (R6). Runs the
   * shared preamble once: zod-validate → authorize edit → (optionally) verify the
   * target element belongs to the project → run `handler` inside a try/catch that
   * sanitizes unexpected errors via `clientError(action)`. `handler` receives the
   * parsed payload, the resolved context, and the ack, and holds only op work.
   */
  function onAuthed<T extends CollabPayload>(
    event: string,
    schema: ZodType<T>,
    action: string,
    handler: (data: T, ctx: AuthedContext, ack?: Ack) => Promise<void>,
    opts: { requireElement?: boolean } = {}
  ): void {
    socket.on(event, async (data: unknown, ack?: Ack) => {
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      const payload = parsed.data;
      try {
        const auth = await authorizeEdit(payload.projectName, payload.projectType);
        if (!auth.ok) {
          ack?.({ success: false, message: auth.message });
          return;
        }
        if (opts.requireElement) {
          const elementId = (payload as { elementId?: string }).elementId as string;
          if (!(await collab.elementInProject(elementId, auth.projectId))) {
            ack?.({ success: false, message: "Element not found" });
            return;
          }
        }
        const roomKey = roomKeyFor(payload.projectType, payload.projectName);
        await handler(payload, { projectId: auth.projectId, roomKey, username: currentUsername() }, ack);
      } catch (error: any) {
        console.error(`[Collab] ${event} error:`, error);
        ack?.({ success: false, message: clientError(action) });
      }
    });
  }

  // ─── Rooms + presence ──────────────────────────────────────────────────────

  socket.on(
    "joinProjectRoom",
    async (data: { projectName: string; projectType: "local" | "hosted" }, ack?: Ack) => {
      const parsed = joinProjectRoomSchema.safeParse(data);
      if (!parsed.success) {
        ack?.({ success: false, message: formatZodError(parsed.error) });
        return;
      }
      // N1: anyone with at least VIEW access may join the room (viewers included);
      // edit rights are enforced per-op below.
      const auth = await authorizeView(data.projectName, data.projectType);
      if (!auth.ok) {
        ack?.({ success: false, message: auth.message });
        return;
      }
      const roomKey = roomKeyFor(data.projectType, data.projectName);
      const username = currentUsername();

      socket.join(roomKey);
      joinedRooms.add(roomKey);
      presence.add(roomKey, socket.id, username);

      console.log(`[Collab] ${username} (${socket.id}) joined room ${roomKey}`);

      // Ack with the current presence list, then broadcast to the room.
      ack?.({ success: true, room: roomKey, users: presence.users(roomKey) });
      broadcastPresence(roomKey);
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
      presence.remove(roomKey, socket.id);

      console.log(`[Collab] ${socket.id} left room ${roomKey}`);

      ack?.({ success: true, room: roomKey });
      broadcastPresence(roomKey);
    }
  );

  // ─── Element ops ───────────────────────────────────────────────────────────

  onAuthed(
    "element:create",
    elementCreateSchema,
    "create the element",
    async (data, { roomKey }, ack) => {
      // A3: resolve grid + insert atomically under the project advisory lock so
      // a concurrent full-replace saveProject can't delete the grid mid-insert.
      const result = await collab.createElement(
        data.projectName,
        data.projectType,
        data.gridId ?? null,
        data.element
      );
      if (!result.ok) {
        ack?.({
          success: false,
          message:
            result.reason === "no_project" ? "Project not found" : "No grid found for project",
        });
        return;
      }
      const { gridId, element } = result;

      // Broadcast to the room EXCEPT the sender.
      socket.to(roomKey).emit("element:created", { gridId, element });
      ack?.({ success: true, gridId, element });
    }
  );

  onAuthed(
    "element:move",
    elementMoveSchema,
    "move the element",
    async (data, { roomKey }, ack) => {
      // Only include fields that were actually provided (exactOptionalPropertyTypes).
      const transform: { x_pos?: number; y_pos?: number; x_scale?: number; y_scale?: number } = {};
      if (data.x_pos !== undefined) transform.x_pos = data.x_pos;
      if (data.y_pos !== undefined) transform.y_pos = data.y_pos;
      if (data.x_scale !== undefined) transform.x_scale = data.x_scale;
      if (data.y_scale !== undefined) transform.y_scale = data.y_scale;
      const ok = await collab.moveElement(data.elementId, transform);
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
    },
    { requireElement: true }
  );

  onAuthed(
    "element:update",
    elementUpdateSchema,
    "update the element",
    async (data, { roomKey }, ack) => {
      const ok = await collab.updateElementContent(data.elementId, data.content);
      if (!ok) {
        ack?.({ success: false, message: "Element not found" });
        return;
      }

      const payload = { elementId: data.elementId, content: data.content };
      socket.to(roomKey).emit("element:updated", payload);
      ack?.({ success: true, ...payload });
    },
    { requireElement: true }
  );

  onAuthed(
    "element:delete",
    elementDeleteSchema,
    "delete the element",
    async (data, { roomKey }, ack) => {
      const ok = await collab.deleteElement(data.elementId);
      if (!ok) {
        ack?.({ success: false, message: "Element not found" });
        return;
      }

      socket.to(roomKey).emit("element:deleted", { elementId: data.elementId });
      ack?.({ success: true, elementId: data.elementId });
    },
    { requireElement: true }
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

  // ─── Collaborative text (B3 — Yjs) ──────────────────────────────────────────
  //
  // Text_document co-editing. The server holds the authoritative Y.Doc per
  // element (ydoc-registry), applies every update, persists it (debounced) into
  // `content.ydoc` + a `Text_field` plain-text mirror, and relays updates to the
  // rest of the room. Awareness (cursors/selections) is relayed only.
  //
  // Rooms are reused from joinProjectRoom, so a client must already be in the
  // project room; updates are broadcast to that room EXCEPT the sender (peers
  // apply the update to their local Y.Doc — the CRDT merges concurrent edits).

  onAuthed(
    "ydoc:sync",
    ydocSyncSchema,
    "sync the document",
    async (data, _ctx, ack) => {
      const { update, stateVector } = await collab.ydocSync(data.elementId, data.stateVector);
      ack?.({ success: true, elementId: data.elementId, update, stateVector });
    },
    { requireElement: true }
  );

  onAuthed(
    "ydoc:update",
    ydocUpdateSchema,
    "update the document",
    async (data, { roomKey }, ack) => {
      await collab.ydocApplyUpdate(data.elementId, data.update);
      // Relay the raw update to peers; each merges it into their local doc.
      socket.to(roomKey).emit("ydoc:updated", {
        elementId: data.elementId,
        update: data.update,
      });
      ack?.({ success: true, elementId: data.elementId });
    },
    { requireElement: true }
  );

  socket.on(
    "ydoc:awareness",
    (data: {
      projectName: string;
      projectType: "local" | "hosted";
      elementId: string;
      update: string;
    }) => {
      const parsed = ydocAwarenessSchema.safeParse(data);
      if (!parsed.success) return; // fire-and-forget; ignore malformed
      const roomKey = roomKeyFor(data.projectType, data.projectName);
      socket.to(roomKey).emit("ydoc:awareness:updated", {
        elementId: data.elementId,
        update: data.update,
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

  onAuthed(
    "task:comment:add",
    taskCommentAddSchema,
    "add the comment",
    async (data, { projectId, roomKey, username }, ack) => {
      const comment = await collab.addComment(data.taskId, username, data.body);

      // Broadcast to everyone in the room (including the sender).
      io.to(roomKey).emit("task:comment:added", { comment });
      ack?.({ success: true, comment });

      // N7: notify @mentioned users live via their personal room (same pattern
      // as ai:suggestion). Skip self-mentions. This transient push stays here.
      const mentioned = parseMentions(data.body).filter((m) => m !== username);
      for (const m of mentioned) {
        io.to(userRoom(m)).emit("mention:notified", {
          taskId: data.taskId,
          author: username,
          body: data.body,
          created_at: comment.created_at,
        });
      }

      // N2: durable inbox — a `mention` row per @mention + a `comment` row for
      // the other participants. Best-effort: never fail the comment on this.
      try {
        await notifications.recordCommentNotifications(io, {
          projectId,
          projectName: data.projectName,
          projectType: data.projectType,
          author: username,
          body: data.body,
          mentioned,
        });
      } catch (err) {
        console.error("[Collab] notification fan-out failed:", err);
      }
    }
  );

  onAuthed(
    "task:comment:list",
    taskCommentListSchema,
    "load comments",
    async (data, _ctx, ack) => {
      const comments = await collab.listComments(data.taskId);
      ack?.({ success: true, comments });
    }
  );

  // ─── Disconnect cleanup ────────────────────────────────────────────────────
  // Additional `disconnect` listener (the user gateway has its own). Socket.IO
  // supports multiple listeners for the same event, so this cleans up room
  // presence without touching the existing handler.
  socket.on("disconnect", () => {
    for (const roomKey of joinedRooms) {
      presence.remove(roomKey, socket.id);
      broadcastPresence(roomKey);
    }
    joinedRooms.clear();
  });
}
