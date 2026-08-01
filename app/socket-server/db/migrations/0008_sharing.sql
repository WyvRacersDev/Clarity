-- ============================================================================
-- 0006_sharing.sql — N1: access control & sharing for projects
--
-- Adds a real per-project permission model on top of the previous
-- owner-only (local) / fully-open (hosted) rule:
--   * project_collaborators — explicit members with a role (viewer/editor/admin).
--     The table was declared in db/schema.sql (reference) but never lived in an
--     applied migration; create it here so it exists at runtime.
--   * project_invitations   — pending invites addressed to an EMAIL, so an owner
--     can invite someone who has not registered yet; the invite is auto-accepted
--     the first time that email signs up / logs in.
--   * projects.link_share_role / link_share_token — "anyone with the link" access.
--
-- Role model (highest → lowest): owner (implicit, projects.owner_id) > admin >
-- editor > viewer. Owner/admin manage sharing; editor edits content; viewer is
-- read-only. Backfill keeps today's behaviour: existing hosted projects stay
-- publicly editable via link_share_role = 'editor'.
-- ============================================================================

-- ─── project_collaborators (registered members) ─────────────────────────────
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

-- ─── project_invitations (pending, addressed by email) ──────────────────────
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
  -- One live invite per (project, email); re-inviting updates role/status.
  UNIQUE (project_id, email)
);
CREATE INDEX IF NOT EXISTS idx_invitations_project ON project_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email   ON project_invitations(lower(email));

-- ─── projects: link sharing ("anyone with the link") ────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS link_share_role TEXT NOT NULL DEFAULT 'none'
    CHECK (link_share_role IN ('none', 'viewer', 'editor'));
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS link_share_token UUID;

-- Backfill: keep existing hosted projects publicly editable (their prior
-- behaviour) and give them a share token. Local projects stay 'none' (owner-only).
UPDATE projects
   SET link_share_role  = 'editor',
       link_share_token = COALESCE(link_share_token, gen_random_uuid())
 WHERE project_type = 'hosted'
   AND link_share_role = 'none';
