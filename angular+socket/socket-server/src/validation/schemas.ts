/**
 * zod validation schemas (Phase 6a).
 *
 * Additive input validation for every Socket.IO event payload and the REST auth
 * bodies. The goal is to reject *malformed* input (missing/wrong-typed required
 * fields) WITHOUT tightening beyond the real shape the handlers accept:
 *   - the project / user objects are validated loosely (`passthrough`) because
 *     the handlers deliberately accept the full serialized structure and only
 *     read a handful of fields;
 *   - the optional `eventName` / `requestId` fields that the current handlers
 *     read are accepted (never rejected);
 *   - unknown extra keys are allowed (`.passthrough()`) so we never reject a
 *     payload the success path would have handled.
 *
 * Success-path behavior is unchanged: a payload that passed before still passes.
 */
import { z } from "zod";

/** projectType is 'local' | 'hosted' across the contract. */
const projectTypeSchema = z.enum(["local", "hosted"]);

/**
 * Loose object for the serialized Project/User blobs. We only assert it is a
 * (non-null) object; individual fields are read defensively by the handlers.
 */
const looseObject = z.object({}).passthrough();

// === Project events ===

export const saveProjectSchema = z
  .object({
    // The handler derives projectType from data.projectType OR data.project.project_type,
    // so projectType here is optional. `project` must be an object.
    project: looseObject,
    projectType: projectTypeSchema.optional(),
    // A16: when true, the save is a CREATE — the handler rejects it (rather than
    // silently upserting/overwriting) if a project with the same owner+name+type
    // already exists. Absent/false preserves the legacy upsert-on-save behavior
    // that every edit relies on.
    expectNew: z.boolean().optional(),
  })
  .passthrough();

export const loadProjectSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    eventName: z.string().optional(),
  })
  .passthrough();

export const listProjectsSchema = z
  .object({
    projectType: projectTypeSchema,
    requestId: z.string().optional(),
  })
  .passthrough();

export const deleteProjectSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
  })
  .passthrough();

// === Collab / granular realtime events (Phase 6b) ===

/** Room join/leave: identify the project room by name + type. */
export const joinProjectRoomSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
  })
  .passthrough();

export const leaveProjectRoomSchema = joinProjectRoomSchema;

/**
 * The four element kinds the persistence layer actually understands. Anything
 * else was previously coerced silently to Text_document (A9), so we reject an
 * explicit unknown `type` here instead. `type` stays optional because the
 * repository can still infer it from the element's shape when it's absent.
 */
const elementTypeSchema = z.enum(["Text_document", "Image", "Video", "ToDoLst"]);

/**
 * A9: validate the fields that were being silently coerced on `element:create`
 * — an unknown `type` (e.g. "Hologram") became Text_document, and a non-numeric
 * coordinate (e.g. x_pos:"left") became 0 — both while still returning
 * success:true. We now reject those up front. Every other field is passed
 * through untouched (`.passthrough()`), so the full serialized element shape the
 * handler reads is preserved.
 */
const elementInputSchema = z
  .object({
    type: elementTypeSchema.optional(),
    x_pos: z.number().optional(),
    y_pos: z.number().optional(),
    x_scale: z.number().optional(),
    y_scale: z.number().optional(),
  })
  .passthrough();

/** element:create — insert one element into a grid, then broadcast. */
export const elementCreateSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    gridId: z.string().optional(), // falls back to the project's first grid
    element: elementInputSchema,
    // E10: client-generated idempotency key. A create replayed after a
    // reconnect (or an app-level retry) carries the same opId, so the server
    // can collapse it to the original insert instead of duplicating the row.
    opId: z.string().max(128).optional(),
  })
  .passthrough();

/** element:move — update a single element's transform. */
export const elementMoveSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    elementId: z.string(),
    x_pos: z.number().optional(),
    y_pos: z.number().optional(),
    x_scale: z.number().optional(),
    y_scale: z.number().optional(),
  })
  .passthrough();

/** element:update — merge a content patch into an element's JSONB content. */
export const elementUpdateSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    elementId: z.string(),
    content: looseObject,
  })
  .passthrough();

/** element:delete — remove a single element. */
export const elementDeleteSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    elementId: z.string(),
  })
  .passthrough();

/** cursor:move — high-frequency, fire-and-forget cursor broadcast. */
export const cursorMoveSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    x: z.number(),
    y: z.number(),
  })
  .passthrough();

// === Collaborative text (B3 — Yjs) ===

/**
 * ydoc:sync — a client opening a Text_document editor asks the server for the
 * authoritative doc state. `stateVector` (base64, optional) lets the server
 * reply with only the diff the client is missing.
 */
export const ydocSyncSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    elementId: z.string(),
    stateVector: z.string().optional(),
  })
  .passthrough();

