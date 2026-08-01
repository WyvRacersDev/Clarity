import { z, ZodType } from 'zod';

/**
 * Runtime schemas for INBOUND Socket.IO payloads — the app's real untrusted
 * boundary. Every event modelled here originates off this client (the server
 * relaying another collaborator's action), so its shape is validated before it
 * reaches component state. See `validate.ts` for the non-throwing wrapper.
 *
 * Design notes:
 * - Envelopes are validated STRICTLY on the fields the UI reads (ids, numbers,
 *   discriminators). Type-specific / evolving payloads use `looseObject` /
 *   `unknown` so additive backend changes don't reject otherwise-valid events.
 * - Schemas mirror `shared_models/models/screen-elements.model.ts#toJSON()` and
 *   the emit/`on*` contracts in `services/socket.service.ts`.
 */

/**
 * A serialized Screen_Element (base envelope). Matches Screen_Element.toJSON():
 * a required `type` discriminator + name + numeric position/scale, an optional
 * stable `id`, and any number of subclass-specific fields (Text_field,
 * imagepath, VideoPath, scheduled_tasks, …) which pass through untouched.
 */
export const elementSchema = z.looseObject({
  type: z.string().min(1),
  id: z.string().optional(),
  name: z.union([z.string(), z.number()]).transform((v) => String(v)),
  x_pos: z.number(),
  y_pos: z.number(),
  x_scale: z.number(),
  y_scale: z.number(),
});

// --- Legacy per-project events (onElementUpdate / onTaskUpdate / onUserActivity)

/** `elementUpdate` → `{ element, projectId, gridId }`. */
export const elementUpdateSchema = z.looseObject({
  element: elementSchema,
  projectId: z.string(),
  gridId: z.string(),
});

/** `taskUpdate` → `{ task, projectId }`. Task shape is broad; keep it loose. */
export const taskUpdateSchema = z.looseObject({
  task: z.looseObject({}),
  projectId: z.string(),
});

/** `userActivity` → free-form presence blob; only require it be an object. */
export const userActivitySchema = z.looseObject({});

// --- Granular collaborative element ops (peer broadcasts via onEvent) ---------

/** `element:created` → `{ gridId, element }`. */
export const elementCreatedSchema = z.looseObject({
  gridId: z.string(),
  element: elementSchema,
});

/** `element:moved` → `{ elementId, x_pos, y_pos, x_scale, y_scale }`. */
export const elementMovedSchema = z.looseObject({
  elementId: z.string(),
  x_pos: z.number(),
  y_pos: z.number(),
  x_scale: z.number(),
  y_scale: z.number(),
});

/** `element:updated` → `{ elementId, content }` (content is a JSONB patch). */
export const elementUpdatedSchema = z.looseObject({
  elementId: z.string(),
  content: z.unknown(),
});

/** `element:deleted` → `{ elementId }`. */
export const elementDeletedSchema = z.looseObject({
  elementId: z.string(),
});

/** `cursor:moved` → `{ username, x, y }`. */
export const cursorMovedSchema = z.looseObject({
  username: z.string(),
  x: z.number(),
  y: z.number(),
});

/** `presence:update` → `{ room, users: [{ username }] }`. */
export const presenceUpdateSchema = z.looseObject({
  room: z.string(),
  users: z.array(z.looseObject({ username: z.string() })),
});

// --- Chat (project channels + 1:1 DMs) ---

/** A serialized chat message (loose: extra fields like dmKey/replyToId pass). */
export const chatMessageBodySchema = z.looseObject({
  id: z.string(),
  scope: z.string(),
  author: z.string(),
  body: z.string(),
  created_at: z.string(),
});

/** `chat:message` / `chat:message:updated` → `{ message }`. */
export const chatMessageSchema = z.looseObject({
  message: chatMessageBodySchema,
});

/** `chat:message:deleted` → `{ id }`. */
export const chatMessageDeletedSchema = z.looseObject({
  id: z.string(),
});

/** `chat:typing` → `{ scope, from, conversationKey }`. */
export const chatTypingSchema = z.looseObject({
  scope: z.string(),
  from: z.string(),
  conversationKey: z.string(),
});

// --- E6: canvas comment pins (element_comments) ---

/** A serialized element comment (loose: resolvedBy/resolvedAt may be null). */
export const elementCommentBodySchema = z.looseObject({
  id: z.string(),
  projectId: z.string(),
  elementId: z.string(),
  author: z.string(),
  body: z.string(),
  created_at: z.string(),
});

/** `comment:created` / `comment:resolved` → `{ comment }`. */
export const elementCommentSchema = z.looseObject({
  comment: elementCommentBodySchema,
});

/** `comment:deleted` → `{ commentId, elementId }`. */
export const elementCommentDeletedSchema = z.looseObject({
  commentId: z.string(),
  elementId: z.string(),
});

/**
 * Registry mapping a Socket.IO event name → its schema. `onEvent()` consults
 * this: events WITH an entry are validated (invalid payloads dropped); events
 * WITHOUT one pass through unchanged, so unmodelled/evolving channels keep
 * working. Extend by adding a schema above and a line here — no handler edits.
 */
export const INBOUND_SCHEMAS: Readonly<Record<string, ZodType>> = {
  'element:created': elementCreatedSchema,
  'element:moved': elementMovedSchema,
  'element:updated': elementUpdatedSchema,
  'element:deleted': elementDeletedSchema,
  'cursor:moved': cursorMovedSchema,
  'presence:update': presenceUpdateSchema,
  'chat:message': chatMessageSchema,
  'chat:message:updated': chatMessageSchema,
  'chat:message:deleted': chatMessageDeletedSchema,
  'chat:typing': chatTypingSchema,
  'comment:created': elementCommentSchema,
  'comment:resolved': elementCommentSchema,
  'comment:deleted': elementCommentDeletedSchema,
};
