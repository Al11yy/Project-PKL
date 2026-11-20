import { projectSchema, type ParsedProject } from '@rakit/schema'
import { conflict, databaseUnavailable, notFound } from '../errors'

/**
 * Reads and writes for the platform `projects` table.
 *
 * Everything D1-specific lives here, so the routes stay a thin translation of HTTP into calls
 * and the queries are testable against a fake `D1Database` without an HTTP layer in the way.
 *
 * Storage layout, and why it is worth stating:
 *
 *   - Identity is a top-level column (`id`, `owner_id`, `name`, `slug`, `status`) because
 *     those are what a `WHERE` clause filters on.
 *   - The tree itself is one JSON blob in `document`, because it is only ever read and written
 *     whole. Normalising tables and screens into their own rows would buy nothing today —
 *     there is no query that reaches inside a project — and would cost a fan-out of inserts
 *     on every keystroke of a free edit.
 */

/**
 * The owner every project is written under.
 *
 * A placeholder, and named so it reads as one. There is no Auth: the moment there is, this
 * becomes the authenticated subject and every row written before then needs a migration to
 * assign an owner. Putting it in one named constant rather than inlining `'local-user'` into
 * five queries is what makes that migration a one-line change plus a backfill.
 */
export const PLACEHOLDER_OWNER = 'local-user'

/** The row shape as D1 returns it. */
interface ProjectRow {
  id: string
  name: string
  slug: string
  status: string
  document: string
  revision: number
  created_at: string
  updated_at: string
}

/**
 * Rebuild a stored project into the contract shape.
 *
 * The stored `document` is the project as the editor saw it, so this is a parse rather than an
 * assembly — but it is still a parse: a row written by an earlier version of the schema, or
 * edited by hand, must fail here rather than reach the preview. A malformed row is thrown, not
 * skipped, because silently omitting one project from a list is a data-loss bug that looks
 * like a UI glitch.
 */
function parseRow(row: ProjectRow): ParsedProject {
  let candidate: unknown
  try {
    candidate = JSON.parse(row.document)
  } catch {
    throw databaseUnavailable(
      `Proyek ${row.id} tersimpan dengan JSON yang tidak dapat dibaca.`,
    )
  }

  const result = projectSchema.safeParse(candidate)
  if (!result.success) {
    throw databaseUnavailable(
      `Proyek ${row.id} tersimpan dengan struktur yang tidak sesuai kontrak.`,
    )
  }
  return result.data
}

export interface ListOptions {
  limit?: number
  offset?: number
}

/**
 * All projects, newest first.
 *
 * `updated_at` is ISO-8601 text, so a lexicographic sort is chronological — which is why the
 * column is ISO text rather than a Unix integer. The tiebreaker on `id` keeps the order stable
 * between two rows written in the same millisecond, so paging cannot skip or repeat one.
 */
