import { create } from 'zustand'
import type { Project } from '../lib/types'
import { SEED_PROJECTS } from '../lib/seed'
import { parseProjectsOrThrowAtStartup, ContractError } from '../lib/parse'
import {
  ApiError,
  generateProject,
  reviseProject,
  listProjects,
  createProject,
  upsertProject,
  // Aliased: the action below shares the name, and inside the store body `deleteProject` would
  // resolve to the action rather than the client.
  deleteProject as removeProject,
} from '../lib/api'

/**
 * `'ledger'` is gone. It was the coin-history view, and there are no coins.
 */
export type View = 'builder' | 'schema'

export type Toast = {
  id: string
  tone: 'ok' | 'warn' | 'danger'
  title: string
  body?: string
}

type RunState = 'idle' | 'running' | 'done' | 'failed'

let seq = 0
const uid = (p: string) => `${p}_${(++seq).toString(16).padStart(4, '0')}`

/**
 * Seed data is parsed exactly once, at module load. It is authored in this repo rather than
 * produced by a model, so a failure here is a coding error and throws loudly instead of
 * degrading to an empty app — an app that renders nothing is far harder to diagnose than
 * one that names the seed field that broke the contract.
 *
 * The seed is now a *fallback*, not the source of truth: `loadProjects` replaces it with what
 * the server holds as soon as that call answers. It stays visible until then so the first
 * paint is not an empty rail, and it stays as the offline result if the server is unreachable.
 */
const INITIAL_PROJECTS = parseProjectsOrThrowAtStartup(SEED_PROJECTS)

/**
 * How a failed load is described to the user.
 *
 * `NetworkError` here almost always means the Worker is unreachable or CORS rejected the
 * origin — not that the user did anything wrong. Naming that possibility is the difference
 * between a fixable setup problem and a mystery.
 */
function loadFailureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof ContractError) return error.message
  return 'Tidak dapat menghubungi server. Periksa koneksi, atau pastikan origin editor diizinkan Worker.'
}

interface BuilderState {
  projects: Project[]
  activeId: string
  view: View
  toasts: Toast[]
  /** Which inspectable block is selected, per screen. */
  selectedBlockId: string | null
  inspectOpen: boolean

  generation: { state: RunState; stage: number; message: string }
  publish: { state: RunState; message: string }
  revision: { state: RunState; message: string }
  hasGenerated: boolean

  /**
   * Whether `projects` reflects the server yet. The rail shows seed data until this is true,
   * so a load failure is visible rather than looking like a working app with four projects.
   */
  loaded: boolean
  loading: boolean
  loadError: string | null
  /** A save is in flight. Kept separate from `loading` so the two indicators cannot collide. */
  saving: boolean
  saveError: string | null

  /**
   * The project the editor is showing, or `undefined` when the server returned none.
   *
   * `undefined` is a real state, not a defensive flourish: a fresh account has zero projects,
   * and the editor is loaded before its first one exists. The seed masks that locally, so
   * every component that read `activeProject()` unguarded crashed the moment the list came
   * back empty from a real D1 — a white screen, not a "no projects yet" message. Callers must
   * handle the undefined case; `App` renders `EmptyState` for it.
   */
  activeProject: () => Project | undefined

  setView: (v: View) => void
  setActive: (id: string) => void
  selectBlock: (id: string | null) => void
  toggleInspect: (open?: boolean) => void
  updateBlock: (
    blockId: string,
    patch: { title?: string; body?: string; accent?: 'warn' | 'action' | 'ok' | undefined },
  ) => void

  loadProjects: () => Promise<void>
  runGeneration: (prompt: string) => Promise<void>

  /** Renames the active project; resolves `true` once the server has accepted the new name. */
  renameProject: (name: string) => Promise<boolean>

  /**
   * Removes a project from D1, then from the list.
   *
   * Resolves `true` once the server has it gone; `false` leaves the list exactly as it was, so
   * a failed delete cannot make a project look removed while the next reload brings it back.
   * The caller owns the confirmation — this performs whatever it is asked to.
   */
  deleteProject: (id: string) => Promise<boolean>

