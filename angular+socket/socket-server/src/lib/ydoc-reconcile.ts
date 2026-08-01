/**
 * N8 — pure decision for reconciling a whole-project save against the
 * authoritative server Y.Doc (see ProjectHandler.saveProject).
 *
 * The server Y.Doc is the source of truth for a Text_document under live
 * co-editing, so a possibly-stale snapshot should defer to it. The one guard:
 * a *transient empty* doc (resident but never seeded — e.g. a legacy element
 * that only ever had a plain `Text_field`) must NEVER wipe a non-empty snapshot.
 *
 * Prefer the live content when EITHER:
 *   - the live doc actually has text (a real edit happened / it was seeded), OR
 *   - the snapshot is already CRDT-backed (`ydoc` present) — then an empty live
 *     doc is a legitimate "user cleared the text", not an un-seeded blank.
 * Otherwise keep the snapshot (return null).
 */
export function preferLiveContent(
  snapshot: { Text_field?: string; ydoc?: string | null },
  live: { Text_field: string; ydoc: string }
): { Text_field: string; ydoc: string } | null {
  const liveHasText = live.Text_field.trim().length > 0;
  const snapshotIsCrdt = snapshot.ydoc != null;
  if (liveHasText || snapshotIsCrdt) {
    return { Text_field: live.Text_field, ydoc: live.ydoc };
  }
  return null;
}
