/**
 * Shared task-collection helpers ("lenses").
 *
 * The Tasks, Kanban (N6) and Timeline (N4) screens all need the same thing: the
 * flat set of tasks (or ToDoLst elements) that live somewhere inside
 * `user.projects[].grid[].Screen_elements[]`, each tagged with enough context to
 * render and to persist a change (owning project + its route index + type).
 *
 * That traversal was previously inlined per-screen (see the pre-existing
 * `tasks.component`); centralising it here removes the drift risk and keeps each
 * screen focused on presentation (SRP). Pure, side-effect-free functions — they
 * read the in-memory user graph and return plain view objects.
 */
import type { User } from '../../../../shared_models/models/user.model';
import type { Project } from '../../../../shared_models/models/project.model';
import { ToDoLst, scheduled_task } from '../../../../shared_models/models/screen-elements.model';

export type ProjectType = 'local' | 'hosted';

/** A ToDoLst element with the context needed to render and to persist it. */
export interface TaskListLens {
  project: Project;
  projectName: string;
  projectType: ProjectType;
  /** Index into `user.projects` — the value the `/dashboard/projects/:id` route expects. */
  projectIndex: number;
  element: ToDoLst;
  /** Stable element id (empty string when the element has not been persisted yet). */
  elementId: string;
  tasks: scheduled_task[];
}

/** A single task paired with its owning list lens. */
export interface TaskLens {
  task: scheduled_task;
  list: TaskListLens;
}

/**
 * A ToDoLst can arrive as a real class instance, a plain payload with an
 * explicit `type`, or (defensively) anything exposing a `scheduled_tasks` array.
 * Mirrors the detection used across the app so the lenses see every list.
 */
export function isTodoListElement(element: any): element is ToDoLst {
  if (!element) return false;
  if (element.type === 'ToDoLst') return true;
  if (element.constructor?.name === 'ToDoLst') return true;
  return Array.isArray(element.scheduled_tasks);
}

/** Every ToDoLst in the user's projects, tagged with project context. */
export function collectTaskLists(user: User | null): TaskListLens[] {
  if (!user?.projects) return [];
  const lenses: TaskListLens[] = [];

  user.projects.forEach((project, projectIndex) => {
    const p = project as Project;
    const projectName = (p as any).name ?? 'Untitled project';
    const projectType: ProjectType = (p as any).project_type === 'hosted' ? 'hosted' : 'local';

    (p.grid ?? []).forEach((grid) => {
      (grid.Screen_elements ?? []).forEach((element) => {
        if (!isTodoListElement(element)) return;
        const el = element as ToDoLst;
        lenses.push({
          project: p,
          projectName,
          projectType,
          projectIndex,
          element: el,
          elementId: (el as any).id ?? '',
          tasks: Array.isArray(el.scheduled_tasks) ? el.scheduled_tasks : [],
        });
      });
    });
  });

  return lenses;
}

/** Every task in the user's projects, each paired with its list lens. */
export function collectTasks(user: User | null): TaskLens[] {
  const out: TaskLens[] = [];
  for (const list of collectTaskLists(user)) {
    for (const task of list.tasks) {
      out.push({ task, list });
    }
  }
  return out;
}

/**
 * A ToDoLst is "complete" when it has at least one task and every task is done.
 * This is the dependency-satisfied predicate used by the canvas (A2) and reused
 * by the timeline to decide whether a dependency link is still blocking.
 */
export function isElementComplete(element: { scheduled_tasks?: scheduled_task[] }): boolean {
  const tasks = element?.scheduled_tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return false;
  return tasks.every((t) => t.is_done);
}
