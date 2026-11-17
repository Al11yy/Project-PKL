-- Initial schema for the platform database.
--
-- Scope note: this stores *platform* metadata — the projects the editor lists, and every
-- revision applied to one. It is not the database of a generated user app; those are
-- separate D1 instances, one per published project, and are not created yet.
--
-- There is no `users` table and no coin/ledger table. Auth is pending approval and billing
-- moved to the provider, so both were removed from the design rather than stubbed out here:
-- a table nobody writes to becomes a migration everyone is afraid to delete.

CREATE TABLE IF NOT EXISTS projects (
  -- `p-<uuid>` from `projectId()` in src/ids.ts. TEXT rather than an autoincrement integer
  -- because the id is generated before the row exists and is already part of the API
  -- contract (`idSchema` in @rakit/schema allows `[A-Za-z0-9_.:-]`).
  id TEXT PRIMARY KEY,

  -- Placeholder owner until Auth ships. Every row carries the same value now; when a session
  -- exists this is filled from it. Kept as a column rather than added later so that the
  -- multi-tenant query (`WHERE owner_id = ?`) is already the shape the code uses.
  owner_id TEXT NOT NULL DEFAULT 'local-user',

  name TEXT NOT NULL,
  slug TEXT NOT NULL,

  -- The prompt that produced the project. PRD calls this the Context Manager's job.
  prompt TEXT NOT NULL DEFAULT '',

  -- 'draft' | 'live', matching `projectSchema`.
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live')),

  -- The whole rendered tree as JSON. Stored rather than normalised into tables/screens/blocks
  -- because nothing queries inside it: a project is read whole and written whole. Normalising
  -- would mean a multi-table write per revision for no query we will ever run.
  document TEXT NOT NULL,

  -- ISO-8601 UTC. This is *not* the `updatedAt` the client sees — that is the relative
  -- Indonesian label ("2 menit lalu"), computed on read. Mixing the two is how a column ends
  -- up holding "baru saja" and being impossible to sort.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_updated
  ON projects (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_revisions (
  id TEXT PRIMARY KEY,

  -- Intended to be `ON DELETE CASCADE`. D1 enforces foreign keys only when
  -- `PRAGMA foreign_keys = ON` is set on the connection, so deletion is handled explicitly in
  -- the repository rather than relied on here.
  project_id TEXT NOT NULL,

  -- 1-based, per project. The project's current document is revision N; the history table
  -- holds the state *after* each revision, so revisions 1..N-1 are the earlier versions.
  revision INTEGER NOT NULL,

  -- The instruction that produced this revision. Empty for revision 1, which came from a
  -- prompt rather than a revision request.
  instruction TEXT NOT NULL DEFAULT '',

  document TEXT NOT NULL,
  created_at TEXT NOT NULL,

  UNIQUE (project_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_revisions_project
  ON project_revisions (project_id, revision DESC);
