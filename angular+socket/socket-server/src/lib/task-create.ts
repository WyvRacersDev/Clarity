/**
 * N5 — pure helpers backing the AI `create_task` tool.
 *
 * Kept side-effect-free (no DB / no socket) so the same logic the agent uses is
 * unit-testable in isolation. The agent (`agent.service.ts`) owns the load/save
 * orchestration; everything here only reads/mutates an in-memory Project.
 */
import { Project } from "@models/project.model.js";
import {
  ToDoLst,
  scheduled_task,
  REPEAT_RULES,
  type RepeatRule,
} from "@models/screen-elements.model.js";

/** Priority word → the numeric scale the app uses (1 High, 2 Medium, 3 Low). */
const PRIORITY_BY_WORD: Record<string, number> = { high: 1, medium: 2, low: 3 };

/**
 * Map a natural-language priority ("high"/"medium"/"low", any case) to the
 * numeric priority the frontend composer uses. Defaults to Medium (2) — the
 * same default the add-task composer applies — for missing/unknown words.
 */
export function priorityFromWord(word: string | undefined | null): number {
  if (!word) return 2;
  return PRIORITY_BY_WORD[String(word).trim().toLowerCase()] ?? 2;
}

/**
 * Resolve a due-date string (already ISO or a plain date the model produced
 * from a relative phrase) to an ISO timestamp. Falls back to `now` when absent
 * or unparseable, mirroring the composer's `new Date().toISOString()` default.
 */
export function resolveDueIso(input: string | undefined | null, now: Date = new Date()): string {
  const raw = (input ?? "").trim();
  if (!raw) return now.toISOString();
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? now.toISOString() : parsed.toISOString();
}

/** Coerce a value into a valid RepeatRule; unknown/absent → 'none' (one-off). */
export function normalizeRepeat(value: string | undefined | null): RepeatRule {
  const v = String(value ?? "").trim().toLowerCase() as RepeatRule;
  return REPEAT_RULES.includes(v) ? v : "none";
}

/**
 * Find the target ToDoLst for a new task, creating one when needed:
 *   - `listName` given & a list with that name exists (case-insensitive) → that list.
 *   - `listName` given & no match → a NEW list created with that name.
 *   - `listName` absent & any list exists → the first ToDoLst found.
 *   - no lists at all → a new "Tasks" list (creating a "Main" grid if none exist).
 * Mutates `project` in place when it creates a grid/list; returns the list.
 */
export function findOrCreateTodoList(project: Project, listName?: string | null): ToDoLst {
  const wanted = (listName ?? "").trim().toLowerCase();
  for (const grid of project.grid) {
    for (const el of grid.Screen_elements) {
      const isList = el instanceof ToDoLst || (el as any)?.type === "ToDoLst";
      if (!isList) continue;
      if (!wanted || (el as any).name?.trim().toLowerCase() === wanted) {
        return el as ToDoLst;
      }
    }
  }
  if (project.grid.length === 0) project.create_grid("Main");
  const grid = project.grid[0]!;
  const list = new ToDoLst((listName ?? "").trim() || "Tasks", 0, 0);
  grid.add_element(list);
  return list;
}

export interface NewTaskInput {
  taskName: string;
  priority: number;
  dueIso: string;
  listName?: string | null;
  repeat?: RepeatRule;
}

/**
 * Build a scheduled_task from the resolved inputs and append it to the chosen
 * (or freshly created) ToDoLst. Returns both so callers can report where it landed.
 */
export function addTaskToProject(
  project: Project,
  input: NewTaskInput
): { list: ToDoLst; task: scheduled_task } {
  const list = findOrCreateTodoList(project, input.listName);
  const task = new scheduled_task(input.taskName, input.priority, input.dueIso);
  if (input.repeat && input.repeat !== "none") task.set_repeat(input.repeat);
  list.add_task(task);
  return { list, task };
}
