-- Add the project's current revision number.
--
-- 0001 put the version counter only on `project_revisions`, which records the state *after*
-- each revision but nothing about how many the project currently has. That is enough to list
-- a history and not enough for anything else: the repository needs the number to bump it on
-- write, and a client needs it to detect that its save was made against a stale copy.
--
-- `NOT NULL DEFAULT 1` so existing rows get a sensible value without a backfill: a project
-- that was written before this column existed has had exactly one version stored.
--
-- The backfill below corrects rows that have revision history already, so the counter agrees
-- with `project_revisions` rather than claiming everything is on version 1. It runs after the
-- ALTER because the column must exist first; `MAX(...)` yields NULL for a project with no
-- history, and `COALESCE` keeps those at the default of 1.

ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

UPDATE projects
   SET revision = (
     SELECT COALESCE(MAX(r.revision), 1)
       FROM project_revisions r
      WHERE r.project_id = projects.id
   )
 WHERE EXISTS (
   SELECT 1 FROM project_revisions r WHERE r.project_id = projects.id
 );
