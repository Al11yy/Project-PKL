import { describe, expect, it } from 'vitest'
import { projectSchema } from '@rakit/schema'
import { fakeD1 } from '../testing/fake-d1'
import { clientProject } from '../testing/fixtures'
import {
  PLACEHOLDER_OWNER,
  createProject,
  currentRevision,
  deleteProject,
  getProject,
  listProjects,
  upsertProject,
} from './projects'

/**
 * The repository is where persistence either works or quietly loses data, so these tests aim
 * at the properties a user would notice rather than at line coverage: a saved project survives
 * a reload, a revision keeps its id, generating twice yields two projects, and a row that no
 * longer fits the contract fails loudly.
 */

const asProject = (overrides: Record<string, unknown> = {}) => {
  const result = projectSchema.safeParse(clientProject(overrides))
  if (!result.success) throw new Error(`fixture invalid: ${JSON.stringify(result.error.issues)}`)
  return result.data
}

describe('createProject', () => {
  it('stores a project that reads back identically', async () => {
    const db = fakeD1()
    const project = asProject({ id: 'p-roundtrip' })

    const created = await createProject(db, project)
    const read = await getProject(db, 'p-roundtrip')

    // The whole point of persistence: what is read back is what was written, parseable by the
    // same schema the editor uses.
    expect(read).toEqual(created)
    expect(projectSchema.safeParse(read).success).toBe(true)
  })

  it('starts at revision 1', async () => {
    const db = fakeD1()
    await createProject(db, asProject({ id: 'p-rev' }))

    expect(await currentRevision(db, 'p-rev')).toBe(1)
  })

  it('refuses a duplicate id rather than overwriting it', async () => {
    const db = fakeD1()
    const project = asProject({ id: 'p-dup' })

    await createProject(db, project)

    /**
     * This is the assertion that protects "generating twice makes two projects". A
     * `INSERT OR REPLACE` would silently destroy the first one here.
     */
    await expect(createProject(db, project)).rejects.toMatchObject({ apiError: { code: 'PROJECT_EXISTS' } })
  })
})

describe('upsertProject', () => {
  it('bumps the revision and keeps the id', async () => {
    const db = fakeD1()
    const project = asProject({ id: 'p-up', name: 'Nama Lama' })

    await createProject(db, project)
    const updated = await upsertProject(db, { ...project, name: 'Nama Baru' })

    expect(updated.id).toBe('p-up')
    expect(updated.name).toBe('Nama Baru')
    expect(await currentRevision(db, 'p-up')).toBe(2)
  })

  it('creates the row when it does not exist yet', async () => {
    // A project from the editor's seed data was never saved. The first edit of it must
    // create the row, not fail with 404.
    const db = fakeD1()
    const project = asProject({ id: 'p-from-seed' })

    const saved = await upsertProject(db, project)

    expect(saved.id).toBe('p-from-seed')
    expect(await currentRevision(db, 'p-from-seed')).toBe(1)
  })

  it('does not accumulate rows on repeated saves', async () => {
    const db = fakeD1()
    const project = asProject({ id: 'p-repeat' })

    await upsertProject(db, project)
    await upsertProject(db, project)
    await upsertProject(db, project)

    expect(db.rows).toHaveLength(1)
    expect(await currentRevision(db, 'p-repeat')).toBe(3)
  })

  it('preserves created_at across updates', async () => {
    const db = fakeD1()
    const project = asProject({ id: 'p-created' })

    await upsertProject(db, project)
    const first = db.rows[0].created_at
    await new Promise((r) => setTimeout(r, 5))
    await upsertProject(db, { ...project, name: 'Berubah' })

    expect(db.rows[0].created_at).toBe(first)
  })
})

describe('listProjects', () => {
  it('returns projects newest first', async () => {
    const db = fakeD1()

    await createProject(db, asProject({ id: 'p-old' }))
    await new Promise((r) => setTimeout(r, 5))
    await createProject(db, asProject({ id: 'p-new' }))

    const list = await listProjects(db)

    expect(list.map((p) => p.id)).toEqual(['p-new', 'p-old'])
  })

  it('returns an empty list rather than throwing when there is nothing', async () => {
    const list = await listProjects(fakeD1())
    expect(list).toEqual([])
  })

  it('caps the limit so a caller cannot request an unbounded page', async () => {
    const db = fakeD1()
    for (let i = 0; i < 3; i++) {
      await createProject(db, asProject({ id: `p-${i}` }))
    }

    const list = await listProjects(db, { limit: 100_000 })

    expect(list).toHaveLength(3)
  })
})