  /**
   * The AI-free way to start a project, behind the rail's "+ Proyek baru".
   *
   * The button used to be decoration — it had no handler at all, so it looked broken to anyone
   * who pressed it. Generation is the only other path to a new project and it is locked on
   * some deployments, which left those deployments unable to create one through the UI at all.
   * This creates an empty project directly, so the editor is never a dead end.
   */
  createBlankProject: () => Promise<void>

  runRevision: (prompt: string) => Promise<void>
  runPublish: () => Promise<void>

  dismissToast: (id: string) => void
}

export const useBuilder = create<BuilderState>((set, get) => ({
  projects: INITIAL_PROJECTS,
  activeId: INITIAL_PROJECTS[0].id,
  view: 'builder',
  toasts: [],
  selectedBlockId: null,
  inspectOpen: false,

  generation: { state: 'idle', stage: 0, message: '' },
  publish: { state: 'idle', message: '' },
  revision: { state: 'idle', message: '' },
  hasGenerated: true,

  loaded: false,
  loading: false,
  loadError: null,
  saving: false,
  saveError: null,

  activeProject: () => {
    const { projects, activeId } = get()
    return projects.find((p) => p.id === activeId) ?? projects[0]
  },

  setView: (view) => set({ view }),
  setActive: (activeId) =>
    set({ activeId, selectedBlockId: null, inspectOpen: false, view: 'builder' }),
  selectBlock: (selectedBlockId) => set({ selectedBlockId }),
  toggleInspect: (open) =>
    set((s) => ({ inspectOpen: open ?? !s.inspectOpen, selectedBlockId: open === false ? null : s.selectedBlockId })),

  /**
   * Replace the project list with the server's.
   *
   * A failure leaves the seed in place and records why. The app stays usable for reading and
   * for the free edit path; only the actions that need the server (generate, revise, publish)
   * will fail, and they say so themselves. Blanking the list instead would make a transient
   * network blip look like data loss.
   *
   * `activeId` is only changed if the id it points at no longer exists — otherwise the user's
   * selection would jump on every refresh.
   */
  loadProjects: async () => {
    set({ loading: true, loadError: null })
    try {
      const projects = await listProjects()
      set((s) => {
        const keepActive = projects.some((p) => p.id === s.activeId)
        return {
          projects,
          activeId: keepActive ? s.activeId : (projects[0]?.id ?? s.activeId),
          loaded: true,
          loading: false,
        }
      })
    } catch (error) {
      set({ loading: false, loadError: loadFailureMessage(error) })
    }
  },

  /**
   * Rename the active project and save it, resolving `true` only once D1 has it.
   *
   * The rename applies to local state first so the new name appears the instant the user
   * presses Enter, but this one returns a promise where `updateBlock` fires and forgets: a
   * rename is a deliberate, once-per-session action, so a silent failure would leave the user
   * believing a name is saved when it is not. The `false` lets the top bar say so and revert.
   */
  renameProject: async (name) => {
    const current = get().activeProject()
    if (current === undefined) return false

    const trimmed = name.trim()
    // An empty title leaves the project unnameable in the rail and the top bar, so it is
    // rejected rather than saved. Returning `false` rather than `true` keeps the caller from
    // closing the editor as if it had worked.
    if (trimmed === '') return false

    // Unchanged is not an error, but it is also not worth a round trip to D1.
    if (trimmed === current.name) return true

    const previous = current.name
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === s.activeId ? { ...p, name: trimmed, updatedAt: 'baru saja' } : p,
      ),
    }))

    try {
      /**
       * `PUT` with the whole project, because that is the server's contract. The rename is only
       * a change in `name`; everything else is sent back as held so a concurrent edit in the
       * inspector is not clobbered by a stale copy.
       */
      const saved = await upsertProject({ ...get().activeProject()!, name: trimmed })
      set((s) => ({
        projects: s.projects.map((p) => (p.id === saved.id ? saved : p)),
      }))
      return true
    } catch (error) {
      // Put the old name back: leaving the unsaved one on screen would be a claim D1 cannot
      // back up, and the next reload would silently contradict it.
      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === s.activeId ? { ...p, name: previous } : p,
        ),
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Gagal mengganti nama',
            body: error instanceof ApiError ? error.message : 'nama tidak tersimpan',
          },
        ],
      }))
      return false
    }
  },

  /**
   * The server first, then the list — the reverse of `renameProject`.
   *
   * The two orders are deliberate. A rename has something to show immediately (the typed name)
   * and reverting it is free, so it leads locally. A delete has nothing to show: dropping the
   * row before the server agrees would leave a project missing from the rail that is still in
   * D1 and returns on the next load, which reads as data coming back from the dead. Waiting
   * costs one round trip and makes "gone from the rail" mean "gone from the database".
   */
  deleteProject: async (id) => {
    // Captured before the await so the toast names the project that was asked for even if the
    // list changes while the request is in flight.
    const removed = get().projects.find((p) => p.id === id)

    try {
      await removeProject(id)
    } catch (error) {
      set((s) => ({
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Gagal menghapus proyek',
            body: error instanceof ApiError ? error.message : 'proyek tidak terhapus',
          },
        ],
      }))
      return false
    }

    set((s) => {
      const removedAt = s.projects.findIndex((p) => p.id === id)
      const remaining = s.projects.filter((p) => p.id !== id)
      const wasActive = s.activeId === id

      /**
       * Deleting the active project must land somewhere real. The item that slides into its
       * slot is the closest thing to "where I was" — taking `remaining[0]` instead would jump
       * the user to the newest project regardless of where in the rail they were. The last
       * item when the deleted one was last; with none left at all, `activeId` keeps pointing
       * at nothing, `activeProject()` returns `undefined` and `App` renders the empty state.
       *
       * The selection-derived UI is cleared only when the deleted project was the active one:
       * a block id from it would otherwise survive into the next project and select whatever
       * happened to share that id. Deleting some *other* project must not close an inspector
       * the user is working in.
       */
      const nextActive = wasActive
        ? (remaining[Math.min(removedAt, remaining.length - 1)]?.id ?? s.activeId)
        : s.activeId

      return {
        projects: remaining,
        activeId: nextActive,
        selectedBlockId: wasActive ? null : s.selectedBlockId,
        inspectOpen: wasActive ? false : s.inspectOpen,
        toasts:
          removed === undefined
            ? s.toasts
            : [
                ...s.toasts,
                {
                  id: uid('t'),
                  tone: 'ok',
                  title: 'Proyek dihapus',
                  body: `"${removed.name}" tidak lagi tersimpan.`,
                },
              ],
      }
    })

    return true
  },

  /**
   * The free path. It writes to the local JSON node tree and then to the server.
   *
   * It has no cost and no confirmation — the save is fire-and-forget with the tree already
   * updated optimistically, because a visual editor that waits on a round trip before showing
   * a colour change is not a visual editor. A failed save is surfaced in `saveError` and does
   * not revert the edit; the next successful save carries the current tree wholesale, so local
   * state and the server converge on the next edit rather than fighting each other now.
   */
  updateBlock: (blockId, patch) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id !== s.activeId
          ? p
          : {
              ...p,
              updatedAt: 'baru saja',
              screens: p.screens.map((sc) => ({
                ...sc,
                blocks: sc.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
              })),
            },
      ),
    }))
    void persistActive(set, get)
  },

  runGeneration: async (prompt) => {
    /**
     * A prompt too vague to derive a schema is refused before the call is made, so the wait
     * never starts for input that cannot succeed. The length is checked here as well as on the
     * server because the server's version costs a round trip to discover.
     */
    if (prompt.trim().length < 12) {
      set((s) => ({
        generation: { state: 'failed', stage: 0, message: '' },
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Generate gagal',
            body: 'Deskripsi terlalu pendek untuk menurunkan skema.',
          },
        ],
      }))
      return
    }

    set({
      generation: { state: 'running', stage: 0, message: 'Membaca deskripsi…' },
      hasGenerated: false,
    })

    /**
     * The stage messages advance on a timer rather than from server progress, because the
     * orchestrator answers in one response and reports nothing mid-flight — so these are a
     * plausible narration of what the server is doing, not a live status. They stop the moment
     * the answer lands, and the final stage is set from the result, never reached by the timer
     * alone.
     */
    const stages = [
      'Membaca deskripsi…',
      'Menyusun PRD & skema…',
      'Memvalidasi skema…',
      'Menyusun layar…',
    ]
    const timers = stages.map((message, i) =>
      window.setTimeout(() => {
        // Guard: a late timer must not overwrite a result that already arrived.
        if (get().generation.state !== 'running') return
        set({ generation: { state: 'running', stage: i, message } })
      }, 700 * (i + 1)),
    )

    try {
      const { project } = await generateProject(prompt)
      timers.forEach(window.clearTimeout)

      /**
       * The generated project gets its own row, rather than replacing the active project.
       *
       * Generating used to overwrite whatever was selected, which made a prompt a destructive
       * operation on work the user already had. With persistence the honest mapping is that a
       * prompt creates a project.
       *
       * The save happens before the success toast: telling the user it worked while the write
       * is still in flight would be a claim this code cannot yet make.
       */
      await createProject(project)

      set((s) => ({
        projects: [project, ...s.projects],
        activeId: project.id,
        generation: { state: 'done', stage: stages.length, message: '' },
        hasGenerated: true,
        selectedBlockId: null,
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'ok',
            title: 'Aplikasi siap ditinjau',
            body: 'Sunting teks dan warna lewat panel kanan.',
          },
        ],
      }))
    } catch (error) {
      timers.forEach(window.clearTimeout)

      const detail =
        error instanceof ApiError
          ? error.message
          : error instanceof ContractError
            ? error.message
            : 'output tidak dapat dibaca'

      set((s) => ({
        generation: { state: 'failed', stage: 0, message: '' },
        toasts: [
          ...s.toasts,
          { id: uid('t'), tone: 'danger', title: 'Generate gagal', body: detail },
        ],
      }))
    }
  },

  createBlankProject: async () => {
    /**
     * A real project, but with no tables and no screens — nothing invented.
     *
     * An empty project is honest where a seeded one is not: the user sees "0 tabel · 0 layar"
     * and the schema view's empty message, rather than example data that could be mistaken for
     * their own. The id is generated here so the row's identity does not depend on the
     * server's response shape.
     */
    const now = new Date()
    const stamp = String(now.getTime()).slice(-6)
    const blank: Project = {
      id: `p-${stamp}`,
      name: 'Proyek tanpa judul',
      slug: `proyek-${stamp}`,
      prompt: '',
      status: 'draft',
      tablesCount: 0,
      screensCount: 0,
      updatedAt: 'baru saja',
      tables: [],
      screens: [],
    }

    try {
      // The server normalises and returns the row; use that as the truth rather than the local
      // guess, so a reload cannot disagree with what was just added.
      const saved = await createProject(blank)
      set((s) => ({
        projects: [saved, ...s.projects],
        activeId: saved.id,
        selectedBlockId: null,
        inspectOpen: false,
        view: 'builder',
        toasts: [
          ...s.toasts,
          { id: uid('t'), tone: 'ok', title: 'Proyek dibuat', body: 'Ubah namanya lewat editor.' },
        ],
      }))
    } catch (error) {
      const detail = error instanceof ApiError ? error.message : 'proyek tidak dapat dibuat'
      set((s) => ({
        toasts: [...s.toasts, { id: uid('t'), tone: 'danger', title: 'Gagal membuat proyek', body: detail }],
      }))
    }
  },

  runRevision: async (prompt) => {
    const current = get().activeProject()
    // Nothing to revise: a revision edits an existing project's tree, so a zero-project store
    // has no subject. The UI never offers this path in that state, but the action is callable
    // from anywhere and silently posting an undefined project would be worse than a no-op.
    if (current === undefined) return

    set({ revision: { state: 'running', message: 'Menerapkan revisi…' } })

    /**
     * The instruction goes to the server with the tree the user is holding right now. The
     * server refuses a revision that discards their ids (M-7), and that refusal is the case
     * this branch exists for: the requested change did not happen.
     *
     * The revision keeps the project's id — the server enforces that — so the save below is
     * an update of the same row, not a second project.
     */
    try {
      const { project } = await reviseProject(current, prompt)
      await upsertProject(project)

      set((s) => ({
        projects: s.projects.map((p) => (p.id === project.id ? project : p)),
        revision: { state: 'done', message: '' },
        toasts: [...s.toasts, { id: uid('t'), tone: 'ok', title: 'Revisi diterapkan' }],
      }))
    } catch (error) {
      /**
       * `REVISION_DROPPED_DATA` is the one failure worth its own copy. The server is telling
       * us the model threw away something the user still had — a problem with the model's
       * answer, not with the instruction — and the useful advice is to retry or edit by hand,
       * not to rephrase as if the prompt were at fault.
       */
      const dropped = error instanceof ApiError && error.code === 'REVISION_DROPPED_DATA'
      const detail =
        error instanceof ApiError
          ? error.message
          : error instanceof ContractError
            ? error.message
            : 'revisi tidak dapat diterapkan'

      set((s) => ({
        revision: { state: 'failed', message: '' },
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: dropped ? 'Revisi ditolak — proyek tidak diubah' : 'Revisi gagal',
            body: dropped ? `${detail} Coba lagi, atau sunting lewat panel kanan.` : detail,
          },
        ],
      }))
    }
  },

  /**
   * Publish is still a simulation — no Worker or Pages project is created for the user.
   *
   * What is real is the `status: 'live'` write. It is saved, so a reload shows the project as
   * live rather than silently reverting to draft, which is the behaviour persistence exists to
   * stop. The step narration stays: it describes what publishing *will* do, and removing it
   * would imply the feature already does it.
   */
  runPublish: async () => {
    const project = get().activeProject()
    // Publishing marks an existing project live; with no project there is nothing to publish.
    if (project === undefined) return

    set({ publish: { state: 'running', message: 'Menyiapkan database…' } })

    const steps = ['Menyiapkan database…', 'Membangun Worker…', 'Menerbitkan Pages…']
    steps.forEach((message, i) => {
      window.setTimeout(() => {
        set({ publish: { state: 'running', message } })
      }, 900 * (i + 1))
    })

    const published: Project = { ...project, status: 'live', updatedAt: 'baru saja' }

    try {
      await upsertProject(published)
      set((s) => ({
        projects: s.projects.map((p) => (p.id === published.id ? published : p)),
        publish: { state: 'done', message: '' },
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'ok',
            title: 'Aplikasi terbit',
            body: `Aktif di ${published.slug}.pages.dev`,
          },
        ],
      }))
    } catch (error) {
      set((s) => ({
        publish: { state: 'failed', message: '' },
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Gagal menerbitkan',
            body: error instanceof ApiError ? error.message : 'Status tidak dapat disimpan.',
          },
        ],
      }))
    }
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/**
 * Save the active project, without making the caller wait or throw.
 *
 * `updateBlock` fires on every keystroke in the inspector, so this deliberately does not block
 * the edit behind a round trip and does not surface a toast per failure — a flaky connection
 * would otherwise bury the UI in error toasts. The failure lands in `saveError`, which the
 * shell renders once, and the next successful save overwrites the tree wholesale so a missed
 * write cannot leave the server holding half an edit.
 */
async function persistActive(
  set: (fn: (s: BuilderState) => Partial<BuilderState>) => void,
  get: () => BuilderState,
): Promise<void> {
  const project = get().activeProject()
  // Nothing active to save. Returning before `saving: true` matters: setting it here would
  // leave the flag raised forever, since the `saving: false` lives in the `try` below.
  if (project === undefined) return

  set(() => ({ saving: true, saveError: null }))

  try {
    await upsertProject(project)
    set(() => ({ saving: false }))
  } catch (error) {
    set(() => ({
      saving: false,
      saveError: error instanceof ApiError ? error.message : 'Perubahan belum tersimpan.',
    }))
  }
}
