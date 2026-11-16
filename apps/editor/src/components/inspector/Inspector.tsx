import { useBuilder } from '../../store/useBuilder'
import { IconClose, IconSliders } from '../ui/Icons'

const ACCENTS = [
  { id: 'default', label: 'Netral', swatch: '#111827' },
  { id: 'warn', label: 'Peringatan', swatch: '#B45309' },
  { id: 'action', label: 'Aksi', swatch: '#2563EB' },
  { id: 'ok', label: 'Aman', swatch: '#047857' },
]

/**
 * The free path, stated as such on the panel itself. It edits the local JSON
 * node tree, so it never reaches the ledger: whatever this panel does, the
 * balance above is unchanged, and saying so is the point.
 */
export function Inspector() {
  const open = useBuilder((s) => s.inspectOpen)
  const toggle = useBuilder((s) => s.toggleInspect)
  const project = useBuilder((s) => s.activeProject())
  const selectedBlockId = useBuilder((s) => s.selectedBlockId)
  const updateBlock = useBuilder((s) => s.updateBlock)

  if (!open) return null

  const block = project.screens
    .flatMap((sc) => sc.blocks)
    .find((b) => b.id === selectedBlockId)

  return (
    <aside
      className="flex w-[300px] shrink-0 flex-col border-l border-rule bg-ground-panel"
      aria-label="Editor visual"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-4">
        <span className="flex items-center gap-2 text-body font-semibold">
          <IconSliders className="h-4 w-4 text-ink-meta" />
          Editor visual
        </span>
        <button
          onClick={() => toggle(false)}
          aria-label="Tutup editor visual"
          className="press grid h-7 w-7 place-items-center rounded-md text-ink-meta hover:bg-ground-sunken hover:text-ink"
        >
          <IconClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="border-b border-rule bg-ok-bg px-4 py-2.5">
        <p className="text-meta leading-5 text-ok-ink">
          <span className="font-semibold">0 koin.</span> Semua perubahan di panel ini gratis —
          diedit langsung di pohon data, tanpa memanggil AI.
        </p>
      </div>

      {!block ? (
        <div className="px-4 py-6">
          <p className="text-body font-medium text-ink">Belum ada blok dipilih</p>
          <p className="mt-1.5 text-meta leading-5 text-ink-meta">
            Klik salah satu blok di pratinjau untuk menyunting teks dan warnanya di sini.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-meta">
              Jenis blok
            </span>
            <span className="rounded border border-rule bg-ground px-1.5 py-px font-mono text-[11.5px] text-ink-body">
              {block.kind}
            </span>
          </div>

          <div className="mt-4">
            <label
              htmlFor="block-title"
              className="mb-1.5 block text-meta font-medium text-ink-body"
            >
              Judul
            </label>
            <input
              id="block-title"
              value={block.title ?? ''}
              onChange={(e) => updateBlock(block.id, { title: e.target.value })}
              className="w-full rounded-md border border-rule-strong bg-ground px-2.5 py-2 text-body text-ink focus:border-action focus:outline-none"
            />
          </div>

          <div className="mt-3.5">
            <label
              htmlFor="block-body"
              className="mb-1.5 block text-meta font-medium text-ink-body"
            >
              Isi
            </label>
            <textarea
              id="block-body"
              rows={2}
              value={block.body ?? ''}
              onChange={(e) => updateBlock(block.id, { body: e.target.value })}
              className="w-full resize-none rounded-md border border-rule-strong bg-ground px-2.5 py-2 text-body leading-5 text-ink focus:border-action focus:outline-none"
            />
            <p className="mt-1.5 text-[11.5px] leading-4 text-ink-meta">
              Pisahkan dengan <span className="font-mono">·</span> untuk kolom tabel atau menu.
            </p>
          </div>

          <fieldset className="mt-4">
            <legend className="mb-1.5 text-meta font-medium text-ink-body">Warna aksen</legend>
            <div className="flex flex-wrap gap-1.5">
              {ACCENTS.map((a) => {
                const on = (block.accent ?? 'default') === a.id
                return (
                  <button
                    key={a.id}
                    onClick={() =>
                      updateBlock(block.id, { accent: a.id === 'default' ? undefined : a.id })
                    }
                    aria-pressed={on}
                    title={a.label}
                    className={`press flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11.5px] font-medium ${
                      on
                        ? 'border-ink bg-ground text-ink'
                        : 'border-rule bg-ground text-ink-muted hover:border-rule-strong'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: a.swatch }}
                      aria-hidden
                    />
                    {a.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="mt-5 border-t border-rule pt-3.5">
            <p className="tnum font-mono text-[11.5px] text-ink-meta">
              blok {block.id} · skema tersimpan terpisah dari UI
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}
