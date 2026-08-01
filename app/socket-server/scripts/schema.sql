-- ============================================================
-- Clarity App – Google OAuth Storage Schema
-- Run this once in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/nsyvuflasiybvhjlzjwl/sql/new
-- ============================================================

-- Stores the Google OAuth app credentials (contents of credentials.json).
-- There is only ever ONE row (id = 1).
CREATE TABLE IF NOT EXISTS google_credentials (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  client_id     TEXT    NOT NULL,
  client_secret TEXT    NOT NULL,
  redirect_uris TEXT[]  NOT NULL,
  project_id    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce the single-row constraint
CREATE UNIQUE INDEX IF NOT EXISTS google_credentials_single_row ON google_credentials ((id = 1));


-- Stores per-user OAuth tokens (contents of tokens.json entries).
-- "id" mirrors the numeric id from the old TokenStore so existing
-- /gmail/user-info lookups by id still work.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                       SERIAL PRIMARY KEY,
  email                    TEXT   UNIQUE NOT NULL,
  access_token             TEXT,
  refresh_token            TEXT,
  scope                    TEXT,
  token_type               TEXT,
  id_token                 TEXT,
  expiry_date              BIGINT,
  refresh_token_expires_in INTEGER,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_google_credentials_updated_at ON google_credentials;
CREATE TRIGGER trg_google_credentials_updated_at
  BEFORE UPDATE ON google_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_oauth_tokens_updated_at ON oauth_tokens;
CREATE TRIGGER trg_oauth_tokens_updated_at
  BEFORE UPDATE ON oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
