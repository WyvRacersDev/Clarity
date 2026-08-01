/**
 * Chat gateway — collaborator chat over Socket.IO (project channels + 1:1 DMs).
 *
 * Mirrors the task-comment flow (persist → ack → broadcast) generalized to whole
 * conversations. Two scopes are addressed uniformly through `resolveTarget`,
 * which both AUTHORIZES and resolves routing:
 *   - 'project' → AccessService VIEW on the project; broadcast to the existing
 *     room `${projectType}:${projectName}` (INCLUDING the sender, so every tab
 *     stays consistent — chat is low-frequency).
 *   - 'dm'      → ChatService.resolveDm (both registered users, sharing a
 *     project); delivered to both participants' per-user rooms.
 *
 * `author` is always taken from the socket identity, never trusted from the
 * payload. Edits/deletes are author-scoped in the repository. Transport concerns
 * only (validate → service → ack/broadcast); the rules live in ChatService.
 */
import type { Server, Socket } from "socket.io";
import type { GatewayDeps } from "./types.js";
import {
  chatSendSchema,
  chatHistorySchema,
  chatEditSchema,
  chatDeleteSchema,
  chatTypingSchema,
  chatReadSchema,
  chatUnreadSchema,
  chatConversationsSchema,
  formatZodError,
} from "../validation/schemas.js";
import { clientError } from "../lib/clientError.js";
import { parseMentions } from "../lib/mentions.js";
import { userRoom } from "../services/notification.service.js";

type Ack = (response: any) => void;

/** A chat payload addressing a conversation (project channel or DM partner). */
interface ChatTargetPayload {
  scope: "project" | "dm";
  projectName?: string | undefined;
  projectType?: "local" | "hosted" | undefined;
  to?: string | undefined;
}

/** Resolved + authorized conversation, with everything needed to route a message. */
type ResolvedTarget =
  | {
      ok: true;
      kind: "project";
      projectId: string;
      roomKey: string;
      conversationKey: string;
      projectName: string;
      projectType: "local" | "hosted";
    }
  | { ok: true; kind: "dm"; dmKey: string; from: string; to: string; conversationKey: string }
  | { ok: false; message: string };

function roomKeyFor(projectType: string, projectName: string): string {
  return `${projectType}:${projectName}`;
}

