-- ============================================================================
-- 0013_chat_reactions_attachments.sql — CHAT: reactions + attachments (E1/E2)
--
-- Two additions to the chat model, kept in the styles the codebase already uses:
--
--   * message_reactions — a normalized many-to-many set (like chat_reads): one
--     row per (message, emoji, reader). A reaction is a mutable relationship
--     between a user and a message, so it lives in its own table rather than as
--     denormalized JSON on the message. Toggling is insert/delete; the rendered
--     set is an aggregation grouped by emoji.
--
--   * messages.attachments — an immutable-at-insert list of uploaded files
--     ({ url, name, mime, size }). Attachments are value objects fixed when the
--     message is posted (never edited independently), so they ride on the row as
--     JSONB rather than a separate table — matching how screen elements store
--     their own value payloads.
-- ============================================================================

-- Uploaded files attached to a message (project channels; see file.gateway).
-- Each entry: { url: string, name: string, mime: string, size: number }.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Emoji reactions: one row per (message, emoji, reader). Deleting a message
-- cascades its reactions away. `reader` is a username string, matching
-- messages.author / chat_reads.reader (no hard FK to users).
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  reader     TEXT NOT NULL,                 -- username of the reacting user
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, emoji, reader)
);

-- Aggregate a message's reactions (grouped by emoji) on load.
CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions(message_id);
