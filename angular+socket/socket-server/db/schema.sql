-- ============================================================================
-- Clarity — unified Postgres schema (backend-owned)
--
-- Single source of truth for ALL application data. Replaces both the Supabase
-- project and the on-disk JSON files. Deliberately free of Supabase-isms:
--   * no `auth.users` / RLS policies (authorization is enforced in the backend)
--   * no `supabase_realtime` publication (realtime is Socket.IO)
--   * no `storage.buckets` (assets live on disk, served by Express)
--
-- Safe to run repeatedly (idempotent-ish: IF NOT EXISTS + CREATE OR REPLACE).
-- ============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+ (no extension needed).

-- ─── updated_at trigger helper ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- USERS  (replaces Supabase `profiles` + the on-disk users/*.json files)
-- password_hash is NULL for users who only ever sign in via Google OAuth2.
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  avatar_url    TEXT,
  settings      JSONB NOT NULL DEFAULT '{
                   "receive_notifications": true,
                   "allow_invite": true,
                   "allow_google_calendar": true
                 }'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── External login identities (Google OAuth2, extensible to others) ────────
CREATE TABLE IF NOT EXISTS oauth_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'google',
  provider_user_id TEXT NOT NULL,          -- e.g. Google 'sub'
  email            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);

-- ============================================================================
-- CONTACTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS contacts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  contact_detail TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);

-- ============================================================================
-- PROJECTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_type TEXT NOT NULL DEFAULT 'local' CHECK (project_type IN ('local', 'hosted')),
  -- N1 link sharing: 'none' = owner/members only; 'viewer'/'editor' = anyone
  -- with the link gets that role. Token makes the shareable URL unguessable.
  link_share_role  TEXT NOT NULL DEFAULT 'none' CHECK (link_share_role IN ('none', 'viewer', 'editor')),
  link_share_token UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, name, project_type)
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_type  ON projects(project_type);

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- GRIDS  (a project has one or more grids / canvases)
-- ============================================================================
CREATE TABLE IF NOT EXISTS grids (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grids_project ON grids(project_id);

-- ============================================================================
-- SCREEN_ELEMENTS  (Text_document | Image | Video | ToDoLst on the canvas)
-- `content` holds type-specific payload (text body, media path, tags, etc).
-- ============================================================================
CREATE TABLE IF NOT EXISTS screen_elements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_id      UUID NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
  element_type TEXT NOT NULL CHECK (element_type IN ('Text_document', 'Image', 'Video', 'ToDoLst')),
  name         TEXT NOT NULL,
  x_pos        DOUBLE PRECISION NOT NULL DEFAULT 0,
  y_pos        DOUBLE PRECISION NOT NULL DEFAULT 0,
  x_scale      DOUBLE PRECISION NOT NULL DEFAULT 1,
  y_scale      DOUBLE PRECISION NOT NULL DEFAULT 1,
  content      JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_elements_grid ON screen_elements(grid_id);
CREATE INDEX IF NOT EXISTS idx_elements_type ON screen_elements(element_type);

DROP TRIGGER IF EXISTS trg_elements_updated_at ON screen_elements;
CREATE TRIGGER trg_elements_updated_at
  BEFORE UPDATE ON screen_elements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- TASKS  (rows of a ToDoLst element; extracted for querying/analytics)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  element_id        UUID NOT NULL REFERENCES screen_elements(id) ON DELETE CASCADE,
  taskname          TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 2,
  is_done           BOOLEAN NOT NULL DEFAULT FALSE,
  time              TIMESTAMPTZ,
  completion_time   TIMESTAMPTZ,
  completed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  notified          BOOLEAN NOT NULL DEFAULT FALSE,
  calendar_event_id TEXT,
  creation_time     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  repeat            TEXT NOT NULL DEFAULT 'none'
                      CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly')),
  status            TEXT NOT NULL DEFAULT 'todo'
                      CHECK (status IN ('todo', 'in_progress', 'done'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_element ON tasks(element_id);
CREATE INDEX IF NOT EXISTS idx_tasks_time    ON tasks(time);

-- ============================================================================
-- PROJECT_COLLABORATORS  (shared projects — N1 access control)
-- Explicit members with a role. Owner is implicit via projects.owner_id and
-- outranks every collaborator; roles here are viewer < editor < admin.
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_collaborators (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_collaborators_project ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_user    ON project_collaborators(user_id);

DROP TRIGGER IF EXISTS trg_collaborators_updated_at ON project_collaborators;
CREATE TRIGGER trg_collaborators_updated_at
  BEFORE UPDATE ON project_collaborators
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- PROJECT_INVITATIONS  (pending invites addressed by email — N1)
-- Lets an owner invite an email that has not registered yet; auto-accepted on
-- that email's first sign-up / login.
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'admin')),
  invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  token       UUID NOT NULL DEFAULT gen_random_uuid(),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  UNIQUE (project_id, email)
);
CREATE INDEX IF NOT EXISTS idx_invitations_project ON project_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email   ON project_invitations(lower(email));

-- ============================================================================
-- GOOGLE INTEGRATION  (Gmail / Calendar / Contacts API access)
-- These are the app's Google API tokens, distinct from login sessions above.
-- ============================================================================

-- App-level OAuth client config (single row, id = 1). Replaces credentials.json.
CREATE TABLE IF NOT EXISTS google_credentials (
  id            INTEGER PRIMARY KEY,
  client_id     TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  project_id    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user Google API tokens. Keyed by email for backward-compatible lookups;
-- user_id links to the owning account once auth (Phase 3) is wired in.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                        BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id                   UUID REFERENCES users(id) ON DELETE CASCADE,
  email                     TEXT UNIQUE NOT NULL,
  provider                  TEXT NOT NULL DEFAULT 'google',
  access_token              TEXT,
  refresh_token             TEXT,
  scope                     TEXT,
  token_type                TEXT,
  id_token                  TEXT,
  expiry_date               BIGINT,
  refresh_token_expires_in  BIGINT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id);

DROP TRIGGER IF EXISTS trg_oauth_tokens_updated_at ON oauth_tokens;
CREATE TRIGGER trg_oauth_tokens_updated_at
  BEFORE UPDATE ON oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- NOTIFICATIONS  (in-app notification center — N2)
-- A durable, per-recipient inbox for events otherwise pushed live over
-- Socket.IO / emailed. Keyed by username (no FK, like task_comments.author).
-- read_at NULL = unread. The per-project activity feed is a read-model over
-- task_comments + project_collaborators (not this table). See 0010_notifications.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient    TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN (
                 'mention', 'comment', 'project_shared', 'ai_suggestion', 'due_soon'
               )),
  actor        TEXT,
  project_name TEXT,
  project_type TEXT CHECK (project_type IN ('local', 'hosted')),
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications(recipient, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(recipient) WHERE read_at IS NULL;

-- ============================================================================
-- USER_INTEGRATIONS  (external integrations — N10)
-- One row per user: an opaque ICS feed token (unauthenticated calendar subscribe,
-- like projects.link_share_token) + an optional outbound webhook (generic/Slack)
-- that mirrors N2 notifications. See 0011_user_integrations.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_integrations (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ics_feed_token UUID NOT NULL DEFAULT gen_random_uuid(),
  webhook_url    TEXT,
  webhook_kind   TEXT NOT NULL DEFAULT 'generic'
                   CHECK (webhook_kind IN ('generic', 'slack')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_integrations_token
  ON user_integrations(ics_feed_token);

DROP TRIGGER IF EXISTS trg_user_integrations_updated_at ON user_integrations;
CREATE TRIGGER trg_user_integrations_updated_at
  BEFORE UPDATE ON user_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- MESSAGES  (collaborator chat — project channels + 1:1 DMs)
-- Two conversation scopes in one table: 'project' (project_id set, room-wide
-- channel) and 'dm' (dm_key = the two usernames sorted + joined with '|').
-- `author` is a username string (no FK), like task_comments.author. A CHECK
-- keeps the two scopes' target columns mutually exclusive. See 0012_messages.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL CHECK (scope IN ('project', 'dm')),
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  dm_key      TEXT,
  author      TEXT NOT NULL,
  body        TEXT NOT NULL,
  reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  edited_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_scope_target CHECK (
    (scope = 'project' AND project_id IS NOT NULL AND dm_key IS NULL) OR
    (scope = 'dm'      AND dm_key     IS NOT NULL AND project_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_messages_project
  ON messages(project_id, created_at DESC) WHERE scope = 'project';
CREATE INDEX IF NOT EXISTS idx_messages_dm
  ON messages(dm_key, created_at DESC) WHERE scope = 'dm';

-- Per-user read cursor for unread badges (conversation_key = 'project:<id>' | 'dm:<dmKey>').
CREATE TABLE IF NOT EXISTS chat_reads (
  reader           TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  last_read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (reader, conversation_key)
);
