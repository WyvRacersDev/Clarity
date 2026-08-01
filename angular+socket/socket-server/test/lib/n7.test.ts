/**
 * N7 — pure unit tests (no DB / no socket): recurrence math + @mention parsing.
 */
import { describe, it, expect } from "vitest";
import { parseMentions } from "@src/lib/mentions.js";
import {
  scheduled_task,
  nextOccurrence,
} from "@models/screen-elements.model.js";

describe("parseMentions (N7)", () => {
  it("extracts a single mention", () => {
    expect(parseMentions("hey @alice can you look?")).toEqual(["alice"]);
  });

  it("extracts multiple, de-duped, first-seen order", () => {
    expect(parseMentions("@bob @alice ping @bob again")).toEqual(["bob", "alice"]);
  });

  it("allows dots/dashes/underscores in usernames", () => {
    expect(parseMentions("cc @jo.hn-doe_1")).toEqual(["jo.hn-doe_1"]);
  });

  it("ignores '@' embedded in an email address", () => {
    expect(parseMentions("mail me at bob@example.com")).toEqual([]);
  });

  it("returns [] for empty / mention-free text", () => {
    expect(parseMentions("")).toEqual([]);
    expect(parseMentions("no mentions here")).toEqual([]);
  });
});

describe("nextOccurrence (N7)", () => {
  const base = "2026-08-01T09:00:00.000Z";

  it("returns null for one-off tasks", () => {
    expect(nextOccurrence(base, "none")).toBeNull();
  });

  it("returns null when there is no time to advance from", () => {
    expect(nextOccurrence("", "daily")).toBeNull();
  });

  it("advances daily / weekly / monthly", () => {
    expect(nextOccurrence(base, "daily")).toBe("2026-08-02T09:00:00.000Z");
    expect(nextOccurrence(base, "weekly")).toBe("2026-08-08T09:00:00.000Z");
    expect(nextOccurrence(base, "monthly")).toBe("2026-09-01T09:00:00.000Z");
  });
});

describe("scheduled_task.build_next_occurrence (N7)", () => {
  const base = "2026-08-01T09:00:00.000Z";

  it("returns null for a one-off task", () => {
    const t = new scheduled_task("Pay rent", 1, base);
    expect(t.build_next_occurrence()).toBeNull();
  });

  it("clones a fresh, not-done task with the advanced time and same rule", () => {
    const t = new scheduled_task("Standup", 2, base);
    t.set_repeat("daily");
    t.mark_complete("alice");

    const next = t.build_next_occurrence();
    expect(next).not.toBeNull();
    expect(next!.taskname).toBe("Standup");
    expect(next!.priority).toBe(2);
    expect(next!.repeat).toBe("daily");
    expect(next!.time).toBe("2026-08-02T09:00:00.000Z");
    expect(next!.is_done).toBe(false);
    expect(next!.id).toBeUndefined(); // persists as a new row
  });

  it("round-trips the repeat rule through toJSON", () => {
    const t = new scheduled_task("Weekly review", 3, base);
    t.set_repeat("weekly");
    expect(t.toJSON().repeat).toBe("weekly");
  });
});
