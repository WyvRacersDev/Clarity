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

/** element:create — insert one element into a grid, then broadcast. */
export const elementCreateSchema = z
  .object({
    projectName: z.string(),
    projectType: projectTypeSchema,
    gridId: z.string().optional(), // falls back to the project's first grid
    element: looseObject,
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
