-- ============================================================================
-- 0014_element_comments.sql — CANVAS: comments pinned to elements (E6)
--
-- A thread of comments anchored to a single canvas `screen_elements` row, the
-- Figma/Miro "comment pin" primitive. Structurally this mirrors task_comments
-- (0003): a UUID pk, an `author` username string (no hard FK to users), a body,
-- and a created_at — plus resolve state (resolved_by / resolved_at) so a thread
-- can be marked done and its pin hidden.
--
-- Two deliberate keying choices:
--
--   * project_id → projects(id) ON DELETE CASCADE. saveProject full-replaces a
--     project's grids/elements/tasks but never the projects row itself, so this
--     cascade is safe and lets pins be listed for a project in one query, plus
--     it garbage-collects a project's comments when the project is deleted.
--
--   * element_id is a PLAIN uuid with NO foreign key — intentionally, following
--     the 0004 task_comments decouple. `saveProject` deletes and re-inserts every
--     screen_elements row (reusing the same id) on each save; an ON DELETE CASCADE
--     FK to screen_elements would wipe a thread the instant its element's project
--     is saved. Keeping element_id unconstrained lets pins survive that transient
--     delete/reinsert (the id is stable), matching the task_comments precedent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS element_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  element_id  UUID NOT NULL,                -- stable screen_elements id; see note above (no FK)
  author      TEXT NOT NULL,                -- username of the comment author
  body        TEXT NOT NULL,
  resolved_by TEXT,                         -- username who resolved the thread (NULL = open)
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Render every pin for a project in one query.
CREATE INDEX IF NOT EXISTS idx_element_comments_project ON element_comments(project_id);
-- Group a pin's thread by element.
CREATE INDEX IF NOT EXISTS idx_element_comments_element ON element_comments(element_id);
