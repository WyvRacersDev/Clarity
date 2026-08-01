/**
 * Snapshot repository — canvas version history / restore (E8).
 *
 * A snapshot is the FULL serialized project payload captured at a point in time.
 * Because `saveProject` already round-trips the entire canvas through one
 * JSON-serializable `SerializedProject`, versioning is "store the payload you
 * saved" and restore is "call saveProject with an old payload". This keeps the
 * feature additive: no new serializer, no per-element history, one table.
 *
 *   createSnapshot   — insert one version row (auto or manual).
 *   listSnapshots    — the timeline (metadata only, no heavy payload).
 *   getSnapshotPayload — the stored payload for a single version (for restore).
 *   maybeAutoSnapshot  — throttled + de-duplicated auto-capture after a save.
 *   restoreSnapshot    — full-replace the project with a stored payload.
 *
 * Auto-capture is de-duplicated by a sha256 content hash (a no-op save doesn't
 * add a version) and throttled (rapid saves collapse into one checkpoint per
 * window), then pruned to keep the newest N auto versions per project. Manual
 * checkpoints are never throttled or pruned.
 */
import { createHash } from "node:crypto";
import { sql } from "../infrastructure/db.js";
import {
  findProjectAuth,
  loadProject,
  saveProject,
  type SerializedProject,
} from "./project.repository.js";

type ProjectType = "local" | "hosted";

export type SnapshotKind = "auto" | "manual";

/** Timeline row — metadata only, the (potentially large) payload is omitted. */
export interface SnapshotMeta {
  id: string;
  projectId: string;
  createdBy: string | null;
  label: string | null;
  kind: SnapshotKind;
  elementCount: number;
  createdAt: string;
}

/** How long after an auto snapshot before another auto snapshot may be written. */
const AUTO_THROTTLE_MS = 60_000; // 1 minute
/** Keep at most this many AUTO snapshots per project (manual ones are kept). */
const MAX_AUTO_PER_PROJECT = 30;

/** sha256 hex of the serialized payload — the de-dup key for auto snapshots. */
function contentHash(payload: SerializedProject): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Total canvas elements across every grid — denormalized onto the row. */
function countElements(payload: SerializedProject): number {
  const grids = Array.isArray(payload.grid) ? payload.grid : [];
  return grids.reduce(
    (n, g) => n + (Array.isArray(g.Screen_elements) ? g.Screen_elements.length : 0),
    0
  );
}

interface SnapshotRow {
  id: string;
  project_id: string;
  created_by: string | null;
  label: string | null;
  kind: SnapshotKind;
  element_count: number;
  created_at: Date;
}

function toMeta(r: SnapshotRow): SnapshotMeta {
  return {
    id: r.id,
    projectId: r.project_id,
    createdBy: r.created_by,
    label: r.label,
    kind: r.kind,
    elementCount: r.element_count,
    createdAt: r.created_at.toISOString(),
  };
}

/** Insert one version row and return its metadata. */
export async function createSnapshot(
  projectId: string,
  createdBy: string | null,
  label: string | null,
  kind: SnapshotKind,
  payload: SerializedProject
): Promise<SnapshotMeta> {
  const rows = await sql<SnapshotRow[]>`
    insert into project_snapshots
      (project_id, created_by, label, kind, element_count, content_hash, payload)
    values (
      ${projectId}, ${createdBy}, ${label}, ${kind},
      ${countElements(payload)}, ${contentHash(payload)}, ${sql.json(payload as any)}
    )
    returning id, project_id, created_by, label, kind, element_count, created_at
  `;
  return toMeta(rows[0]!);
}

/** A project's version timeline, newest-first. Metadata only (no payload). */
export async function listSnapshots(
  projectId: string,
  limit = 50
): Promise<SnapshotMeta[]> {
  const rows = await sql<SnapshotRow[]>`
    select id, project_id, created_by, label, kind, element_count, created_at
    from project_snapshots
    where project_id = ${projectId}
    order by created_at desc
    limit ${limit}
  `;
  return rows.map(toMeta);
}

/** The stored payload for one version (scoped to its project), or null. */
export async function getSnapshotPayload(
  snapshotId: string,
  projectId: string
): Promise<SerializedProject | null> {
  const rows = await sql<Array<{ payload: SerializedProject }>>`
    select payload from project_snapshots
    where id = ${snapshotId} and project_id = ${projectId}
    limit 1
  `;
  return rows.length > 0 ? rows[0]!.payload : null;
}

