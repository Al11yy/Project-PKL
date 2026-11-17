import { create } from 'zustand'
import { COIN_COST, type LedgerEntry, type Project } from '../lib/types'
import { SEED_LEDGER, SEED_PROJECTS, STARTER_BALANCE } from '../lib/seed'
import { parseProjectsOrThrowAtStartup, ContractError } from '../lib/parse'
import { ApiError, generateProject, reviseProject } from '../lib/api'

export type View = 'builder' | 'schema' | 'ledger'

export type Toast = {
  id: string
  tone: 'ok' | 'warn' | 'danger'
  title: string
  body?: string
}

type RunState = 'idle' | 'running' | 'done' | 'failed'

let seq = 0
const uid = (p: string) => `${p}_${(++seq).toString(16).padStart(4, '0')}`

/** Opening balance before any recorded entry, so the ledger reconciles to 128. */
const STARTER_BALANCE_BASE = STARTER_BALANCE - SEED_LEDGER.reduce((s, e) => s + e.coins, 0)

/**
 * Seed data is parsed exactly once, at module load. It is authored in this repo rather than
 * produced by a model, so a failure here is a coding error and throws loudly instead of
 * degrading to an empty app — an app that renders nothing is far harder to diagnose than
 * one that names the seed field that broke the contract.
 *
 * This is the only place `projects` enters state. `updateBlock` mutates an already-parsed
 * tree and must not re-parse it: that is the free-editor path and has to stay instant.
 */
const INITIAL_PROJECTS = parseProjectsOrThrowAtStartup(SEED_PROJECTS)

const now = () =>
  new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

/**
 * Ledger discipline, mirrored from the product rules: a spend is written
 * before the work starts, and a failed run writes a matching refund. The
 * balance is derived from the ledger, never stored as a mutable number that
 * can drift from its history.
 */
function applyEntry(ledger: LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  return [entry, ...ledger]
}

const balanceOf = (ledger: LedgerEntry[]) =>
  ledger.reduce((sum, e) => sum + e.coins, STARTER_BALANCE_BASE)

interface BuilderState {
  projects: Project[]
  activeId: string
  ledger: LedgerEntry[]
  view: View
  toasts: Toast[]
  /** Which inspectable block is selected, per screen. */
  selectedBlockId: string | null
  inspectOpen: boolean

  generation: { state: RunState; stage: number; message: string }
  publish: { state: RunState; message: string }
  revision: { state: RunState; message: string }
  hasGenerated: boolean

  balance: () => number
  activeProject: () => Project

  setView: (v: View) => void
  setActive: (id: string) => void
  selectBlock: (id: string | null) => void
  toggleInspect: (open?: boolean) => void
  updateBlock: (
    blockId: string,
    patch: { title?: string; body?: string; accent?: 'warn' | 'action' | 'ok' | undefined },
  ) => void

  runGeneration: (prompt: string) => Promise<void>
  runRevision: (prompt: string) => Promise<void>
  runPublish: () => void
  topUp: (coins: number) => void

  dismissToast: (id: string) => void
}

