-- 0004_task_comments_decouple.sql
-- A3 comment durability: the whole-project saveProject does a full-replace of
-- grids → elements → tasks. With a CASCADE FK, every task_comment was deleted on
-- each save. saveProject now reuses the incoming task id (so ids are stable), and
-- here we drop the cascading FK so comments are no longer deleted when the task
-- row is transiently removed during a full-replace save. task_id remains a plain
-- uuid that re-attaches to the reinserted (same-id) task. Orphaned comments (task
-- genuinely gone) are harmless and can be pruned later.
ALTER TABLE task_comments DROP CONSTRAINT IF EXISTS task_comments_task_id_fkey;
