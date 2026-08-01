
import dayjs from 'dayjs'; //for scheduled_task ki class 

export abstract class Screen_Element {

  id?: string; // stable DB uuid (Phase 6b). Optional/additive: old payloads omit it.
  // Optional discriminator/payload fields that persistence & serialization code
  // duck-types against on the base type. Additive; subclasses may make them
  // required (e.g. ToDoLst.scheduled_tasks).
  type?: string;
  scheduled_tasks?: scheduled_task[];
  name: String;
  x_pos: number;  //BRUH WDYM "number", int/float better
  y_pos: number;
  x_scale: number;
  y_scale: number;

  constructor(name: string, x_pos: number, y_pos: number, x_scale: number = 1, y_scale: number = 1) {
    console.log("Screen_Element object created at position ", x_pos, " and ", y_pos)
    this.name = name;
    this.x_pos = x_pos;
    this.y_pos = y_pos;
    this.x_scale = x_scale;
    this.y_scale = y_scale;

  }

  get_name(): String {
    return this.name;
  }

  set_name(new_name: String) {
    this.name = new_name
    console.log("name changed to", new_name)
  }

  get_xpos(): number {
    return this.x_pos
  }

  get_ypos(): number {
    return this.y_pos
  }

  set_xpos(xpos: number) {
    this.x_pos = xpos
    console.log("x position modified to ", this.x_pos)
  }

  set_ypos(ypos: number) {
    this.y_pos = ypos
    console.log("y position modified to ", this.y_pos)
  }

  get_x_scale(): number {
    return this.x_scale;
  }

  get_y_scale(): number {
    return this.y_scale;
  }

  set_x_scale(scale: number) {
    this.x_scale = scale;
  }

  set_y_scale(scale: number) {
    this.y_scale = scale;
  }

  toJSON() //need to send json objects over the network
  {
    return {
      // Prefer the explicit `type` discriminator (set by every subclass ctor) —
      // it survives frontend minification, unlike `constructor.name`.
      type: this.type ?? this.constructor.name,
      // Include the stable id only when present (backward-compatible).
      ...(this.id !== undefined ? { id: this.id } : {}),
      name: this.name,
      x_pos: this.x_pos,
      y_pos: this.y_pos,
      x_scale: this.x_scale,
      y_scale: this.y_scale
    };
  }

  /**
   * The type-specific fields persisted in the DB `content` JSONB column — i.e.
   * everything in `toJSON()` except the shared base columns (type/id/name/pos/
   * scale) and, for ToDoLst, its tasks (which live in their own `tasks` table).
   * Overridden per subclass so the persistence layer never switches on type.
   */
  toContent(): Record<string, unknown> {
    return {};
  }
}

export class Text_document extends Screen_Element {
  Text_field: string;
  // B3: base64-encoded Yjs document state for collaborative rich-text editing.
  // Additive/optional — old payloads omit it. `Text_field` is kept as the plain
  // -text mirror (previews, non-collab reads); `ydoc` is the source of truth for
  // the rich content when co-editing. Rides along in `content` JSONB so a whole
  // -project save round-trips it without clobbering the collaborative state.
  ydoc?: string;

  constructor(name: string, x_pos: number, y_pos: number, text_field: string) {
    super(name, x_pos, y_pos);
    this.type = 'Text_document';
    this.Text_field = text_field;
    console.log("Text object created")
  }

  set_field(text: string) {
    this.Text_field = text
  }

  get_field(): string {
    return this.Text_field
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      Text_field: this.Text_field,
      ...(this.ydoc !== undefined ? { ydoc: this.ydoc } : {})
    };
  }

  override toContent(): Record<string, unknown> {
    return {
      Text_field: this.Text_field,
      // B3: only persist ydoc when present, so a whole-project save never writes
      // a null over a freshly-persisted granular ydoc:update.
      ...(this.ydoc != null ? { ydoc: this.ydoc } : {}),
    };
  }

}

export class Image extends Screen_Element {
  imagepath: string;
  imageFile?: Buffer;  // The actual image data

  constructor(image_path: string, x_pos: number, y_pos: number, image_name: string) {
    super(image_name, x_pos, y_pos);
    this.type = 'Image';
    this.imagepath = image_path;
    //this.imageFile = fs.readFileSync(image_path);
    console.log("Image object created")
  }