/**
 * ydoc:update — a base64-encoded Yjs update. Applied to the authoritative
 * server doc, broadcast to the room (except sender), and debounce-persisted.
 */
export const ydocUpdateSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    elementId: z.string(),
    update: z.string().min(1),
  })
  .passthrough();

/**
 * ydoc:awareness — a base64-encoded Yjs awareness update (remote cursors /
 * selections). Relayed to the room (except sender); NOT persisted.
 */
export const ydocAwarenessSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    elementId: z.string(),
    update: z.string().min(1),
  })
  .passthrough();

// === Task comments (A3) ===

/**
 * task:comment:add — persist a comment on a task, then ack + broadcast.
 * projectName/projectType identify the room to broadcast `task:comment:added`
 * into (same room-key pattern as the other collab events). `body` must be
 * non-empty; `author` is derived server-side from identity(), never trusted
 * from the payload.
 */
export const taskCommentAddSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    taskId: z.string(),
    body: z.string().min(1),
  })
  .passthrough();

/** task:comment:list — fetch the comment thread for a task. */
export const taskCommentListSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    taskId: z.string(),
  })
  .passthrough();

// === Element comments (E6 — canvas comment pins) ===

/**
 * comment:create — pin a comment to a canvas element, then ack + broadcast.
 * `elementId` is verified to belong to the named project (requireElement guard).
 * `body` must be non-empty; `author` is derived server-side from identity(),
 * never trusted from the payload.
 */
export const commentCreateSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    elementId: z.string(),
    body: z.string().min(1),
  })
  .passthrough();

/** comment:list — fetch every comment pin for a project (all elements). */
export const commentListSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
  })
  .passthrough();

/** comment:resolve — mark a comment resolved (or re-open it). */
export const commentResolveSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    commentId: z.string(),
    resolved: z.boolean(),
  })
  .passthrough();

/** comment:delete — remove a single comment. */
export const commentDeleteSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    commentId: z.string(),
  })
  .passthrough();

// === Canvas version history (E8 — project snapshots) ===

/** snapshot:create — save a named manual checkpoint of the current canvas. */
export const snapshotCreateSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    label: z.string().max(100).optional(),
  })
  .passthrough();

/** snapshot:list — a project's version timeline (metadata only). */
export const snapshotListSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
  })
  .passthrough();

/** snapshot:restore — full-replace the canvas with a stored version. */
export const snapshotRestoreSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    snapshotId: z.string(),
  })
  .passthrough();

// === Sharing / access control (N1) ===

/** Collaborator roles an owner/admin can assign (owner is implicit, not set). */
const collaboratorRoleSchema = z.enum(["viewer", "editor", "admin"]);

/** Identify a project for a sharing operation. */
const shareTargetSchema = z.object({
  projectName: z.string(),
  projectType: projectTypeSchema,
});

/** sharing:get — read members + pending invites + link config for a project. */
export const sharingGetSchema = shareTargetSchema.passthrough();

/** sharing:invite — invite an email at a role (existing user → member; else pending). */
export const sharingInviteSchema = shareTargetSchema
  .extend({
    email: z.string().min(3),
    role: collaboratorRoleSchema.optional(), // defaults to 'editor' server-side
  })
  .passthrough();

/** sharing:updateRole — change a collaborator's role. */
export const sharingUpdateRoleSchema = shareTargetSchema
  .extend({
    userId: z.string(),
    role: collaboratorRoleSchema,
  })
  .passthrough();

/** sharing:removeMember — revoke a collaborator's access. */
export const sharingRemoveMemberSchema = shareTargetSchema
  .extend({ userId: z.string() })
  .passthrough();

/** sharing:revokeInvite — cancel a pending email invitation. */
export const sharingRevokeInviteSchema = shareTargetSchema
  .extend({ email: z.string().min(3) })
  .passthrough();

/** sharing:setLink — set "anyone with the link" access (none/viewer/editor). */
export const sharingSetLinkSchema = shareTargetSchema
  .extend({ role: z.enum(["none", "viewer", "editor"]) })
  .passthrough();

// === Notifications / activity feed (N2) ===

/** notification:list — page the caller's inbox (optional cap). */
export const notificationListSchema = z
  .object({ limit: z.number().int().positive().max(100).optional() })
  .passthrough();

/** notification:markRead — mark one of the caller's notifications read. */
export const notificationMarkReadSchema = z
  .object({ id: z.string() })
  .passthrough();

/** notification:feed — a project's activity feed (view access required). */
export const notificationFeedSchema = shareTargetSchema
  .extend({ limit: z.number().int().positive().max(100).optional() })
  .passthrough();

// === Chat (project channels + 1:1 DMs) ===

/** A conversation is either a project channel or a 1:1 DM. */
const chatScopeSchema = z.enum(["project", "dm"]);

