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
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_element ON tasks(element_id);
CREATE INDEX IF NOT EXISTS idx_tasks_time    ON tasks(time);

-- ============================================================================
-- PROJECT_COLLABORATORS  (shared / hosted projects)
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_collaborators (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'editor', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_collaborators_project ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_user    ON project_collaborators(user_id);

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
