/**
 * N8 — pure unit tests for the whole-project-save / live-Y.Doc reconciliation
 * guard (`preferLiveContent`). The integration proof that a stale whole-project
 * save no longer clobbers live edits lives in
 * test/realtime/ydoc-authoritative.test.ts.
 */
import { describe, it, expect } from "vitest";
import { preferLiveContent } from "@src/lib/ydoc-reconcile.js";

describe("preferLiveContent (N8)", () => {
  it("prefers live content when the live doc has text", () => {
    const out = preferLiveContent(
      { Text_field: "stale", ydoc: null },
      { Text_field: "live edit", ydoc: "AAA" }
    );
    expect(out).toEqual({ Text_field: "live edit", ydoc: "AAA" });
  });

  it("prefers an EMPTY live doc when the snapshot is already CRDT-backed (a real clear)", () => {
    const out = preferLiveContent(
      { Text_field: "old text", ydoc: "OLD" },
      { Text_field: "", ydoc: "EMPTY" }
    );
    expect(out).toEqual({ Text_field: "", ydoc: "EMPTY" });
  });

  it("KEEPS a non-empty snapshot when the live doc is empty AND not CRDT-backed (un-seeded)", () => {
    const out = preferLiveContent(
      { Text_field: "legacy text" }, // no ydoc — never co-edited
      { Text_field: "   ", ydoc: "EMPTY" }
    );
    expect(out).toBeNull();
  });

  it("treats whitespace-only live text as empty", () => {
    expect(
      preferLiveContent({ Text_field: "keep me" }, { Text_field: "\n\t ", ydoc: "E" })
    ).toBeNull();
  });
});
