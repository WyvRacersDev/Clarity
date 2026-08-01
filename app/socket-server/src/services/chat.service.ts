/**
 * ChatService — the single business boundary for collaborator chat.
 *
 * Two conversation scopes:
 *   - PROJECT channels — a room-wide chat for a project. Access is delegated to
 *     the AccessService (N1): anyone with at least VIEW on the project may read
 *     and post (chat is communication, not content editing, so viewers are
 *     included). Broadcast to the existing room `${projectType}:${projectName}`.
 *   - DIRECT messages — 1:1 between two users. Allowed only between users who
 *     share at least one project (they are actual collaborators), keyed by a
 *     stable `dmKey` derived from their canonical usernames.
 *
 * The gateway depends on THIS abstraction (DIP); it keeps only transport
 * concerns (validate → call service → ack/broadcast). Authorization + DM
 * resolution live here (SRP), mirroring CollabService over AccessService.
 */
import {
  AccessService,
  type Capability,
  type AuthResult,
} from "./access.service.js";
import { resolveUser } from "../repositories/identity.repository.js";
import {
  dmKeyFor,
  insertProjectMessage,
  insertDmMessage,
  listProjectMessages,
  listDmMessages,
  editMessage as repoEditMessage,
  deleteMessage as repoDeleteMessage,
  markRead as repoMarkRead,
  projectUnreadCount,
  listDmConversations,
  usersShareAnyProject,
  toggleReaction as repoToggleReaction,
  getMessageRouting,
  type SerializedMessage,
  type MessageAttachment,
  type ReactionSet,
  type DmSummary,
} from "../repositories/message.repository.js";

export type ProjectType = "local" | "hosted";

/** Resolved DM addressing: the stable key plus both canonical usernames. */
export type DmResolve =
  | { ok: true; dmKey: string; from: string; to: string }
  | { ok: false; message: string };

export class ChatService {
  constructor(private readonly access: AccessService = new AccessService()) {}

  // ─── Project channels ──────────────────────────────────────────────────────

  /** Authorize a user for `capability` on a project (defaults to VIEW for chat). */
  authorizeProject(
    projectName: string,
    projectType: ProjectType,
    username: string | undefined,
    capability: Capability = "view"
  ): Promise<AuthResult> {
    return this.access.authorize(projectName, projectType, username, capability);
  }

  sendProjectMessage(
    projectId: string,
    author: string,
    body: string,
    replyToId: string | null = null,
    attachments: MessageAttachment[] = []
  ): Promise<SerializedMessage> {
    return insertProjectMessage(projectId, author, body, replyToId, attachments);
  }

  listProjectMessages(
    projectId: string,
    before: string | null,
    limit?: number
  ): Promise<SerializedMessage[]> {
    return listProjectMessages(projectId, before, limit);
  }

  projectUnread(reader: string, projectId: string): Promise<number> {
    return projectUnreadCount(reader, projectId);
  }

  // ─── Direct messages ───────────────────────────────────────────────────────

  /**
   * Resolve + authorize a 1:1 DM between `fromIdentity` and `toIdentity`. Both
   * must be registered users, must not be the same person, and must share at
   * least one project. Returns the stable dmKey and both canonical usernames
   * (so the caller keys/labels the conversation consistently).
   */
  async resolveDm(
    fromIdentity: string | undefined,
    toIdentity: string | undefined
  ): Promise<DmResolve> {
    if (!fromIdentity) return { ok: false, message: "You must be signed in to chat" };
    if (!toIdentity) return { ok: false, message: "No recipient specified" };

    const [fromUser, toUser] = await Promise.all([
      resolveUser(fromIdentity),
      resolveUser(toIdentity),
    ]);
    if (!fromUser) return { ok: false, message: "You must be signed in to chat" };
    if (!toUser) return { ok: false, message: "User not found" };
    if (fromUser.id === toUser.id) return { ok: false, message: "You can't message yourself" };

    const share = await usersShareAnyProject(fromUser.id, toUser.id);
    if (!share) {
      return { ok: false, message: "You can only message collaborators you share a project with" };
    }
    return {
      ok: true,
      dmKey: dmKeyFor(fromUser.username, toUser.username),
      from: fromUser.username,
      to: toUser.username,
    };
  }

  sendDmMessage(
    dmKey: string,
    author: string,
    body: string,
    replyToId: string | null = null,
    attachments: MessageAttachment[] = []
  ): Promise<SerializedMessage> {
    return insertDmMessage(dmKey, author, body, replyToId, attachments);
  }

  listDmMessages(
    dmKey: string,
    before: string | null,
    limit?: number
  ): Promise<SerializedMessage[]> {
    return listDmMessages(dmKey, before, limit);
  }

  /** All DM conversations the reader participates in (for the Messages page). */
  conversations(reader: string): Promise<DmSummary[]> {
    return listDmConversations(reader);
  }

  // ─── Edit / delete (author-scoped in the repository) ───────────────────────

  editMessage(id: string, author: string, body: string): Promise<SerializedMessage | null> {
    return repoEditMessage(id, author, body);
  }

  deleteMessage(id: string, author: string): Promise<boolean> {
    return repoDeleteMessage(id, author);
  }

  // ─── Reactions (E1) ────────────────────────────────────────────────────────

  /**
   * Toggle `reader`'s `emoji` reaction on a message, but only if that message
   * actually belongs to the conversation the caller has already been authorized
   * for (`constraint`). This stops a user with access to conversation A from
   * reacting to a message in conversation B by passing A's target + B's id.
   * Returns the message's full reaction set, or null if it isn't in scope.
   */
  async toggleReaction(
    messageId: string,
    emoji: string,
    reader: string,
    constraint: { projectId: string } | { dmKey: string }
  ): Promise<ReactionSet[] | null> {
    const routing = await getMessageRouting(messageId);
    if (!routing) return null;
    const inScope =
      "projectId" in constraint
        ? routing.scope === "project" && routing.projectId === constraint.projectId
        : routing.scope === "dm" && routing.dmKey === constraint.dmKey;
    if (!inScope) return null;
    return repoToggleReaction(messageId, emoji, reader);
  }

  // ─── Read cursors ──────────────────────────────────────────────────────────

  markRead(reader: string, conversationKey: string): Promise<void> {
    return repoMarkRead(reader, conversationKey);
  }
}