  override toJSON() {
    return {
      ...super.toJSON(), // Includes: type, name, x_pos, y_pos, x_scale, y_scale
      imagepath: this.imagepath, // Include the path (now points to local file URL)
      ImageBase64: this.imageFile || null, // Keep for backward compatibility (base64 data)
    };
  }

  override toContent(): Record<string, unknown> {
    return { imagepath: this.imagepath };
  }
}

export class Video extends Screen_Element {
  VideoPath: string;
  VideoFile?: string;  // The actual image data 

  constructor(video_path: string, x_pos: number, y_pos: number, video_name: string) {
    super(video_name, x_pos, y_pos);
    this.type = 'Video';
    this.VideoPath = video_path;
    //this.imageFile = fs.readFileSync(image_path);
    console.log("Video object created")
  }

  override toJSON() {
    return {
      ...super.toJSON(), // Includes: type, name, x_pos, y_pos, x_scale, y_scale
      VideoPath: this.VideoPath, // Include the path (now points to local file URL)
      videoBase64: this.VideoFile || null // Keep for backward compatibility (base64 data)
    };
  }

  override toContent(): Record<string, unknown> {
    return { VideoPath: this.VideoPath };
  }
}

// Recurrence rule for a repeating task. 'none' = one-off (default, backward-compatible). (N7)
export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly';
export const REPEAT_RULES: RepeatRule[] = ['none', 'daily', 'weekly', 'monthly'];

// Kanban lane for a task (N6). This is the richer, authoritative view of a task's
// progress; `is_done` remains a derived mirror of it (done ⟺ is_done) so every
// existing consumer of `is_done` (analytics, dependencies, recurrence, the tasks
// screen) keeps working unchanged. Mutations go through the scheduled_task methods
// below, which keep the two in lockstep — there is a single source of truth.
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];

/** Pure helper (SRP): coerce any value into a valid TaskStatus, honouring the
 * done/is_done invariant. A truthy `isDone` always wins ('done'); otherwise an
 * unknown/'done' value degrades to 'todo'. Shared by the model and the repo. */
export function normalizeStatus(value: any, isDone: boolean): TaskStatus {
  if (isDone) return 'done';
  return value === 'todo' || value === 'in_progress' ? value : 'todo';
}

/**
 * Pure helper (SRP): given an ISO time and a repeat rule, return the ISO time of the
 * next occurrence, or null when the task does not repeat / has no time to advance from.
 * Kept as a standalone function so both the frontend and backend can reuse it and it
 * stays trivially testable, independent of the scheduled_task class.
 */
export function nextOccurrence(time: string, repeat: RepeatRule): string | null {
  if (repeat === 'none' || !time) return null;
  const base = dayjs(time);
  if (!base.isValid()) return null;
  switch (repeat) {
    case 'daily':
      return base.add(1, 'day').toISOString();
    case 'weekly':
      return base.add(1, 'week').toISOString();
    case 'monthly':
      return base.add(1, 'month').toISOString();
    default:
      return null;
  }
}

export class scheduled_task {
  id?: string; // stable DB uuid for the task row. Optional/additive: old payloads omit it.
  taskname: string;
  priority: number;
  is_done: boolean;
  time: string; //will compare this with the dayjs thing on the fly
  completion_time: string | null; //time when task was completed
  creation_time: string = dayjs().toISOString(); //time when task was created
  completed_by: string | null; //username of who completed the task
  notified: boolean; //to check if notification has been sent for this task
  calendar_event_id: string | null; //to store google calendar event id if synced
  repeat: RepeatRule = 'none'; //recurrence rule; 'none' means one-off (N7)
  status: TaskStatus = 'todo'; //kanban lane (N6); kept in sync with is_done (done ⟺ is_done)
  constructor(taskname: string, priority: number, time: string) {
    this.taskname = taskname;
    this.priority = priority;
    this.time = time;
    this.is_done = false;
    this.notified = false;
    this.completion_time = null;
    this.completed_by = null;
    this.calendar_event_id = null;
  }

  set_repeat(rule: RepeatRule) {
    this.repeat = rule;
  }

