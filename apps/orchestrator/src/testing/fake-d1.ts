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
    if (index !== -1) table.splice(index, 1)
    return []
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
            execute(table, statement, uniqueIds)
            return { success: true }
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