export function register(io: Server, socket: Socket, deps: GatewayDeps): void {
  const { chat, notifications, identity } = deps;

  const currentUsername = (): string =>
    identity().username ?? `anon:${socket.id.slice(0, 6)}`;

  /** Authorize + resolve the routing for a conversation payload. */
  async function resolveTarget(payload: ChatTargetPayload): Promise<ResolvedTarget> {
    if (payload.scope === "project") {
      if (!payload.projectName || !payload.projectType) {
        return { ok: false, message: "Project not specified" };
      }
      const auth = await chat.authorizeProject(
        payload.projectName,
        payload.projectType,
        identity().username,
        "view"
      );
      if (!auth.ok) return { ok: false, message: auth.message };
      return {
        ok: true,
        kind: "project",
        projectId: auth.projectId,
        roomKey: roomKeyFor(payload.projectType, payload.projectName),
        conversationKey: `project:${auth.projectId}`,
        projectName: payload.projectName,
        projectType: payload.projectType,
      };
    }
    const dm = await chat.resolveDm(identity().username, payload.to);
    if (!dm.ok) return { ok: false, message: dm.message };
    return {
      ok: true,
      kind: "dm",
      dmKey: dm.dmKey,
      from: dm.from,
      to: dm.to,
      conversationKey: `dm:${dm.dmKey}`,
    };
  }

  /** Emit a message event to whichever rooms the resolved target fans out to. */
  function emitToTarget(target: ResolvedTarget & { ok: true }, event: string, data: any): void {
    if (target.kind === "project") {
      io.to(target.roomKey).emit(event, data);
    } else {
      io.to(userRoom(target.to)).emit(event, data);
      io.to(userRoom(target.from)).emit(event, data);
    }
  }

  // ─── Send ────────────────────────────────────────────────────────────────
  socket.on("chat:send", async (data: unknown, ack?: Ack) => {
    const parsed = chatSendSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    const p = parsed.data;
    if (!identity().username) {
      ack?.({ success: false, message: "You must be signed in to chat" });
      return;
    }
    try {
      const target = await resolveTarget(p);
      if (!target.ok) {
        ack?.({ success: false, message: target.message });
        return;
      }
      const author = currentUsername();
      const replyToId = p.replyToId ?? null;

      const message =
        target.kind === "project"
          ? await chat.sendProjectMessage(target.projectId, author, p.body, replyToId)
          : await chat.sendDmMessage(target.dmKey, author, p.body, replyToId);

      emitToTarget(target, "chat:message", { message });
      // The sender has, by definition, seen their own message.
      await chat.markRead(author, target.conversationKey).catch(() => {});
      ack?.({ success: true, message });

      // Durable + live @mention notifications (project channels only). Best-effort.
      if (target.kind === "project") {
        const mentioned = parseMentions(p.body).filter((m) => m !== author);
        for (const recipient of new Set(mentioned)) {
          notifications
            .notify(io, {
              recipient,
              type: "mention",
              actor: author,
              projectName: target.projectName,
              projectType: target.projectType,
              title: `${author} mentioned you in chat`,
              body: p.body,
            })
            .catch((err) => console.error("[Chat] mention notify failed:", err));
        }
      }
    } catch (error: any) {
      console.error("[Chat] chat:send error:", error);
      ack?.({ success: false, message: clientError("send the message") });
    }
  });

  // ─── History ───────────────────────────────────────────────────────────────
  socket.on("chat:history", async (data: unknown, ack?: Ack) => {
    const parsed = chatHistorySchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    const p = parsed.data;
    try {
      const target = await resolveTarget(p);
      if (!target.ok) {
        ack?.({ success: false, message: target.message });
        return;
      }
      const before = p.before ?? null;
      const messages =
        target.kind === "project"
          ? await chat.listProjectMessages(target.projectId, before, p.limit)
          : await chat.listDmMessages(target.dmKey, before, p.limit);
      ack?.({ success: true, messages });
    } catch (error: any) {
      console.error("[Chat] chat:history error:", error);
      ack?.({ success: false, message: clientError("load messages") });
    }
  });

  // ─── Edit ────────────────────────────────────────────────────────────────
  socket.on("chat:edit", async (data: unknown, ack?: Ack) => {
    const parsed = chatEditSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    const p = parsed.data;
    if (!identity().username) {
      ack?.({ success: false, message: "You must be signed in to chat" });
      return;
    }
    try {
      const target = await resolveTarget(p);
      if (!target.ok) {
        ack?.({ success: false, message: target.message });
        return;
      }
      const updated = await chat.editMessage(p.id, currentUsername(), p.body);
      if (!updated) {
        ack?.({ success: false, message: "Message not found" });
        return;
      }
      emitToTarget(target, "chat:message:updated", { message: updated });
      ack?.({ success: true, message: updated });
    } catch (error: any) {
      console.error("[Chat] chat:edit error:", error);
      ack?.({ success: false, message: clientError("edit the message") });
    }
  });

  // ─── Delete ──────────────────────────────────────────────────────────────
  socket.on("chat:delete", async (data: unknown, ack?: Ack) => {
    const parsed = chatDeleteSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    const p = parsed.data;
    if (!identity().username) {
      ack?.({ success: false, message: "You must be signed in to chat" });
      return;
    }
    try {
      const target = await resolveTarget(p);
      if (!target.ok) {
        ack?.({ success: false, message: target.message });
        return;
      }
      const ok = await chat.deleteMessage(p.id, currentUsername());
      if (!ok) {
        ack?.({ success: false, message: "Message not found" });
        return;
      }
      emitToTarget(target, "chat:message:deleted", { id: p.id });
      ack?.({ success: true, id: p.id });
    } catch (error: any) {
      console.error("[Chat] chat:delete error:", error);
      ack?.({ success: false, message: clientError("delete the message") });
    }
  });

  // ─── Typing (fire-and-forget, NOT persisted) ──────────────────────────────
  socket.on("chat:typing", async (data: unknown) => {
    const parsed = chatTypingSchema.safeParse(data);
    if (!parsed.success) return;
    const p = parsed.data;
    if (!identity().username) return;
    try {
      const target = await resolveTarget(p);
      if (!target.ok) return;
      const from = currentUsername();
      const payload = { scope: p.scope, from, conversationKey: target.conversationKey };
      // Relay to peers except the sender.
      if (target.kind === "project") {
        socket.to(target.roomKey).emit("chat:typing", payload);
      } else {
        io.to(userRoom(target.to)).emit("chat:typing", payload);
      }
    } catch {
      /* typing is best-effort; ignore */
    }
  });

  // ─── Mark read ─────────────────────────────────────────────────────────────
  socket.on("chat:read", async (data: unknown, ack?: Ack) => {
    const parsed = chatReadSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    const p = parsed.data;
    if (!identity().username) {
      ack?.({ success: false, message: "You must be signed in to chat" });
      return;
    }
    try {
      const target = await resolveTarget(p);
      if (!target.ok) {
        ack?.({ success: false, message: target.message });
        return;
      }
      await chat.markRead(currentUsername(), target.conversationKey);
      ack?.({ success: true });
    } catch (error: any) {
      console.error("[Chat] chat:read error:", error);
      ack?.({ success: false, message: clientError("update read state") });
    }
  });

  // ─── Unread count for one project channel ─────────────────────────────────
  socket.on("chat:unread", async (data: unknown, ack?: Ack) => {
    const parsed = chatUnreadSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    const p = parsed.data;
    const username = identity().username;
    if (!username) {
      ack?.({ success: true, count: 0 });
      return;
    }
    try {
      const auth = await chat.authorizeProject(p.projectName, p.projectType, username, "view");
      if (!auth.ok) {
        ack?.({ success: false, message: auth.message });
        return;
      }
      const count = await chat.projectUnread(username, auth.projectId);
      ack?.({ success: true, count });
    } catch (error: any) {
      console.error("[Chat] chat:unread error:", error);
      ack?.({ success: false, message: clientError("load unread count") });
    }
  });

  // ─── DM conversation list (for the Messages page) ─────────────────────────
  socket.on("chat:conversations", async (data: unknown, ack?: Ack) => {
    const parsed = chatConversationsSchema.safeParse(data);
    if (!parsed.success) {
      ack?.({ success: false, message: formatZodError(parsed.error) });
      return;
    }
    const username = identity().username;
    if (!username) {
      ack?.({ success: true, conversations: [] });
      return;
    }
    try {
      const conversations = await chat.conversations(username);
      ack?.({ success: true, conversations });
    } catch (error: any) {
      console.error("[Chat] chat:conversations error:", error);
      ack?.({ success: false, message: clientError("load conversations") });
    }
  });
}