  /**
   * When this task repeats and has a time, build the next occurrence: a fresh, not-done
   * task with the same name/priority/repeat rule and the advanced time. Returns null for
   * one-off tasks. The new task carries no id so it persists as a new row.
   */
  build_next_occurrence(): scheduled_task | null {
    const next = nextOccurrence(this.time, this.repeat);
    if (next === null) return null;
    const clone = new scheduled_task(this.taskname, this.priority, next);
    clone.repeat = this.repeat;
    return clone;
  }

  edit_priority(new_pr: number) {
    this.priority = new_pr
  }

  get_priority(): number {
    return this.priority
  }

  set_time(time: string) {
    this.time = time
  }

  get_time(): string {
    return this.time
  }
  get_notified(): boolean {
    return this.notified
  }

  set_notified(status: boolean) {
    this.notified = status
  }

  get_status(): boolean {
    return this.is_done
  }

  toggle_done_status() {
    this.is_done = !this.is_done;
    // Keep the kanban lane consistent (N6). Toggling on lands in Done; toggling
    // off returns to To Do (an 'in_progress' task that is un-done falls back to
    // the backlog, which is the least-surprising lane).
    this.status = this.is_done ? 'done' : 'todo';
  }
  mark_complete(completed_by_username: string) {
    this.is_done = true;
    this.status = 'done';
    this.completion_time = dayjs().toISOString();
    this.completed_by = completed_by_username;
  }
  mark_incomplete() {
    this.is_done = false;
    this.status = 'todo';
    this.completion_time = null;
    this.completed_by = null;
  }

  get_kanban_status(): TaskStatus {
    return this.status;
  }

  /**
   * Move a task between kanban lanes (N6), keeping the done/is_done invariant.
   * Landing in 'done' completes the task (stamping completion time, and the
   * optional completer); leaving 'done' reopens it. This is the single mutation
   * point the board uses so the two fields never drift.
   */
  set_status(status: TaskStatus, completed_by_username: string | null = null) {
    this.status = status;
    if (status === 'done') {
      this.is_done = true;
      if (!this.completion_time) this.completion_time = dayjs().toISOString();
      if (completed_by_username !== null) this.completed_by = completed_by_username;
    } else {
      this.is_done = false;
      this.completion_time = null;
      this.completed_by = null;
    }
  }

  get_completion_time() {
    return this.completion_time;
  }
  get_completed_by() {
    return this.completed_by;
  }
  get_creation_time() {
    return this.creation_time;
  }
  get_calendar_event_id() {
    return this.calendar_event_id;
  }
  set_calendar_event_id(event_id: string) {
    this.calendar_event_id = event_id;
  }

  toJSON() {
    return {
      // Stable discriminator literal, NOT `this.constructor.name` — the latter is
      // mangled by the frontend build (e.g. "_scheduled_task"), which then fails
      // to match `objects_builder.rebuild`'s `case 'scheduled_task'` on the server
      // and left the task a plain object, crashing ToDoLst.toJSON on save. Mirrors
      // how Screen_Element subclasses carry an explicit `type`.
      type: 'scheduled_task',
      // Include the stable id only when present (backward-compatible).
      ...(this.id !== undefined ? { id: this.id } : {}),
      taskname: this.taskname,
      priority: this.priority,
      is_done: this.is_done,
      time: this.time,
      completion_time: this.completion_time,
      completed_by: this.completed_by,
      creation_time: this.creation_time,
      calendar_event_id: this.calendar_event_id,
      notified: this.notified,
      repeat: this.repeat,
      status: this.status
    };
  }

}

export class ToDoLst extends Screen_Element {
  override scheduled_tasks: scheduled_task[] = [];
  collaborators: string[] = []; // list of usernames who can collaborate on this todo list
  tags: string[] = []; //tags for the todo list
  dependsOn: string[] = []; // element ids of ToDoLst elements this one is blocked by (A2)

  constructor(name: string, x_pos: number, y_pos: number, x_scale: number = 1, y_scale: number = 1) {
    super(name, x_pos, y_pos, x_scale, y_scale);
    this.type = 'ToDoLst';
  }

  add_task(task: scheduled_task) {
    this.scheduled_tasks.push(task);
  }