export async function listProjects(
  db: D1Database,
  options: ListOptions = {},
): Promise<ParsedProject[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100)
  const offset = Math.max(options.offset ?? 0, 0)

  const { results } = await db
    .prepare(
      `SELECT id, name, slug, status, document, revision, created_at, updated_at
         FROM projects
        WHERE owner_id = ?
        ORDER BY updated_at DESC, id ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(PLACEHOLDER_OWNER, limit, offset)
    .all<ProjectRow>()

  return (results ?? []).map(parseRow)
}

export async function getProject(db: D1Database, id: string): Promise<ParsedProject> {
  const row = await db
    .prepare(
      `SELECT id, name, slug, status, document, revision, created_at, updated_at
         FROM projects
        WHERE id = ? AND owner_id = ?`,
    )
    .bind(id, PLACEHOLDER_OWNER)
    .first<ProjectRow>()

  if (row === null) throw notFound('Proyek')
  return parseRow(row)
}

/**
 * Insert a project.
 *
 * `INSERT`, not `INSERT OR REPLACE`, and the difference is the point: a duplicate id is an
 * error the caller should see, not a silent overwrite. Generating twice is meant to produce two
 * projects, and a replace would make the first one vanish with no signal.
 *
 * The id is the one the server minted during generation, so the client never has to reconcile
 * a temporary id with a permanent one — the row it saves is the row it already holds.
 */
export async function createProject(
  db: D1Database,
  project: ParsedProject,
): Promise<ParsedProject> {
  const at = new Date().toISOString()

  try {
    await db
      .prepare(
        `INSERT INTO projects
           (id, owner_id, name, slug, prompt, status, document, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        project.id,
        PLACEHOLDER_OWNER,
        project.name,
        project.slug,
        // The originating prompt is not part of the tree the editor holds. Stored as the slug
        // rather than left null so the column is never a surprise in a query; a real prompt
        // column arrives when generation starts passing one through.
        project.slug,
        project.status,
        JSON.stringify(project),
        at,
        at,
      )
      .run()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('UNIQUE') || message.includes('PRIMARY KEY')) {
      throw conflict('PROJECT_EXISTS', `Proyek ${project.id} sudah ada.`)
    }
    throw error
  }

  return getProject(db, project.id)
}

/**
 * Update a project in place, bumping its revision.
 *
 * An upsert because the client does not track whether a row exists — a project can come from
 * the seed data, which was never saved, and the first edit of it must create the row rather
 * than fail. `ON CONFLICT` does that in one statement, so there is no read-then-write window
 * for a concurrent request to slip through.
 *
 * The returned project is re-read rather than echoed, so the caller gets the server's
 * `revision` and `updated_at` rather than the values it guessed.
 */
export async function upsertProject(
  db: D1Database,
  project: ParsedProject,
): Promise<ParsedProject> {
  const at = new Date().toISOString()

  await db
    .prepare(
      `INSERT INTO projects
         (id, owner_id, name, slug, prompt, status, document, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name       = excluded.name,
         slug       = excluded.slug,
         status     = excluded.status,
         document   = excluded.document,
         revision   = projects.revision + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(
      project.id,
      PLACEHOLDER_OWNER,
      project.name,
      project.slug,
      project.slug,
      project.status,
      JSON.stringify(project),
      at,
      at,
    )
    .run()

  return getProject(db, project.id)
}

/**
 * The current revision number, or null when the row does not exist.
 *
 * Exposed because a client that wants to detect a lost update needs to compare against
 * something, and the revision is that something.
 */
export async function currentRevision(db: D1Database, id: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT revision FROM projects WHERE id = ? AND owner_id = ?')
    .bind(id, PLACEHOLDER_OWNER)
    .first<{ revision: number }>()

  return row?.revision ?? null
}

/**
 * Delete a project and its revisions.
 *
 * Revisions are removed explicitly even though the schema cascades, because D1 does not enforce
 * foreign keys unless `PRAGMA foreign_keys = ON` is set per connection — and a cascade that
 * only sometimes fires is worse than one that never does, since it leaves orphans on the path
 * nobody tested.
 *
 * Ownership is checked against `projects`, the only table that has an `owner_id` column (see
 * `0001_init.sql`). `project_revisions` is keyed by `project_id` alone, so filtering it by
 * `owner_id` was a bug: SQLite rejects the unknown column and every delete returned 500. The
 * ownership guard belongs in the first statement, and the revision delete is safe only because
 * reaching it proves the project belongs to this owner.
 */
export async function deleteProject(db: D1Database, id: string): Promise<void> {
  // Removing the owned `projects` row is what actually authorizes the revision cleanup, so it
  // runs first and its result decides whether the second delete is allowed to touch anything.
  const owned = await db
    .prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?')
    .bind(id, PLACEHOLDER_OWNER)
    .run()

  if ((owned.meta?.changes ?? 0) === 0) return

  await db.prepare('DELETE FROM project_revisions WHERE project_id = ?').bind(id).run()
}
