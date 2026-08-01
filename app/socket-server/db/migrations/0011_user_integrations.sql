-- ============================================================================
-- 0011_user_integrations.sql — N10: integrations beyond Google
--
-- One row per user holding the config for the external integrations:
--   * ics_feed_token — opaque UUID that authorizes an UNauthenticated calendar
--     client (Google/Apple Calendar) to subscribe to GET /calendar/<token>.ics.
--     Mirrors projects.link_share_token: a stable, regenerable secret in the URL,
--     NOT a JWT (a subscribed feed can't refresh an expiring token).
--   * webhook_url / webhook_kind — a per-user outbound webhook (generic JSON or a
--     Slack incoming webhook) that mirrors every N2 notification.
--
-- Kept in a dedicated table (not users.settings JSONB) because that column's
-- read/write mappers allow-list only known keys and would silently drop these.
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

-- The feed token is the lookup key for the unauthenticated ICS route.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_integrations_token
  ON user_integrations(ics_feed_token);

DROP TRIGGER IF EXISTS trg_user_integrations_updated_at ON user_integrations;
CREATE TRIGGER trg_user_integrations_updated_at
  BEFORE UPDATE ON user_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
