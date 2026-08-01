-- ============================================================================
-- A3 — task comments
--
-- A thread of comments attached to a single `tasks` row. `author` is a username
-- string (not a hard FK to users) to avoid coupling to auth during the demo —
-- mirrors how tasks.completed_by is carried as a username over the wire.
-- ON DELETE CASCADE: deleting a task (or its element/grid/project) removes its
-- comments.
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
