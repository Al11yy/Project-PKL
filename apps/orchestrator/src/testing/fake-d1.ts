/**
 * A small in-memory stand-in for D1, for the repository tests.
 *
 * Why not `@cloudflare/vitest-pool-workers`: it is the honest option and it is the plan, but it
 * needs a workerd runtime and a wrangler config in the test harness, which makes the whole
 * suite slow and couples every test to Cloudflare. A hand-written fake run under plain Vitest
 * keeps the repository tests fast.
 *
 * The cost of that choice is real and worth naming: **this fake can agree with a bug in the
 * repository.** It only understands the statements the repository actually issues, and if the
 * repository issued a statement this does not model, the test would pass against the fake and
 * fail in production. It is therefore a check on the repository's *logic* — ordering, upsert,
 * revision bumping, validation — and the SQL itself is verified against real D1 by
 * `npm run db:migrate:local` plus a manual smoke.
 *
 * It deliberately does not try to be SQL. Each statement is matched by a distinctive fragment
 * and answered with a purpose-built handler, so an unrecognised query throws loudly rather
 * than returning an empty result that looks like "no rows".
 */

type Row = Record<string, unknown>

interface Statement {
  sql: string
  params: unknown[]
}

/**
 * The columns each table actually has, copied from `migrations/0001_init.sql` and
 * `0002_project_revision_counter.sql`. The fake checks every column named in a WHERE clause
 * against this, because that is exactly the class of bug the fake must not agree with: a
 * repository statement naming a column the table does not have passed silently here and
 * returned a 500 from real D1 in production (see `deleteProject`, fixed 2026-11-20). Real
 * SQLite rejects such a statement with "no such column"; so does the fake now.
 */
const KNOWN_COLUMNS: Record<string, readonly string[]> = {
  projects: [
    'id', 'owner_id', 'name', 'slug', 'prompt', 'status', 'document',
    'revision', 'created_at', 'updated_at',
  ],
  project_revisions: [
    'id', 'project_id', 'revision', 'instruction', 'document', 'created_at',
  ],
}

/**
 * Rejects a statement whose WHERE clause names a column the target table does not have.
 * Only comparison positions are inspected (`col = ?` and friends), which covers every
 * statement this repository issues; ORDER BY and LIMIT clauses carry no comparisons.
 */
function checkColumns(normalized: string): void {
  // Case-insensitive on purpose: the repository writes its SQL keywords in UPPERCASE
  // (`DELETE FROM ... WHERE ...`), so a lowercase match silently skipped every statement —
  // which is how the first version of this guard failed to catch the bug it was written for.
  const whereIndex = normalized.toLowerCase().indexOf(' where ')
  if (whereIndex === -1) return

  const tableName = /from ([a-z_]+)/i.exec(normalized)?.[1]
  const columns = tableName === undefined ? undefined : KNOWN_COLUMNS[tableName.toLowerCase()]
  if (columns === undefined) return

  const clause = normalized.slice(whereIndex)
  for (const match of clause.matchAll(/([a-z_][a-z0-9_]*)\s*(?:=|!=|<>|<|>|>=|<=)/g)) {
    if (!columns.includes(match[1])) {
      throw new Error(`fake-d1: no such column: ${match[1]} (in ${tableName})`)
    }
  }
}

class FakeStatement {
  readonly params: unknown[] = []

  constructor(readonly sql: string) {}

  bind(...params: unknown[]): FakeStatement {
    const next = new FakeStatement(this.sql)
    next.params.push(...params)
    return next
  }
}

/**
 * Applies a statement to the in-memory table. Returns rows for a read, or undefined.
 */
