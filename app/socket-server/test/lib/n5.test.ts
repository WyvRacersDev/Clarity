/**
 * N5 — pure unit tests (no DB / no socket) for the AI create_task helpers:
 * priority mapping, due-date resolution, repeat normalization, and the
 * find-or-create-list / add-task-to-project logic.
 */
import { describe, it, expect } from "vitest";
import { Project } from "@models/project.model.js";
import { ToDoLst } from "@models/screen-elements.model.js";
import {
  priorityFromWord,
  resolveDueIso,
  normalizeRepeat,
  findOrCreateTodoList,
  addTaskToProject,
} from "@src/lib/task-create.js";

describe("priorityFromWord (N5)", () => {
  it("maps high/medium/low to 1/2/3", () => {
    expect(priorityFromWord("high")).toBe(1);
    expect(priorityFromWord("medium")).toBe(2);
    expect(priorityFromWord("low")).toBe(3);
  });
  it("is case-insensitive and trims", () => {
    expect(priorityFromWord("  HIGH ")).toBe(1);
  });
  it("defaults to medium (2) for missing/unknown", () => {
    expect(priorityFromWord(undefined)).toBe(2);
    expect(priorityFromWord("")).toBe(2);
    expect(priorityFromWord("urgent")).toBe(2);
  });
});

describe("resolveDueIso (N5)", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");
  it("parses an ISO date to an ISO timestamp", () => {
    expect(resolveDueIso("2026-08-07", now)).toBe(new Date("2026-08-07").toISOString());
  });
  it("falls back to now when empty", () => {
    expect(resolveDueIso("", now)).toBe(now.toISOString());
    expect(resolveDueIso(undefined, now)).toBe(now.toISOString());
  });
  it("falls back to now when unparseable", () => {
    expect(resolveDueIso("not a date", now)).toBe(now.toISOString());
  });
});

describe("normalizeRepeat (N5)", () => {
  it("accepts valid rules, case-insensitive", () => {
    expect(normalizeRepeat("daily")).toBe("daily");
    expect(normalizeRepeat("WEEKLY")).toBe("weekly");
  });
  it("coerces unknown/absent to none", () => {
    expect(normalizeRepeat(undefined)).toBe("none");
    expect(normalizeRepeat("yearly")).toBe("none");
  });
});

describe("findOrCreateTodoList (N5)", () => {
  it("creates a 'Tasks' list (and a grid) when the project is empty", () => {
    const p = new Project("Empty", "alice", "local");
    const list = findOrCreateTodoList(p);
    expect(list).toBeInstanceOf(ToDoLst);
    expect(list.name).toBe("Tasks");
    expect(p.grid.length).toBe(1);
    expect(p.grid[0].Screen_elements).toContain(list);
  });

  it("returns the first existing list when no name is given", () => {
    const p = new Project("P", "alice", "local");
    p.create_grid("Main");
    const first = new ToDoLst("Backlog", 0, 0);
    const second = new ToDoLst("Sprint", 1, 0);
    p.grid[0].add_element(first);
    p.grid[0].add_element(second);
    expect(findOrCreateTodoList(p)).toBe(first);
  });

  it("matches an existing list by name (case-insensitive)", () => {
    const p = new Project("P", "alice", "local");
    p.create_grid("Main");
    const sprint = new ToDoLst("Sprint", 0, 0);
    p.grid[0].add_element(sprint);
    expect(findOrCreateTodoList(p, "sprint")).toBe(sprint);
  });

  it("creates a new named list when the requested name is absent", () => {
    const p = new Project("P", "alice", "local");
    p.create_grid("Main");
    p.grid[0].add_element(new ToDoLst("Backlog", 0, 0));
    const created = findOrCreateTodoList(p, "Errands");
    expect(created.name).toBe("Errands");
    expect(p.grid[0].Screen_elements.length).toBe(2);
  });
});

describe("addTaskToProject (N5)", () => {
  it("appends a task with the given priority/due/repeat", () => {
    const p = new Project("P", "alice", "local");
    const due = new Date("2026-08-07").toISOString();
    const { list, task } = addTaskToProject(p, {
      taskName: "Review deck",
      priority: 1,
      dueIso: due,
      repeat: "weekly",
    });
    expect(list.scheduled_tasks).toContain(task);
    expect(task.taskname).toBe("Review deck");
    expect(task.priority).toBe(1);
    expect(task.time).toBe(due);
    expect(task.repeat).toBe("weekly");
    expect(task.is_done).toBe(false);
    expect(task.status).toBe("todo");
  });

  it("does not set a repeat for a one-off task", () => {
    const p = new Project("P", "alice", "local");
    const { task } = addTaskToProject(p, {
      taskName: "One-off",
      priority: 2,
      dueIso: new Date("2026-08-02").toISOString(),
      repeat: "none",
    });
    expect(task.repeat).toBe("none");
  });
});
