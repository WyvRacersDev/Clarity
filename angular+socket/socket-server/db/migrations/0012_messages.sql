-- ============================================================================
-- 0012_messages.sql — CHAT: project channels + 1:1 direct messages
--
-- A durable message store for collaborator chat, deliberately separate from the
-- `notifications` inbox (whose `type` is CHECK-constrained and which lacks
-- threading/edit fields). Two conversation scopes share one table:
--
--   * 'project' — one shared channel per project. `project_id` FKs the project
--     (ON DELETE CASCADE); every collaborator with VIEW access sees it. Broadcast
--     to the existing room `${projectType}:${projectName}`.
--   * 'dm'      — a 1:1 conversation between two users, keyed by `dm_key`: the two
--     usernames sorted lexically and joined with '|' (e.g. "alice|bob"), so the
--     pair maps to a single stable conversation regardless of who sends first.
--
-- `author` is a username string (no hard FK to users), matching task_comments.author
-- and notifications.recipient — identity is carried as a plain string across the
-- whole socket contract. A CHECK keeps the two scopes' columns mutually exclusive
-- so a row can never be half-project / half-dm.
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL CHECK (scope IN ('project', 'dm')),
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE, -- set iff scope='project'
  dm_key      TEXT,                                           -- set iff scope='dm'
  author      TEXT NOT NULL,                                  -- username of the sender
  body        TEXT NOT NULL,
  reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  edited_at   TIMESTAMPTZ,                                    -- NULL = never edited
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one of (project_id, dm_key) is populated, matching `scope`.
  CONSTRAINT messages_scope_target CHECK (
    (scope = 'project' AND project_id IS NOT NULL AND dm_key IS NULL) OR
    (scope = 'dm'      AND dm_key     IS NOT NULL AND project_id IS NULL)
  )
);

-- Channel history (newest-first paging) for each conversation scope.
CREATE INDEX IF NOT EXISTS idx_messages_project
  ON messages(project_id, created_at DESC) WHERE scope = 'project';
CREATE INDEX IF NOT EXISTS idx_messages_dm
  ON messages(dm_key, created_at DESC) WHERE scope = 'dm';

-- ============================================================================
-- CHAT_READS — per-user read cursor for unread badges.
--
-- One row per (reader, conversation): the timestamp up to which the reader has
-- seen a conversation. `conversation_key` is `project:<projectId>` or
-- `dm:<dmKey>`, so both scopes share this table. Unread count = messages in that
-- conversation newer than `last_read_at` (and not authored by the reader).
-- ============================================================================
CREATE TABLE IF NOT EXISTS chat_reads (
  reader           TEXT NOT NULL,                 -- username
  conversation_key TEXT NOT NULL,                 -- 'project:<id>' | 'dm:<dmKey>'
  last_read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reader, conversation_key)
);
