-- ============================================================================
-- 0009_collaborators_updated_at.sql — fix-up for pre-existing databases (N1)
--
-- 0008_sharing.sql creates project_collaborators with `updated_at` + a BEFORE
-- UPDATE trigger that sets it. But on databases where the table already existed
-- (from an early db/schema.sql apply) WITHOUT that column, `CREATE TABLE IF NOT
-- EXISTS` was a no-op, so the column is missing and the trigger errors on any
-- role update ("record 'new' has no field 'updated_at'"). Add the column
-- idempotently and re-assert the trigger. No-op on freshly-migrated databases.
-- ============================================================================

ALTER TABLE project_collaborators
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_collaborators_updated_at ON project_collaborators;
CREATE TRIGGER trg_collaborators_updated_at
  BEFORE UPDATE ON project_collaborators
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
