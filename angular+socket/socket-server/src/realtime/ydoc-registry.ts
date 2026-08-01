/**
 * Y.Doc registry (B3) — authoritative server-side Yjs documents for
 * collaborative rich-text editing of `Text_document` elements.
 *
 * WHY a server doc (not a dumb relay): a late-joining editor must be able to
 * catch up on the full document state, and edits must survive a server restart.
 * So the server keeps ONE in-memory `Y.Doc` per element, applies every incoming
 * update to it, and DEBOUNCE-persists the encoded state into the element's
 * `content` JSONB (`content.ydoc`, base64) alongside a plain-text mirror
 * (`content.Text_field`, from the Y.Text) so previews and non-collab readers
 * keep working.
 *
 * The doc's shared text lives under the key `TEXT_KEY` — the same key the
 * frontend QuillBinding binds to. Keep the two in sync.
 *
 * Scope note: this is intentionally simple (no LRU eviction). Docs stay resident
 * once touched; for this app's scale that's fine and avoids re-hydration churn.
 */
import * as Y from "yjs";
import {
  getElementContent,
  updateElementContent,
} from "../repositories/project.repository.js";

/** Shared-text key inside every Text_document Y.Doc (must match the client). */
export const TEXT_KEY = "content";

/** How long to wait after the last update before persisting to Postgres. */
const PERSIST_DEBOUNCE_MS = 1500;

interface Entry {
  doc: Y.Doc;
  hydrated: boolean;
  persistTimer: NodeJS.Timeout | null;
}

const registry = new Map<string, Entry>();

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function b64decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * Get (or lazily create + hydrate) the authoritative Y.Doc for an element.
 * Hydration applies the persisted `content.ydoc` base64 state, if any.
 */
export async function getDoc(elementId: string): Promise<Y.Doc> {
  let entry = registry.get(elementId);
  if (entry) {
    if (!entry.hydrated) await hydrate(elementId, entry);
    return entry.doc;
  }
  entry = { doc: new Y.Doc(), hydrated: false, persistTimer: null };
  registry.set(elementId, entry);
  await hydrate(elementId, entry);
  return entry.doc;
}

async function hydrate(elementId: string, entry: Entry): Promise<void> {
  entry.hydrated = true; // mark first so concurrent callers don't double-apply
  try {
    const content = await getElementContent(elementId);
    const stored = content?.ydoc;
    if (typeof stored === "string" && stored.length > 0) {
      Y.applyUpdate(entry.doc, b64decode(stored));
    }
  } catch (err) {
    console.error(`[ydoc] hydrate ${elementId} failed:`, err);
  }
}

/**
 * Apply a client update (base64) to the authoritative doc and schedule a
 * debounced persist. Returns the doc so the caller can broadcast/derive state.
 */
export async function applyUpdate(
  elementId: string,
  updateB64: string
): Promise<Y.Doc> {
  const doc = await getDoc(elementId);
  Y.applyUpdate(doc, b64decode(updateB64), "remote");
  schedulePersist(elementId);
  return doc;
}

/** Encode the doc's full state as a base64 update (for sync-to-a-new-client). */
export async function encodeState(
  elementId: string,
  clientStateVectorB64?: string
): Promise<string> {
  const doc = await getDoc(elementId);
  const sv =
    clientStateVectorB64 && clientStateVectorB64.length > 0
      ? b64decode(clientStateVectorB64)
      : undefined;
  return b64encode(Y.encodeStateAsUpdate(doc, sv));
}

/** The doc's current state vector (base64) — lets a client send only its diff. */
export async function encodeStateVector(elementId: string): Promise<string> {
  const doc = await getDoc(elementId);
  return b64encode(Y.encodeStateVector(doc));
}

/**
 * N8 — the authoritative live content for a Text_document element IF a server
 * Y.Doc is currently resident for it (i.e. someone opened it for co-editing this
 * server lifetime). Returns the encoded doc state (`ydoc`, base64) plus the
 * plain-text mirror (`Text_field`) so a whole-project save can prefer live edits
 * over a possibly-stale in-memory snapshot, closing the B3 stale-snapshot clobber.
 *
 * Returns null when no doc is resident — then the caller's snapshot is as current
 * as anything and is written as-is. Does NOT create a doc for an element that
 * has none: absence of a resident doc means no live co-editing session to protect.
 */
export async function getAuthoritativeContent(
  elementId: string
): Promise<{ ydoc: string; Text_field: string } | null> {
  const entry = registry.get(elementId);
  if (!entry) return null;
  if (!entry.hydrated) await hydrate(elementId, entry);
  return {
    ydoc: b64encode(Y.encodeStateAsUpdate(entry.doc)),
    Text_field: entry.doc.getText(TEXT_KEY).toString(),
  };
}

function schedulePersist(elementId: string): void {
  const entry = registry.get(elementId);
  if (!entry) return;
  if (entry.persistTimer) clearTimeout(entry.persistTimer);
  entry.persistTimer = setTimeout(() => {
    entry.persistTimer = null;
    void persist(elementId);
  }, PERSIST_DEBOUNCE_MS);
}

async function persist(elementId: string): Promise<void> {
  const entry = registry.get(elementId);
  if (!entry) return;
  try {
    const ydoc = b64encode(Y.encodeStateAsUpdate(entry.doc));
    const Text_field = entry.doc.getText(TEXT_KEY).toString();
    await updateElementContent(elementId, { ydoc, Text_field });
  } catch (err) {
    console.error(`[ydoc] persist ${elementId} failed:`, err);
  }
}

/** Test/util hook: flush a pending persist immediately and clear the timer. */
export async function flushPersist(elementId: string): Promise<void> {
  const entry = registry.get(elementId);
  if (!entry) return;
  if (entry.persistTimer) {
    clearTimeout(entry.persistTimer);
    entry.persistTimer = null;
  }
  await persist(elementId);
}

/** Test/util hook: drop all in-memory docs (does not touch persisted state). */
export function _resetRegistry(): void {
  for (const entry of registry.values()) {
    if (entry.persistTimer) clearTimeout(entry.persistTimer);
    entry.doc.destroy();
  }
  registry.clear();
}