  delete_task(task_index: number): boolean {
    if (task_index >= 0 && task_index < this.scheduled_tasks.length) {
      this.scheduled_tasks.splice(task_index, 1)
      return true
    }
    else {
      return false
    }
  }
  /**
   * Add a collaborator to the todo list
   */
  add_collaborator(username: string): boolean {
    if (!this.collaborators.includes(username)) {
      this.collaborators.push(username);
      return true;
    }
    return false;
  }

  /**
   * Remove a collaborator from the todo list
   */ remove_collaborator(username: string): boolean {
    const index = this.collaborators.indexOf(username);
    if (index !== -1) {
      this.collaborators.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Check if a user is a collaborator
   */
  is_collaborator(username: string): boolean {
    return this.collaborators.includes(username);
  }
  /**
   * Get all collaborators
   */
  get_collaborators(): string[] {
    return [...this.collaborators];
  }
  add_tag(tag: string): boolean {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      return true;
    }
    return false;
  }

  remove_tag(tag: string): boolean {
    const index = this.tags.indexOf(tag);
    if (index !== -1) {
      this.tags.splice(index, 1);
      return true;
    }
    return false;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      scheduled_tasks: this.scheduled_tasks.map(t => t.toJSON()),
      collaborators: this.collaborators,
      tags: this.tags,
      dependsOn: this.dependsOn
    };
  }

  // NOTE: tasks are NOT part of content — they persist as their own `tasks` rows.
  override toContent(): Record<string, unknown> {
    return {
      collaborators: this.collaborators,
      tags: this.tags,
      dependsOn: this.dependsOn,
    };
  }
}

/** The concrete canvas element types (the single list to extend for a new type). */
export const CANVAS_ELEMENT_TYPES = ['Text_document', 'Image', 'Video', 'ToDoLst'] as const;
export type CanvasElementType = (typeof CANVAS_ELEMENT_TYPES)[number];

export class objects_builder {

  /**
   * Canonical element-type detector — the SINGLE source of truth for "what kind
   * of element is this?", whether `obj` is a live instance or a plain
   * (deserialized / client-sent) object. Prefers the explicit `type`
   * discriminator; falls back to shape detection for legacy payloads that
   * predate it. Replaces the duck-typing that was duplicated across the backend
   * (serializeProject, resolveElementType) and frontend (getElementType,
   * data.service). Extend HERE — and the subclass + `rebuild` — to add a type.
   */
  static typeOf(obj: any): CanvasElementType {
    if (obj) {
      const t = obj.type;
      if (CANVAS_ELEMENT_TYPES.includes(t)) return t;
      // Legacy / plain-object fallback: detect by distinguishing fields.
      if (Array.isArray(obj.scheduled_tasks)) return 'ToDoLst';
      if (obj.imagepath !== undefined || obj.imagePath !== undefined || obj.ImageBase64 !== undefined) return 'Image';
      if (obj.VideoPath !== undefined || obj.videoPath !== undefined || obj.videoBase64 !== undefined) return 'Video';
      if (obj.Text_field !== undefined || obj.text_field !== undefined) return 'Text_document';
      const cn = obj.constructor?.name;
      if (CANVAS_ELEMENT_TYPES.includes(cn)) return cn;
    }
    // Ultimate fallback (unreachable for real elements) — matches the prior
    // resolveElementType default.
    return 'Text_document';
  }

  /**
   * The type-specific DB `content` JSONB for an element, derived polymorphically
   * via each subclass's `toContent()`. Accepts a live instance or a plain
   * (client-sent) object — plain objects are rebuilt first. The single
   * write-side content mapping (replaces the per-type `buildElementContent`).
   */
  static contentOf(obj: any): Record<string, unknown> {
    const el = obj instanceof Screen_Element ? obj : objects_builder.rebuild(obj);
    return el && typeof (el as any).toContent === 'function'
      ? (el as any).toContent()
      : {};
  }