/**
 * Shared conversation-addressing fields. A 'project' scope carries
 * projectName+projectType (the room); a 'dm' scope carries `to` (the partner's
 * username). Kept loose here — the gateway/ChatService turn a missing/mismatched
 * field into a clean ack error, so we never reject a payload the success path
 * would have routed.
 */
const chatTargetShape = {
  scope: chatScopeSchema,
  projectName: z.string().optional(),
  projectType: projectTypeSchema.optional(),
  to: z.string().optional(),
};

/** One uploaded file attached to a message (E2). */
export const chatAttachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
});

/**
 * chat:send — post a message to a project channel or a DM. A message must carry
 * either non-empty body text or at least one attachment (E2), so an image can be
 * sent with no caption while empty sends are still rejected.
 */
export const chatSendSchema = z
  .object({
    ...chatTargetShape,
    body: z.string().max(10000).default(""),
    replyToId: z.string().optional(),
    attachments: z.array(chatAttachmentSchema).max(10).optional(),
  })
  .passthrough()
  .refine((d) => d.body.trim().length > 0 || (d.attachments?.length ?? 0) > 0, {
    message: "Message must have text or an attachment",
    path: ["body"],
  });

/** chat:react — toggle an emoji reaction on a message (E1). */
export const chatReactSchema = z
  .object({
    ...chatTargetShape,
    id: z.string(),
    emoji: z.string().min(1).max(32),
  })
  .passthrough();

/** chat:history — page a conversation, oldest-first, older than `before`. */
export const chatHistorySchema = z
  .object({
    ...chatTargetShape,
    before: z.string().optional(), // ISO timestamp cursor
    limit: z.number().int().positive().max(100).optional(),
  })
  .passthrough();

/** chat:edit — change your own message's body. */
export const chatEditSchema = z
  .object({
    ...chatTargetShape,
    id: z.string(),
    body: z.string().min(1),
  })
  .passthrough();

/** chat:delete — remove your own message. */
export const chatDeleteSchema = z
  .object({ ...chatTargetShape, id: z.string() })
  .passthrough();

/** chat:call:start — mint a shared call link and post it into the conversation. */
export const chatCallSchema = z.object({ ...chatTargetShape }).passthrough();

/** chat:typing — high-frequency, fire-and-forget typing indicator. */
export const chatTypingSchema = z.object({ ...chatTargetShape }).passthrough();

/** chat:read — mark a conversation read up to now. */
export const chatReadSchema = z.object({ ...chatTargetShape }).passthrough();

/** chat:unread — unread count for one project channel. */
export const chatUnreadSchema = z
  .object({ projectName: z.string(), projectType: projectTypeSchema })
  .passthrough();

/** chat:conversations — list the caller's DM conversations (no payload). */
export const chatConversationsSchema = z.object({}).passthrough();

// === User events ===

export const saveUserSchema = z
  .object({
    user: looseObject,
  })
  .passthrough();

export const loadUserSchema = z
  .object({
    username: z.string(),
    eventName: z.string().optional(),
  })
  .passthrough();

export const listUsersSchema = z
  .object({
    requestId: z.string().optional(),
  })
  .passthrough();

export const deleteUserSchema = z
  .object({
    username: z.string(),
  })
  .passthrough();

export const checkUserExistsSchema = z
  .object({
    username: z.string(),
  })
  .passthrough();

export const identifyUserSchema = z
  .object({
    username: z.string(),
  })
  .passthrough();

// === File events ===

export const uploadFileSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    fileName: z.string(),
    fileData: z.string(),
    fileType: z.enum(["image", "video"]),
    eventName: z.string().optional(),
  })
  .passthrough();

export const deleteFileSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    filePath: z.string(),
    eventName: z.string().optional(),
  })
  .passthrough();

// === Contacts ===

export const importGoogleContactsSchema = z
  .object({
    username: z.string(),
  })
  .passthrough();

// === REST auth bodies ===

export const registerSchema = z.object({
  email: z.string(),
  username: z.string(),
  password: z.string(),
});

// login accepts `identifier` OR email/username (any one), plus password.
export const loginSchema = z
  .object({
    identifier: z.string().optional(),
    email: z.string().optional(),
    username: z.string().optional(),
    password: z.string(),
  })
  .refine((b) => !!(b.identifier ?? b.email ?? b.username), {
    message: "identifier (or email/username) is required",
  });

/**
 * Format a ZodError into a single human-readable message string, matching the
 * `{ success:false, message:"<validation error>" }` socket response contract
 * and the HTTP 400 `{ error }` REST contract.
 */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const pathStr = i.path.length ? i.path.join(".") : "(root)";
      return `${pathStr}: ${i.message}`;
    })
    .join("; ");
}
