/**
 * N6 — pure unit tests (no DB / no socket): kanban task status.
 *
 * The core invariant is that `status` and `is_done` never drift: a task is done
 * IFF its status is 'done'. Every mutation path is exercised here.
 */
import { describe, it, expect } from "vitest";
import {
  scheduled_task,
  normalizeStatus,
} from "@models/screen-elements.model.js";

const base = "2026-08-01T09:00:00.000Z";

describe("normalizeStatus (N6)", () => {
  it("forces 'done' whenever the task is done, ignoring the given value", () => {
    expect(normalizeStatus("todo", true)).toBe("done");
    expect(normalizeStatus("in_progress", true)).toBe("done");
    expect(normalizeStatus(undefined, true)).toBe("done");
  });

  it("passes through valid non-done lanes when not done", () => {
    expect(normalizeStatus("todo", false)).toBe("todo");
    expect(normalizeStatus("in_progress", false)).toBe("in_progress");
  });

  it("degrades unknown / contradictory values to 'todo' when not done", () => {
    expect(normalizeStatus("done", false)).toBe("todo"); // contradiction resolved toward is_done
    expect(normalizeStatus("bogus", false)).toBe("todo");
    expect(normalizeStatus(undefined, false)).toBe("todo");
  });
});

describe("scheduled_task status invariant (N6)", () => {
  it("defaults a new task to the 'todo' lane, not done", () => {
    const t = new scheduled_task("Draft spec", 2, base);
    expect(t.status).toBe("todo");
    expect(t.is_done).toBe(false);
  });

  it("set_status('done') completes the task and stamps completion", () => {
    const t = new scheduled_task("Ship", 1, base);
    t.set_status("done", "alice");
    expect(t.status).toBe("done");
    expect(t.is_done).toBe(true);
    expect(t.completed_by).toBe("alice");
    expect(t.completion_time).not.toBeNull();
  });

  it("set_status('in_progress') reopens a previously-done task and clears completion", () => {
    const t = new scheduled_task("Ship", 1, base);
    t.set_status("done", "alice");
    t.set_status("in_progress");
    expect(t.status).toBe("in_progress");
    expect(t.is_done).toBe(false);
    expect(t.completed_by).toBeNull();
    expect(t.completion_time).toBeNull();
  });

  it("toggle_done_status keeps status in lockstep", () => {
    const t = new scheduled_task("Toggle me", 2, base);
    t.toggle_done_status();
    expect(t.is_done).toBe(true);
    expect(t.status).toBe("done");
    t.toggle_done_status();
    expect(t.is_done).toBe(false);
    expect(t.status).toBe("todo");
  });

  it("mark_complete / mark_incomplete keep status in lockstep", () => {
    const t = new scheduled_task("Task", 3, base);
    t.mark_complete("bob");
    expect(t.status).toBe("done");
    t.mark_incomplete();
    expect(t.status).toBe("todo");
    expect(t.is_done).toBe(false);
  });

  it("round-trips status through toJSON", () => {
    const t = new scheduled_task("Persisted", 2, base);
    t.set_status("in_progress");
    expect(t.toJSON().status).toBe("in_progress");
  });
});

describe("objects_builder rebuild — status backfill (N6)", () => {
  it("derives status from is_done for legacy payloads without a status field", async () => {
    const { objects_builder } = await import("@models/screen-elements.model.js");
    const doneLegacy = objects_builder.rebuild({
      type: "scheduled_task",
      taskname: "Old done task",
      priority: 2,
      time: base,
      is_done: true,
    });
    const openLegacy = objects_builder.rebuild({
      type: "scheduled_task",
      taskname: "Old open task",
      priority: 2,
      time: base,
      is_done: false,
    });
    expect(doneLegacy.status).toBe("done");
    expect(openLegacy.status).toBe("todo");
  });
});