  static rebuild(obj: any): Screen_Element | scheduled_task | any {
    if (!obj) return obj;

    // Restore the stable id (Phase 6b) onto any rebuilt Screen_Element.
    // Additive: old payloads without `id` leave the field undefined.
    const withId = (el: any) => {
      if (el && obj.id !== undefined && el instanceof Screen_Element) {
        el.id = obj.id;
      }
      return el;
    };

    // Fallback: Detect elements by their fields if type is missing or wrong
    // Check for ToDoLst first (by scheduled_tasks array)
    if (obj.scheduled_tasks !== undefined && Array.isArray(obj.scheduled_tasks)) {
      // This is a ToDoLst
      const list = new ToDoLst(obj.name, obj.x_pos, obj.y_pos);
      // Restore scale values if present
      if (obj.x_scale !== undefined) list.x_scale = obj.x_scale;
      if (obj.y_scale !== undefined) list.y_scale = obj.y_scale;
      list.scheduled_tasks = obj.scheduled_tasks.map((t: any) => objects_builder.rebuild(t));
      // Restore collaborators if present
      if (obj.collaborators !== undefined && Array.isArray(obj.collaborators)) {
        list.collaborators = obj.collaborators;
      }
      // ⭐ Restore tags
      if (obj.tags !== undefined && Array.isArray(obj.tags)) {
        list.tags = obj.tags;
      }
      // Restore element dependencies (A2)
      if (obj.dependsOn !== undefined && Array.isArray(obj.dependsOn)) {
        list.dependsOn = obj.dependsOn;
      }
      return withId(list);
    }

    // Check for Text_document (by Text_field)
    if (obj.Text_field !== undefined || obj.text_field !== undefined) {
      // This is a Text_document
      const textField = obj.Text_field || obj.text_field || '';
      const textDoc = new Text_document(obj.name, obj.x_pos, obj.y_pos, textField);
      // Restore scale values if present
      if (obj.x_scale !== undefined) textDoc.x_scale = obj.x_scale;
      if (obj.y_scale !== undefined) textDoc.y_scale = obj.y_scale;
      // B3: restore the collaborative Yjs state if present.
      if (obj.ydoc !== undefined && obj.ydoc !== null) textDoc.ydoc = obj.ydoc;
      return withId(textDoc);
    }

    // Check for Image (by imagepath, imagePath, or ImageBase64)
    if (obj.imagepath !== undefined || obj.imagePath !== undefined || obj.ImageBase64 !== undefined) {
      // This is an Image
      const imagePath = obj.imagepath || obj.imagePath || (obj.ImageBase64 ? `data:image/png;base64,${obj.ImageBase64}` : '');
      const img = new Image(imagePath, obj.x_pos, obj.y_pos, obj.name);
      // Restore scale values if present
      if (obj.x_scale !== undefined) img.x_scale = obj.x_scale;
      if (obj.y_scale !== undefined) img.y_scale = obj.y_scale;
      if (obj.ImageBase64) img.imageFile = Buffer.from(obj.ImageBase64, 'base64');
      return withId(img);
    }

    // Check for Video (by VideoPath, videoPath, or videoBase64)
    if (obj.VideoPath !== undefined || obj.videoPath !== undefined || obj.videoBase64 !== undefined) {
      // This is a Video
      const videoPath = obj.VideoPath || obj.videoPath || (obj.videoBase64 ? `data:video/mp4;base64,${obj.videoBase64}` : '');
      const vid = new Video(videoPath, obj.x_pos, obj.y_pos, obj.name);
      // Restore scale values if present
      if (obj.x_scale !== undefined) vid.x_scale = obj.x_scale;
      if (obj.y_scale !== undefined) vid.y_scale = obj.y_scale;
      if (obj.videoBase64) vid.VideoFile = obj.videoBase64;
      return withId(vid);
    }

    if (!obj.type) return obj;

    // Frontend minification can prefix class names (e.g. "_scheduled_task",
    // "_ToDoLst") when a payload's `type` came from `constructor.name`. Normalize
    // leading underscores so the discriminator still matches — none of the real
    // type names start with one.
    const type = typeof obj.type === 'string' ? obj.type.replace(/^_+/, '') : obj.type;

    switch (type) {
      case 'Text_document':
        const textDoc = new Text_document(obj.name, obj.x_pos, obj.y_pos, obj.Text_field || obj.text_field || '');
        // Restore scale values if present
        if (obj.x_scale !== undefined) textDoc.x_scale = obj.x_scale;
        if (obj.y_scale !== undefined) textDoc.y_scale = obj.y_scale;
        // B3: restore the collaborative Yjs state if present.
        if (obj.ydoc !== undefined && obj.ydoc !== null) textDoc.ydoc = obj.ydoc;
        return withId(textDoc);

      case 'Image':
        {
          // Handle both new file path system and old base64 system
          // Support both imagepath (new) and imagePath (alternative)
          const imagePath = obj.imagepath || obj.imagePath || (obj.ImageBase64 ? `data:image/png;base64,${obj.ImageBase64}` : '');
          const img = new Image(imagePath, obj.x_pos, obj.y_pos, obj.name);
          // Restore scale values if present
          if (obj.x_scale !== undefined) img.x_scale = obj.x_scale;
          if (obj.y_scale !== undefined) img.y_scale = obj.y_scale;
          // Keep base64 for backward compatibility if present
          if (obj.ImageBase64) img.imageFile = Buffer.from(obj.ImageBase64, 'base64');
          return withId(img);
        }

      case 'Video':
        {
          // Handle both new file path system and old base64 system
          // Support both VideoPath (from toJSON) and videoPath (alternative)
          const videoPath = obj.VideoPath || obj.videoPath || (obj.videoBase64 ? `data:video/mp4;base64,${obj.videoBase64}` : '');
          const vid = new Video(videoPath, obj.x_pos, obj.y_pos, obj.name);
          // Restore scale values if present
          if (obj.x_scale !== undefined) vid.x_scale = obj.x_scale;
          if (obj.y_scale !== undefined) vid.y_scale = obj.y_scale;
          // Keep base64 for backward compatibility if present
          if (obj.videoBase64) vid.VideoFile = obj.videoBase64;
          return withId(vid);
        }

      case 'scheduled_task': //not really an element but needs to be rebuilt too lol
        {
          // Handle priority as both string and number (JSON might serialize numbers as strings)
          const priority = typeof obj.priority === 'string' ? parseInt(obj.priority, 10) : (obj.priority || 2);
          const t = new scheduled_task(obj.taskname, priority, obj.time || '');
          // Restore the stable task id (guard so old payloads without it are fine).
          if (obj.id !== undefined) t.id = obj.id;
          t.is_done = obj.is_done !== undefined ? obj.is_done : false;
          // Restore completion info if present
          if (obj.completion_time !== undefined) t.completion_time = obj.completion_time;
          if (obj.completed_by !== undefined) t.completed_by = obj.completed_by;
          if (obj.calendar_event_id !== undefined) t.calendar_event_id = obj.calendar_event_id;
          if (obj.notified !== undefined) t.notified = obj.notified;
          if (obj.repeat !== undefined) t.repeat = obj.repeat;
          // Restore the kanban lane (N6); older payloads have no `status`, so
          // derive it from is_done. normalizeStatus also enforces the invariant.
          t.status = normalizeStatus(obj.status, t.is_done);
          return t;
        }

      case 'ToDoLst':
        {
          const list = new ToDoLst(obj.name, obj.x_pos, obj.y_pos);
          // Restore scale values if present
          if (obj.x_scale !== undefined) list.x_scale = obj.x_scale;
          if (obj.y_scale !== undefined) list.y_scale = obj.y_scale;
          // Guard: a ToDoLst payload may arrive without its tasks (e.g. when only
          // content is needed) — treat a missing/non-array as empty.
          list.scheduled_tasks = Array.isArray(obj.scheduled_tasks)
            ? obj.scheduled_tasks.map((t: any) => objects_builder.rebuild(t))
            : [];
          // ⭐ Restore tags
          if (obj.tags !== undefined && Array.isArray(obj.tags)) {
            list.tags = obj.tags;
          }
          // Restore element dependencies (A2)
          if (obj.dependsOn !== undefined && Array.isArray(obj.dependsOn)) {
            list.dependsOn = obj.dependsOn;
          }
          // Restore collaborators if present (switch path parity with field-detect path)
          if (obj.collaborators !== undefined && Array.isArray(obj.collaborators)) {
            list.collaborators = obj.collaborators;
          }
          return withId(list);
        }

      default:
        return obj;
    }
  }
}