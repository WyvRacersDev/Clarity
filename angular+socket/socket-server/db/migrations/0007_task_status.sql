-- ============================================================================
-- N6 — kanban task status
--
-- A scheduled_task now carries an explicit kanban lane so a board view can offer
-- a real "In Progress" column (the boolean `is_done` alone only distinguishes
-- todo/done). Stored as plain text with a CHECK constraint mirroring the shared
-- TaskStatus union. Default 'todo' keeps every existing open task in the backlog.
--
-- `status` is the richer field but `is_done` stays authoritative for done-ness:
-- the app keeps them in lockstep (done ⟺ is_done) via the scheduled_task methods,
-- and the backfill below aligns any pre-existing completed rows into the Done lane.
-- ============================================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'todo';

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('todo', 'in_progress', 'done'));

-- Backfill: every already-completed task belongs in the Done lane.
UPDATE tasks SET status = 'done' WHERE is_done = TRUE AND status <> 'done';
