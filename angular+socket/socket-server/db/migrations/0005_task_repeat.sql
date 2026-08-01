-- ============================================================================
-- N7 — recurring tasks
--
-- A scheduled_task may repeat on a fixed cadence. We store the rule as a plain
-- text column on `tasks` with a CHECK constraint over the allowed values so the
-- DB is the guard rail (mirrors the shared RepeatRule union). Default 'none'
-- keeps every existing row a one-off, so this is backward-compatible.
--
-- When a repeating task is completed, the app builds the next occurrence (a new
-- task row with the advanced time) — see scheduled_task.build_next_occurrence()
-- and the frontend completion path. No server-side scheduler is required.
-- ============================================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS repeat TEXT NOT NULL DEFAULT 'none';

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_repeat_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_repeat_check
  CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly'));
