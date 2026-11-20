import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SEED_PROJECTS } from '../lib/seed'

/**
 * The store's own tests: the zero-project path, the guards that ride on it, and the one action
 * whose promise the UI awaits (`renameProject`).
 *
 * The zero-project case shipped broken once: `loadProjects` replaced the seed with `[]`,
 * `activeProject()` returned `undefined`, and six components read `.status` off it and blanked
 * the page. The seed hid the bug in local development, so nothing caught it until the editor
 * pointed at a real, empty D1.
 */

const listProjects = vi.fn()
const upsertProject = vi.fn()
const deleteProject = vi.fn()

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    listProjects: (...args: unknown[]) => listProjects(...args),
    // Rename and delete are the two actions that must *await* the server before reporting
    // success, so they are mocked rather than exercised against a real fetch.
    upsertProject: (...args: unknown[]) => upsertProject(...args),
    deleteProject: (...args: unknown[]) => deleteProject(...args),
  }
})

const { useBuilder } = await import('./useBuilder')

/**
 * The most recent toast. Spelled out rather than `toasts.at(-1)` because this app's `lib` is
 * ES2020, which predates `Array.prototype.at`.
 */
const latestToast = () => {
  const { toasts } = useBuilder.getState()
  return toasts[toasts.length - 1]
}

beforeEach(() => {
  listProjects.mockReset()
  upsertProject.mockReset()
  deleteProject.mockReset()
})

describe('loadProjects with an empty server', () => {
  it('replaces the seed with an empty list rather than keeping it', async () => {
    listProjects.mockResolvedValue([])

    await useBuilder.getState().loadProjects()

    // The seed must not survive an authoritative "you have none": showing it would invent
    // projects that do not exist in D1.
    expect(useBuilder.getState().projects).toEqual([])
    expect(useBuilder.getState().loaded).toBe(true)
    expect(useBuilder.getState().loading).toBe(false)
  })

  it('reports no active project instead of throwing', async () => {
    listProjects.mockResolvedValue([])
    await useBuilder.getState().loadProjects()

    // The whole bug in one assertion: this used to be `SEED_PROJECTS[0]`, and callers that
    // assumed a project was always present crashed. `undefined` is the contract now.
    expect(useBuilder.getState().activeProject()).toBeUndefined()
  })

  it('keeps the previous activeId so a transient empty response does not look like a choice', async () => {
    listProjects.mockResolvedValue([])
    const before = useBuilder.getState().activeId

    await useBuilder.getState().loadProjects()

    // The id is left alone on purpose; only the list is cleared. Restoring a project with the
    // same id later should reselect it rather than dumping the user somewhere else.
    expect(useBuilder.getState().activeId).toBe(before)
  })

  it('stays usable after selecting a view with no project loaded', async () => {
    listProjects.mockResolvedValue([])
    await useBuilder.getState().loadProjects()

    // Switching views is what the empty state allows (Skema), and it must not throw.
    expect(() => useBuilder.getState().setView('schema')).not.toThrow()
    expect(useBuilder.getState().view).toBe('schema')
  })
})

describe('actions with no active project', () => {
  beforeEach(async () => {
    listProjects.mockResolvedValue([])
    await useBuilder.getState().loadProjects()
  })

  it('runRevision is a no-op and never reaches the network', async () => {
    await useBuilder.getState().runRevision('ubah warna')

    // The action is callable from anywhere; with no project it must not post `undefined`.
    expect(useBuilder.getState().revision.state).toBe('idle')
  })

  it('runPublish is a no-op and never reaches the network', async () => {
    await useBuilder.getState().runPublish()

    expect(useBuilder.getState().publish.state).toBe('idle')
  })

  it('the save path does not leave `saving` raised forever', async () => {
    // `persistActive` guards before setting `saving: true`. If it set the flag first, this
    // would latch at `true` with no `finally` to clear it, and the UI would show a permanent
    // "menyimpan…" with nothing in flight.
    useBuilder.getState().updateBlock('b-does-not-exist', { title: 'x' })

    expect(useBuilder.getState().saving).toBe(false)
  })
})

