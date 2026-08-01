-- ============================================================================
-- 0015_project_snapshots.sql — CANVAS: version history / restore (E8)
--
-- A point-in-time snapshot of a project's ENTIRE canvas. Each row stores the
-- full serialized project payload (the same shape saveProject consumes and
-- loadProject produces), so "restore to this point" is simply feeding a stored
-- payload back through the existing full-replace saveProject — no separate
-- serializer, no per-element diffing.
--
-- Two kinds:
--   * 'auto'   — written (throttled + de-duplicated) whenever a whole-project
--                save lands, giving an automatic timeline without user effort.
--   * 'manual' — a named checkpoint the user explicitly saves ("Save version").
--
-- Keying: project_id → projects(id) ON DELETE CASCADE. saveProject full-replaces
-- a project's grids/elements/tasks but never the projects row itself, so the
-- cascade only fires when the project is actually deleted (garbage-collecting its
-- history), and never on an ordinary save. `created_by` is a username string with
-- NO hard FK to users (mirrors task_comments/element_comments), so a snapshot
-- survives even if the author is later removed.
--
-- `content_hash` is a sha256 hex of the payload, used by the auto-snapshot path
-- to skip writing a duplicate when a save didn't actually change the canvas.
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by    TEXT,                                    -- username of the author (no FK)
  label         TEXT,                                    -- manual checkpoint name (NULL for auto)
  kind          TEXT NOT NULL DEFAULT 'auto'
                  CHECK (kind IN ('auto', 'manual')),
  element_count INTEGER NOT NULL DEFAULT 0,              -- denormalized, for the timeline list
  content_hash  TEXT NOT NULL,                           -- sha256 hex of payload (dedup)
  payload       JSONB NOT NULL,                          -- full serialized project
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- List a project's timeline newest-first in one query.
CREATE INDEX IF NOT EXISTS idx_project_snapshots_project_created
  ON project_snapshots (project_id, created_at DESC);