export const useBuilder = create<BuilderState>((set, get) => ({
  projects: INITIAL_PROJECTS,
  activeId: INITIAL_PROJECTS[0].id,
  ledger: SEED_LEDGER,
  view: 'builder',
  toasts: [],
  selectedBlockId: null,
  inspectOpen: false,

  generation: { state: 'idle', stage: 0, message: '' },
  publish: { state: 'idle', message: '' },
  revision: { state: 'idle', message: '' },
  hasGenerated: true,

  balance: () => balanceOf(get().ledger),
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
   * The free path. It writes to the local JSON node tree only, so it can never
   * touch the ledger. If this ever grew a cost, the product's escape hatch
   * would be gone.
   */
  updateBlock: (blockId, patch) =>
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
    })),

  runGeneration: async (prompt) => {
    const cost = COIN_COST.generate
    const balance = get().balance()
    if (balance < cost) {
      set((s) => ({
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Koin tidak cukup',
            body: `Butuh ${cost} koin, saldo Anda ${balance}. Isi saldo dulu untuk melanjutkan.`,
          },
        ],
      }))
      return
    }

    const ref = uid('gen')

    /**
     * A real failure with a real recovery. A prompt too vague to derive a
     * schema is refused *after* the spend is written, then refunded in full,
     * so the refund path is something a user can actually reach and verify
     * rather than a claim in the copy.
     */
    if (prompt.trim().length < 12) {
      set((s) => ({
        ledger: [
          {
            id: uid('l'),
            at: now(),
            label: 'Generate PRD & UI',
            detail: 'gagal — deskripsi terlalu pendek',
            coins: -cost,
            outcome: 'failed',
            refId: ref,
          },
          {
            id: uid('l'),
            at: now(),
            label: 'Refund otomatis',
            detail: 'generate gagal sebelum ada output',
            coins: cost,
            outcome: 'refunded',
            refId: ref,
          },
          ...s.ledger,
        ],
        generation: { state: 'failed', stage: 0, message: '' },
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Generate gagal — koin dikembalikan',
            body: `Deskripsi terlalu pendek untuk menurunkan skema. ${cost} koin sudah kembali ke saldo Anda.`,
          },
        ],
      }))
      return
    }
    const entry: LedgerEntry = {
      id: uid('l'),
      at: now(),
      label: 'Generate PRD & UI',
      detail: 'memproses…',
      coins: -cost,
      outcome: 'spent',
      refId: ref,
    }
    set((s) => ({
      ledger: applyEntry(s.ledger, entry),
      generation: { state: 'running', stage: 0, message: 'Membaca deskripsi…' },
      hasGenerated: false,
    }))

    /**
     * The real call. The stage messages advance on a timer rather than from server progress,
     * because the orchestrator answers in one response and reports nothing mid-flight — so
     * these are a plausible narration of what the server is doing, not a live status. They
     * stop the moment the answer lands, and the final stage is set from the result, never
     * reached by the timer alone.
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
       * The tree replaces the active project wholesale. Merging would leave blocks from the
       * previous generation in place, and the point of a revision is that the server's answer
       * is the whole truth about the project.
       */
      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === s.activeId ? { ...project, updatedAt: 'baru saja' } : p,
        ),
        generation: { state: 'done', stage: stages.length, message: '' },
        hasGenerated: true,
        selectedBlockId: null,
        ledger: s.ledger.map((e) =>
          e.refId === ref
            ? { ...e, detail: `${project.tablesCount} tabel · ${project.screensCount} layar` }
            : e,
        ),
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'ok',
            title: 'Aplikasi siap ditinjau',
            body: `${cost} koin terpakai. Sunting teks dan warna gratis lewat panel kanan.`,
          },
        ],
      }))
    } catch (error) {
      timers.forEach(window.clearTimeout)

      /**
       * Every failure refunds in full, including a server-side one. The ledger records the
       * spend and the refund as two entries rather than netting them, so the user can see
       * that the charge happened and was returned — a single adjusted line would hide the
       * failure that M-9's refund copy exists to make visible.
       */
      const detail =
        error instanceof ApiError
          ? error.message
          : error instanceof ContractError
            ? error.message
            : 'output tidak dapat dibaca'

      set((s) => ({
        ledger: [
          {
            id: uid('l'),
            at: now(),
            label: 'Refund otomatis',
            detail: 'generate gagal sebelum ada output',
            coins: cost,
            outcome: 'refunded',
            refId: ref,
          },
          ...s.ledger.map((e) =>
            e.refId === ref ? { ...e, detail: 'gagal — output tidak valid' } : e,
          ),
        ],
        generation: { state: 'failed', stage: 0, message: '' },
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Generate gagal — koin dikembalikan',
            body: `${detail} ${cost} koin sudah kembali ke saldo Anda.`,
          },
        ],
      }))
    }
  },

  runRevision: async (prompt) => {
    const cost = COIN_COST.revise
    const balance = get().balance()
    if (balance < cost) {
      set((s) => ({
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Koin tidak cukup',
            body: `Butuh ${cost} koin, saldo Anda ${balance}.`,
          },
        ],
      }))
      return
    }
    const ref = uid('rev')
    set((s) => ({
      ledger: applyEntry(s.ledger, {
        id: uid('l'),
        at: now(),
        label: 'Revisi lewat prompt',
        detail: prompt.slice(0, 48) || 'revisi',
        coins: -cost,
        outcome: 'spent',
        refId: ref,
      }),
      revision: { state: 'running', message: 'Menerapkan revisi…' },
    }))
    /**
     * The instruction goes to the server with the tree the user is holding right now. The
     * server refuses a revision that discards their ids (M-7), and that refusal is the case
     * this branch exists for: the requested change did not happen, so the coins come back.
     */
    try {
      const { project } = await reviseProject(get().activeProject(), prompt)

      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === s.activeId ? { ...project, updatedAt: 'baru saja' } : p,
        ),
        revision: { state: 'done', message: '' },
        ledger: s.ledger.map((e) =>
          e.refId === ref ? { ...e, detail: prompt.slice(0, 48) || 'revisi' } : e,
        ),
        toasts: [
          ...s.toasts,
          { id: uid('t'), tone: 'ok', title: 'Revisi diterapkan', body: `${cost} koin terpakai.` },
        ],
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
        ledger: [
          {
            id: uid('l'),
            at: now(),
            label: 'Refund otomatis',
            detail: dropped ? 'revisi ditolak — data akan hilang' : 'revisi gagal',
            coins: cost,
            outcome: 'refunded',
            refId: ref,
          },
          ...s.ledger.map((e) =>
            e.refId === ref ? { ...e, detail: 'gagal — revisi ditolak' } : e,
          ),
        ],
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: dropped ? 'Revisi ditolak — proyek tidak diubah' : 'Revisi gagal — koin dikembalikan',
            body: dropped
              ? `${detail} Coba lagi, atau sunting langsung lewat panel kanan.`
              : `${detail} ${cost} koin sudah kembali ke saldo Anda.`,
          },
        ],
      }))
    }
  },

  runPublish: () => {
    const cost = COIN_COST.publish
    const balance = get().balance()
    if (balance < cost) {
      set((s) => ({
        toasts: [
          ...s.toasts,
          {
            id: uid('t'),
            tone: 'danger',
            title: 'Koin tidak cukup untuk menerbitkan',
            body: `Butuh ${cost} koin, saldo Anda ${balance}.`,
          },
        ],
      }))
      return
    }
    const ref = uid('dep')
    set((s) => ({
      ledger: applyEntry(s.ledger, {
        id: uid('l'),
        at: now(),
        label: 'Terbitkan ke Cloudflare',
        detail: 'menyiapkan D1 & Worker…',
        coins: -cost,
        outcome: 'spent',
        refId: ref,
      }),
      publish: { state: 'running', message: 'Menyiapkan database…' },
    }))

    const steps = ['Menyiapkan database…', 'Membangun Worker…', 'Menerbitkan Pages…']
    steps.forEach((message, i) => {
      window.setTimeout(() => {
        set({ publish: { state: 'running', message } })
        if (i === steps.length - 1) {
          set((s) => ({
            publish: { state: 'done', message: '' },
            ledger: s.ledger.map((e) =>
              e.refId === ref ? { ...e, detail: 'Pages · D1 · Worker' } : e,
            ),
            projects: s.projects.map((p) =>
              p.id === s.activeId ? { ...p, status: 'live', updatedAt: 'baru saja' } : p,
            ),
            toasts: [
              ...s.toasts,
              {
                id: uid('t'),
                tone: 'ok',
                title: 'Aplikasi terbit',
                body: `Aktif di ${s.activeProject().slug}.pages.dev · ${cost} koin terpakai.`,
              },
            ],
          }))
        }
      }, 900 * (i + 1))
    })
  },

  topUp: (coins) =>
    set((s) => ({
      ledger: applyEntry(s.ledger, {
        id: uid('l'),
        at: now(),
        label: 'Isi saldo',
        detail: 'QRIS terverifikasi',
        coins,
        outcome: 'spent',
        refId: uid('top'),
      }),
      toasts: [
        ...s.toasts,
        { id: uid('t'), tone: 'ok', title: `Saldo bertambah ${coins} koin`, body: 'Pembayaran terverifikasi.' },
      ],
    })),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