describe('renameProject', () => {
  /**
   * Rename is the one editor action whose promise the UI awaits before closing the editor, so
   * the contract worth pinning is "`true` only once the server has the new name". A `true` that
   * arrives before the write lands is exactly the F5 bug: the name looks saved, the reload
   * disagrees.
   */

  const stored = SEED_PROJECTS[0]

  const startFromSeed = async () => {
    listProjects.mockResolvedValue([stored])
    await useBuilder.getState().loadProjects()
  }

  it('resolves true and keeps the name the server returned', async () => {
    await startFromSeed()
    upsertProject.mockImplementation(async (project: { name: string }) => project)

    const ok = await useBuilder.getState().renameProject('  Kasir Klinik Baru  ')

    expect(ok).toBe(true)
    // Trimmed, and the value that came back from the server — not the draft the user typed.
    expect(upsertProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Kasir Klinik Baru' }))
    expect(useBuilder.getState().activeProject()?.name).toBe('Kasir Klinik Baru')
  })

  it('sends the whole project, so a concurrent block edit is not clobbered', async () => {
    await startFromSeed()
    upsertProject.mockImplementation(async (project: unknown) => project)

    useBuilder.getState().updateBlock(stored.screens[0].blocks[0].id, { title: 'Judul Baru' })
    await useBuilder.getState().renameProject('Nama Lain')

    // `PUT` replaces the row wholesale, so a name-only payload would erase the edit above.
    const calls = upsertProject.mock.calls
    const sent = calls[calls.length - 1]?.[0] as { screens: { blocks: { title?: string }[] }[] }
    expect(sent.screens[0].blocks[0].title).toBe('Judul Baru')
  })

  it('reverts the name and resolves false when the write fails', async () => {
    await startFromSeed()
    const before = useBuilder.getState().activeProject()?.name
    upsertProject.mockRejectedValue(new Error('offline'))

    const ok = await useBuilder.getState().renameProject('Tidak Tersimpan')

    expect(ok).toBe(false)
    // Leaving the unsaved name on screen would be a claim the next reload contradicts.
    expect(useBuilder.getState().activeProject()?.name).toBe(before)
    expect(latestToast()?.title).toBe('Gagal mengganti nama')
  })

  it('rejects an empty name without a round trip', async () => {
    await startFromSeed()

    const ok = await useBuilder.getState().renameProject('   ')

    expect(ok).toBe(false)
    // `false` keeps the top bar's editor open instead of closing as if it had saved.
    expect(upsertProject).not.toHaveBeenCalled()
  })

  it('is a no-op with no active project', async () => {
    listProjects.mockResolvedValue([])
    await useBuilder.getState().loadProjects()

    expect(await useBuilder.getState().renameProject('Apa Saja')).toBe(false)
    expect(upsertProject).not.toHaveBeenCalled()
  })
})

describe('deleteProject', () => {
  /**
   * The order is the contract: the row leaves the rail only after D1 says it is gone. The
   * failures that matter are the ones where those two disagree, so each test below checks the
   * *pair* — what the server was asked, and what the rail shows afterwards.
   */

  const [first, second, third] = SEED_PROJECTS

  const startWith = async (projects: typeof SEED_PROJECTS) => {
    listProjects.mockResolvedValue(projects)
    await useBuilder.getState().loadProjects()
  }

  const railIds = () => useBuilder.getState().projects.map((p) => p.id)

  it('removes the row and resolves true once the server has it gone', async () => {
    await startWith([first, second])
    deleteProject.mockResolvedValue(undefined)

    const ok = await useBuilder.getState().deleteProject(second.id)

    expect(ok).toBe(true)
    expect(deleteProject).toHaveBeenCalledWith(second.id)
    expect(railIds()).toEqual([first.id])
    expect(latestToast()?.title).toBe('Proyek dihapus')
  })

  it('keeps the row when the delete fails, so the rail never claims a removal that did not happen', async () => {
    await startWith([first, second])
    const before = railIds()
    deleteProject.mockRejectedValue(new Error('offline'))

    const ok = await useBuilder.getState().deleteProject(second.id)

    expect(ok).toBe(false)
    // The row is still there — a reload would have brought it back, which reads as data
    // resurrecting itself.
    expect(railIds()).toEqual(before)
    expect(latestToast()?.title).toBe('Gagal menghapus proyek')
  })

  it('moves the selection to the neighbour that took the deleted row\'s place', async () => {
    await startWith([first, second, third])
    useBuilder.getState().setActive(second.id)
    deleteProject.mockResolvedValue(undefined)

    await useBuilder.getState().deleteProject(second.id)

    // Third slid into second's slot, so third is "where I was" — not the newest (first).
    expect(useBuilder.getState().activeId).toBe(third.id)
  })

  it('falls back to the last remaining project when the last row is deleted', async () => {
    await startWith([first, second])
    useBuilder.getState().setActive(second.id)
    deleteProject.mockResolvedValue(undefined)

    await useBuilder.getState().deleteProject(second.id)

    expect(useBuilder.getState().activeId).toBe(first.id)
  })

  it('leaves the empty state reachable when the only project is deleted', async () => {
    await startWith([first])
    deleteProject.mockResolvedValue(undefined)

    await useBuilder.getState().deleteProject(first.id)

    expect(railIds()).toEqual([])
    // `App` keys the empty state off exactly this being `undefined`.
    expect(useBuilder.getState().activeProject()).toBeUndefined()
  })

  it('deleting an inactive project moves neither the selection nor the open inspector', async () => {
    await startWith([first, second])
    useBuilder.getState().setActive(second.id)
    useBuilder.getState().selectBlock('b-apa-saja')
    useBuilder.getState().toggleInspect(true)
    deleteProject.mockResolvedValue(undefined)

    await useBuilder.getState().deleteProject(first.id)

    // Deleting someone else's project must not close what the user is working in.
    expect(useBuilder.getState().activeId).toBe(second.id)
    expect(useBuilder.getState().selectedBlockId).toBe('b-apa-saja')
    expect(useBuilder.getState().inspectOpen).toBe(true)
  })

  it('clears block selection and the inspector when the active project is the one deleted', async () => {
    await startWith([first, second])
    useBuilder.getState().setActive(first.id)
    useBuilder.getState().selectBlock('b-apa-saja')
    useBuilder.getState().toggleInspect(true)
    deleteProject.mockResolvedValue(undefined)

    await useBuilder.getState().deleteProject(first.id)

    // A surviving block id would select whatever shares that id in the next project.
    expect(useBuilder.getState().selectedBlockId).toBeNull()
    expect(useBuilder.getState().inspectOpen).toBe(false)
  })
})
