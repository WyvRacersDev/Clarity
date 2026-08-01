/**
 * E9 — Project-aware AI context assembly.
 *
 * Turns a live `Project` into a compact, model-friendly text block that every
 * project-aware AI action shares (summarize_project, find_blocked, and the
 * project-scoped streaming chat). Kept pure (no DB / no LLM) so it is trivially
 * testable and owns no singletons — the agent loads the project, this formats it.
 *
 * Why text and not `JSON.stringify(project)` (the old summarise path): the raw
 * Project carries canvas noise (positions, scales, ids, calendar_event_id) that
 * wastes tokens and distracts the model. This projects out only what a planning
 * assistant needs — lists, tasks, priority, status, due dates, overdue flags,
 * and inter-list blocking (ToDoLst.dependsOn, A2) — in a stable, readable shape.
 */
import type { Project } from "@models/project.model.js";
import type { ToDoLst, scheduled_task } from "@models/screen-elements.model.js";

/** 1 High · 2 Medium · 3 Low (the numeric scale the app uses). */
function priorityWord(priority: number): string {
  if (priority === 1) return "High";
  if (priority === 3) return "Low";
  return "Medium";
}

/** A task is overdue when it has a due date in the past and isn't done. */
function isOverdue(task: scheduled_task, now: Date): boolean {
  if (task.is_done) return false;
  if (!task.time) return false;
  const due = new Date(task.time);
  return !isNaN(due.getTime()) && due.getTime() < now.getTime();
}

/** Human status label from the kanban lane / done flag. */
function statusLabel(task: scheduled_task): string {
  if (task.is_done || task.status === "done") return "done";
  if (task.status === "in_progress") return "in progress";
  return "to do";
}

/** Duck-typed check that survives (de)serialization the same way task-create does. */
function isTodoList(el: any): el is ToDoLst {
  return el?.type === "ToDoLst" || Array.isArray(el?.scheduled_tasks);
}

/** Collect every ToDoLst across all grids, in stable document order. */
function collectLists(project: Project): ToDoLst[] {
  const lists: ToDoLst[] = [];
  for (const grid of project.grid ?? []) {
    for (const el of grid.Screen_elements ?? []) {
      if (isTodoList(el)) lists.push(el as ToDoLst);
    }
  }
  return lists;
}

function formatTask(task: scheduled_task, now: Date): string {
  const parts = [`priority ${priorityWord(task.priority)}`, `status ${statusLabel(task)}`];
  if (task.time) {
    const due = new Date(task.time);
    const dueStr = isNaN(due.getTime()) ? task.time : due.toISOString().slice(0, 10);
    parts.push(`due ${dueStr}${isOverdue(task, now) ? " (OVERDUE)" : ""}`);
  } else {
    parts.push("no due date");
  }
  if (task.repeat && task.repeat !== "none") parts.push(`repeats ${task.repeat}`);
  if (task.completed_by) parts.push(`completed by ${task.completed_by}`);
  return `  • ${task.taskname} — ${parts.join(", ")}`;
}

/**
 * Build the compact project context block. Includes a small header of counts so
 * the model can answer "how much is left / overdue" without re-counting, then a
 * per-list breakdown with inter-list blocking noted (dependsOn resolved to list
 * names). Returns a short "empty project" note when there are no lists/tasks.
 */
export function buildProjectContext(project: Project, now: Date = new Date()): string {
  const lists = collectLists(project);
  const allTasks: scheduled_task[] = lists.flatMap((l) => l.scheduled_tasks ?? []);
  const done = allTasks.filter((t) => t.is_done || t.status === "done").length;
  const overdue = allTasks.filter((t) => isOverdue(t, now)).length;
  const undated = allTasks.filter((t) => !t.time).length;

  // id → name map so ToDoLst.dependsOn (element ids) can be shown as list names.
  const nameById = new Map<string, string>();
  for (const l of lists) if (l.id) nameById.set(l.id, String(l.name));

  const header =
    `Project: ${project.name} (owner: ${project.owner_name}, type: ${project.project_type}).\n` +
    `Tasks: ${allTasks.length} total, ${done} done, ${allTasks.length - done} open, ` +
    `${overdue} overdue, ${undated} with no due date.`;

  if (lists.length === 0) {
    return `${header}\nThis project has no task lists yet.`;
  }

  const body = lists
    .map((list) => {
      const blockedBy = (list.dependsOn ?? [])
        .map((id) => nameById.get(id) ?? id)
        .filter(Boolean);
      const blockedNote = blockedBy.length ? ` [blocked by: ${blockedBy.join(", ")}]` : "";
      const tasks = list.scheduled_tasks ?? [];
      const taskLines = tasks.length
        ? tasks.map((t) => formatTask(t, now)).join("\n")
        : "  (no tasks)";
      return `List "${list.name}"${blockedNote}:\n${taskLines}`;
    })
    .join("\n\n");

  return `${header}\n\n${body}`;
}