/** Newest snapshot's dedup/throttle fields, or null when none exist. */
async function latestSnapshot(
  projectId: string
): Promise<{ content_hash: string; kind: SnapshotKind; created_at: Date } | null> {
  const rows = await sql<Array<{ content_hash: string; kind: SnapshotKind; created_at: Date }>>`
    select content_hash, kind, created_at
    from project_snapshots
    where project_id = ${projectId}
    order by created_at desc
    limit 1
  `;
  return rows.length > 0 ? rows[0]! : null;
}

/** Delete AUTO snapshots beyond the newest `keep` for a project. */
async function pruneAutoSnapshots(projectId: string, keep: number): Promise<void> {
  await sql`
    delete from project_snapshots
    where kind = 'auto'
      and project_id = ${projectId}
      and id not in (
        select id from project_snapshots
        where kind = 'auto' and project_id = ${projectId}
        order by created_at desc
        limit ${keep}
      )
  `;
}

/**
 * Capture an auto snapshot of a just-saved project — best-effort, never throws.
 *
 * Skips when nothing changed (same content hash as the latest snapshot) or when
 * the most recent snapshot is a fresh auto one (within the throttle window), so
 * rapid autosaves don't spam the timeline. Otherwise inserts and prunes. Called
 * from the save path AFTER the full-replace commit, so it never sits inside the
 * critical save transaction.
 */
export async function maybeAutoSnapshot(
  serialized: SerializedProject,
  projectType: ProjectType
): Promise<void> {
  try {
    const auth = await findProjectAuth(serialized.name, projectType);
    if (!auth) return; // project vanished between save and snapshot — nothing to do
    const projectId = auth.id;

    const hash = contentHash(serialized);
    const latest = await latestSnapshot(projectId);
    if (latest) {
      if (latest.content_hash === hash) return; // no change since last version
      if (
        latest.kind === "auto" &&
        Date.now() - latest.created_at.getTime() < AUTO_THROTTLE_MS
      ) {
        return; // a recent auto checkpoint already covers this editing burst
      }
    }

    await createSnapshot(projectId, serialized.owner_name ?? null, null, "auto", serialized);
    await pruneAutoSnapshots(projectId, MAX_AUTO_PER_PROJECT);
  } catch (err) {
    // Versioning is a non-critical side effect of saving — never fail the save.
    console.error("[Snapshots] auto-snapshot failed:", err);
  }
}

/**
 * Capture the project's CURRENT persisted state as a snapshot. Used for manual
 * checkpoints ("Save version") and for the safety snapshot taken before a
 * restore. Loads the authoritative serialized state from Postgres (so it
 * reflects granular collab edits, not just the last whole-project save).
 * Returns null if the project can't be found.
 */
export async function snapshotCurrentState(
  projectName: string,
  projectType: ProjectType,
  createdBy: string | null,
  label: string | null,
  kind: SnapshotKind
): Promise<SnapshotMeta | null> {
  const auth = await findProjectAuth(projectName, projectType);
  if (!auth) return null;
  const serialized = await loadProject(projectName, projectType);
  if (!serialized) return null;
  return createSnapshot(auth.id, createdBy, label, kind, serialized);
}

/**
 * Restore a project to a stored version — full-replace with the snapshot payload.
 *
 * Snapshots the current state first (an auto "Before restore" checkpoint) so the
 * restore itself is reversible, then feeds the stored payload back through the
 * repository full-replace saveProject. Returns the restored project's name on
 * success, or null when the snapshot doesn't exist for this project.
 */
export async function restoreSnapshot(
  snapshotId: string,
  projectId: string,
  projectName: string,
  projectType: ProjectType
): Promise<{ projectName: string } | null> {
  const payload = await getSnapshotPayload(snapshotId, projectId);
  if (!payload) return null;

  // Safety net: preserve the pre-restore state so a restore can be undone.
  const current = await loadProject(projectName, projectType);
  if (current) {
    await createSnapshot(projectId, payload.owner_name ?? null, "Before restore", "auto", current);
  }

  // Full-replace the project with the snapshot's exact content. The second arg
  // (authorized projectType) is authoritative over any stale value in payload.
  await saveProject(payload, projectType);
  return { projectName: payload.name };
}