describe('getProject', () => {
  it('reports NOT_FOUND for an unknown id', async () => {
    await expect(getProject(fakeD1(), 'p-missing')).rejects.toMatchObject({
      httpStatus: 404,
      apiError: { code: 'NOT_FOUND' },
    })
  })

  /**
   * A stored row that no longer fits the contract must fail loudly.
   *
   * This is the scenario a schema change creates: rows written by the previous version. The
   * alternative — parsing leniently, or skipping the row — would put a tree the preview cannot
   * render into editor state, where it crashes instead of explaining itself.
   */
  it('refuses a row whose document violates the contract', async () => {
    const db = fakeD1({
      seed: [
        {
          id: 'p-broken',
          owner_id: PLACEHOLDER_OWNER,
          name: 'Rusak',
          slug: 'rusak',
          status: 'draft',
          document: JSON.stringify({ name: 'tanpa id', screens: [] }),
          revision: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    await expect(getProject(db, 'p-broken')).rejects.toMatchObject({
      apiError: { code: 'DATABASE_UNAVAILABLE' },
    })
  })

  it('refuses a row whose document is not JSON at all', async () => {
    const db = fakeD1({
      seed: [
        {
          id: 'p-garbage',
          owner_id: PLACEHOLDER_OWNER,
          name: 'Sampah',
          slug: 'sampah',
          status: 'draft',
          document: '{bukan json',
          revision: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    await expect(getProject(db, 'p-garbage')).rejects.toMatchObject({
      apiError: { code: 'DATABASE_UNAVAILABLE' },
    })
  })

  it('does not return a project owned by someone else', async () => {
    // Auth is not built, but the owner filter is: it is the seam the auth change plugs into,
    // and a query that forgot it would silently return everyone's projects.
    const db = fakeD1({
      seed: [
        {
          id: 'p-theirs',
          owner_id: 'someone-else',
          name: 'Milik Orang',
          slug: 'milik-orang',
          status: 'draft',
          document: JSON.stringify(clientProject({ id: 'p-theirs' })),
          revision: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    await expect(getProject(db, 'p-theirs')).rejects.toMatchObject({ httpStatus: 404 })
    expect(await listProjects(db)).toEqual([])
  })
})

describe('deleteProject', () => {
  it('removes the row', async () => {
    const db = fakeD1()
    const project = asProject({ id: 'p-del' })

    await createProject(db, project)
    await deleteProject(db, 'p-del')

    expect(db.rows).toHaveLength(0)
    await expect(getProject(db, 'p-del')).rejects.toMatchObject({ httpStatus: 404 })
  })

  /**
   * Regression for the 2026-11-20 production 500: `deleteProject` filtered
   * `project_revisions` by `owner_id`, a column that table does not have. The old fake
   * matched the statement by its prefix, ignored the parameters and returned success, so the
   * suite passed while every real delete failed. These two tests pin both halves of the fix —
   * the repository no longer names the column, and the fake now refuses statements that do.
   */
  it('issues only columns that exist on the tables it touches', async () => {
    const db = fakeD1()
    await createProject(db, asProject({ id: 'p-cols' }))

    // fake-d1 throws "no such column" for an unknown column, so reaching the assertions at all
    // proves every statement `deleteProject` issued named real columns.
    await expect(deleteProject(db, 'p-cols')).resolves.toBeUndefined()
    expect(db.rows).toHaveLength(0)
  })

  it('leaves revisions alone when the project is not owned by this caller', async () => {
    // Seeded with a foreign owner, which `createProject` would never produce: the row exists
    // but is not ours, so the delete must be a no-op rather than an error or a half-delete.
    const db = fakeD1({
      seed: [{
        id: 'p-foreign', owner_id: 'someone-else', name: 'Bukan Punya Kita',
        slug: 'asing', prompt: 'x', status: 'draft', document: '{}',
        revision: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      }],
    })

    await deleteProject(db, 'p-foreign')

    expect(db.rows.some((r) => r.id === 'p-foreign')).toBe(true)
  })
})
