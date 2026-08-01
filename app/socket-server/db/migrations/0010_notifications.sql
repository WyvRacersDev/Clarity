-- ============================================================================
-- 0010_notifications.sql — N2: in-app notification center + activity feed
--
-- A durable, per-recipient inbox for events that were previously only pushed
-- live over Socket.IO (or emailed) and lost if the user was offline:
--   * mention        — someone @mentioned you in a task comment (N7 was live-only)
--   * comment        — a comment was added on a project you participate in
--   * project_shared — you were added to a project (N1 push was live-only)
--   * ai_suggestion  — a proactive scheduling suggestion (C2)
--   * due_soon       — one of your tasks is due within 24h
--
-- Recipients are keyed by USERNAME (a plain string everywhere in this codebase:
-- userRoom('user:<username>'), tasks.completed_by, comment.author), so no hard
-- FK to users — matching task_comments.author. `read_at` NULL = unread.
--
-- The per-project ACTIVITY FEED is a read-model over existing tables
-- (task_comments + project_collaborators), not this table, so it shows activity
-- to any viewer regardless of who was notified — no rows are added for it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient    TEXT NOT NULL,                       -- username of the addressee
  type         TEXT NOT NULL CHECK (type IN (
                 'mention', 'comment', 'project_shared', 'ai_suggestion', 'due_soon'
               )),
  actor        TEXT,                                -- username who triggered it (null = system)
  project_name TEXT,                                -- for deep-linking / grouping (nullable)
  project_type TEXT CHECK (project_type IN ('local', 'hosted')),
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,                                -- optional in-app route
  read_at      TIMESTAMPTZ,                         -- NULL = unread
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inbox listing (newest first per recipient) + fast unread counting.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications(recipient, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(recipient) WHERE read_at IS NULL;