function execute(table: Row[], statement: Statement, uniqueIds: Set<string>): Row[] {
  const { sql, params } = statement
  const normalized = sql.replace(/\s+/g, ' ').trim()

  checkColumns(normalized)

  // SELECT ... FROM projects WHERE owner_id = ? ORDER BY ... LIMIT ? OFFSET ?
  if (normalized.startsWith('SELECT id, name, slug, status, document') && normalized.includes('LIMIT ? OFFSET ?')) {
    const [owner, limit, offset] = params as [string, number, number]
    return table
      .filter((r) => r.owner_id === owner)
      .sort((a, b) => {
        const byUpdated = String(b.updated_at).localeCompare(String(a.updated_at))
        return byUpdated !== 0 ? byUpdated : String(a.id).localeCompare(String(b.id))
      })
      .slice(offset, offset + limit)
  }

  // SELECT ... WHERE id = ? AND owner_id = ?
  if (normalized.startsWith('SELECT id, name, slug, status, document') && normalized.includes('WHERE id = ? AND owner_id = ?')) {
    const [id, owner] = params as [string, string]
    const row = table.find((r) => r.id === id && r.owner_id === owner)
    return row === undefined ? [] : [row]
  }

  // SELECT revision FROM projects WHERE id = ? AND owner_id = ?
  if (normalized.startsWith('SELECT revision')) {
    const [id, owner] = params as [string, string]
    const row = table.find((r) => r.id === id && r.owner_id === owner)
    return row === undefined ? [] : [{ revision: row.revision }]
  }

  // INSERT INTO projects ... ON CONFLICT(id) DO UPDATE SET
  if (normalized.startsWith('INSERT INTO projects') && normalized.includes('ON CONFLICT')) {
    const [
      id, owner, name, slug, prompt, status, document, createdAt, updatedAt,
    ] = params as [string, string, string, string, string, string, string, string, string]

    const existing = table.find((r) => r.id === id)
    if (existing === undefined) {
      // The INSERT branch also sets revision to the literal 1, and created_at/updated_at
      // from the two trailing parameters.
      table.push({
        id, owner_id: owner, name, slug, prompt, status, document, revision: 1,
        created_at: createdAt, updated_at: updatedAt,
      })
    } else {
      // The UPDATE branch never touches created_at or prompt, and bumps revision.
      existing.name = name
      existing.slug = slug
      existing.status = status
      existing.document = document
      existing.revision = Number(existing.revision) + 1
      existing.updated_at = updatedAt
    }
    return []
  }

  // Plain INSERT INTO projects.
  if (normalized.startsWith('INSERT INTO projects')) {
    const [id, owner, name, slug, prompt, status, document, createdAt, updatedAt] =
      params as [string, string, string, string, string, string, string, string, string]

    if (uniqueIds.has(id) || table.some((r) => r.id === id)) {
      throw new Error('UNIQUE constraint failed: projects.id')
    }
    uniqueIds.add(id)
    table.push({
      id, owner_id: owner, name, slug, prompt, status, document, revision: 1,
      created_at: createdAt, updated_at: updatedAt,
    })
    return []
  }

  if (normalized.startsWith('DELETE FROM project_revisions')) {
    return []
  }

  if (normalized.startsWith('DELETE FROM projects')) {
    const [id, owner] = params as [string, string]
    const index = table.findIndex((r) => r.id === id && r.owner_id === owner)
    if (index === -1) return []
    table.splice(index, 1)
    // `changes` is how the repository learns whether the row was owned and therefore whether
    // the revision cleanup may run, so it has to report the real count, not a bare success.
    return [{ changes: 1 }]
  }

  throw new Error(`fake-d1: statement not modelled: ${normalized.slice(0, 120)}`)
}

export interface FakeD1Options {
  /** Pre-load rows, bypassing the repository, to test reads over data it did not write. */
  seed?: Row[]
}

/**
 * A `D1Database`-shaped object sufficient for the repository. Cast at the call site: the real
 * interface carries `batch`, `exec`, `dump` and a `withSession` method that nothing here uses,
 * and stubbing them would be more code pretending to be more coverage.
 */
export function fakeD1(options: FakeD1Options = {}): D1Database & { rows: Row[] } {
  const table: Row[] = [...(options.seed ?? [])]
  const uniqueIds = new Set<string>(table.map((r) => String(r.id)))

  const build = (sql: string) => new FakeStatement(sql)

  const db = {
    rows: table,

    prepare: (sql: string) => ({
      ...build(sql),
      bind: (...params: unknown[]) => {
        const statement = new FakeStatement(sql)
        statement.params.push(...params)
        return {
          ...statement,
          first: async <T>() => {
            const rows = execute(table, statement, uniqueIds)
            return (rows[0] as T) ?? null
          },
          all: async <T>() => ({ results: execute(table, statement, uniqueIds) as T[], success: true }),
          run: async () => {
            const result = execute(table, statement, uniqueIds)
            return { success: true, meta: { changes: Number(result?.[0]?.changes ?? 0) } }
          },
        }
      },
      first: async <T>() => {
        const rows = execute(table, { sql, params: [] }, uniqueIds)
        return (rows[0] as T) ?? null
      },
      all: async <T>() => ({ results: execute(table, { sql, params: [] }, uniqueIds) as T[], success: true }),
      run: async () => {
        execute(table, { sql, params: [] }, uniqueIds)
        return { success: true }
      },
    }),

    batch: async (statements: unknown[]) => {
      for (const s of statements) {
        const st = s as FakeStatement
        execute(table, { sql: st.sql, params: st.params }, uniqueIds)
      }
      return statements.map(() => ({ success: true }))
    },
  }

  return db as unknown as D1Database & { rows: Row[] }
}
