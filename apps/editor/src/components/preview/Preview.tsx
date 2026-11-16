import type { Screen, UIBlock } from '../../lib/types'
import { useBuilder } from '../../store/useBuilder'
import { IconAlert, IconExternal, IconWand } from '../ui/Icons'

/**
 * The generated app, rendered from the JSON node tree. No markup is stored or
 * shown: the product's rule is that the model emits validated JSON mapped onto
 * whitelisted blocks, so this renderer is the only thing that decides what a
 * block looks like.
 */
export function Preview() {
  const project = useBuilder((s) => s.activeProject())
  const inspectOpen = useBuilder((s) => s.inspectOpen)
  const selectedBlockId = useBuilder((s) => s.selectedBlockId)
  const selectBlock = useBuilder((s) => s.selectBlock)
  const generation = useBuilder((s) => s.generation)
  const publish = useBuilder((s) => s.publish)

  const screen = project.screens[0]
  const live = project.status === 'live'

  return (
    <div className="min-h-0 flex-1 overflow-hidden p-5 pt-4">
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-rule-strong bg-ground shadow-[0_1px_2px_rgba(17,24,39,0.05),0_12px_32px_-12px_rgba(17,24,39,0.10)]">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rule bg-ground-sunken px-3.5">
          <span className="flex gap-1.5" aria-hidden>
            <i className="h-2 w-2 rounded-full bg-rule-strong" />
            <i className="h-2 w-2 rounded-full bg-rule-strong" />
            <i className="h-2 w-2 rounded-full bg-rule-strong" />
          </span>
          <span className="ml-2 flex min-w-0 items-center gap-1.5 rounded border border-rule bg-ground px-2 py-1 font-mono text-[11.5px] text-ink-meta">
            <span className="truncate">{project.slug}.pages.dev</span>
          </span>
          <span
            className={`ml-auto shrink-0 rounded px-2 py-[3px] text-[11.5px] font-semibold ${
              live ? 'bg-ok-bg text-ok-ink' : 'bg-warn-bg text-warn-ink'
            }`}
          >
            {live ? 'Terbit' : 'Draf'}
          </span>
          <IconExternal className="h-3.5 w-3.5 shrink-0 text-ink-meta" />
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto bg-ground">
          {generation.state === 'running' ? (
            <GeneratingState />
          ) : generation.state === 'failed' ? (
            <FailedState />
          ) : screen ? (
            <ScreenView
              screen={screen}
              inspectOpen={inspectOpen}
              selectedBlockId={selectedBlockId}
              onSelect={selectBlock}
            />
          ) : (
            <EmptyState />
          )}
          {publish.state === 'running' && (
            <div className="absolute inset-x-0 bottom-0 border-t border-rule bg-ground px-4 py-2.5">
              <span className="text-meta font-medium text-ink-body">{publish.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ScreenView({
  screen,
  inspectOpen,
  selectedBlockId,
  onSelect,
}: {
  screen: Screen
  inspectOpen: boolean
  selectedBlockId: string | null
  onSelect: (id: string) => void
}) {
  const nav = screen.blocks.find((b) => b.kind === 'navbar')
  const stats = screen.blocks.filter((b) => b.kind === 'stat')
  const rest = screen.blocks.filter((b) => b.kind !== 'navbar' && b.kind !== 'stat')

  return (
    <div className="p-5">
      {nav && (
        <NavBlock block={nav} inspectOpen={inspectOpen} selected={selectedBlockId === nav.id} onSelect={onSelect} />
      )}

      {stats.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {stats.map((b) => (
            <StatBlock
              key={b.id}
              block={b}
              inspectOpen={inspectOpen}
              selected={selectedBlockId === b.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      {rest.map((b) => (
        <div key={b.id} className="mt-3">
          {b.kind === 'table' && (
            <TableBlock
              block={b}
              inspectOpen={inspectOpen}
              selected={selectedBlockId === b.id}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
    </div>
  )
}

const ring = (inspectOpen: boolean, selected: boolean) =>
  inspectOpen
    ? `cursor-pointer rounded-[3px] outline-dashed outline-1 outline-offset-2 transition-[outline-color] ${
        selected ? 'outline-action' : 'outline-transparent hover:outline-rule-strong'
      }`
    : ''

function NavBlock({
  block,
  inspectOpen,
  selected,
  onSelect,
}: {
  block: UIBlock
  inspectOpen: boolean
  selected: boolean
  onSelect: (id: string) => void
}) {
  const links = (block.body ?? '').split('·').map((s) => s.trim())
  return (
    <div
      onClick={() => inspectOpen && onSelect(block.id)}
      className={`flex items-center justify-between border-b border-rule pb-3 ${ring(inspectOpen, selected)}`}
    >
      <span className="text-[15px] font-semibold tracking-[-0.01em]">{block.title}</span>
      <span className="flex gap-4 text-meta font-medium text-ink-meta">
        {links.map((l, i) => (
          <span key={l + i} className={i === 0 ? 'text-action' : ''}>
            {l}
          </span>
        ))}
      </span>
    </div>
  )
}

function StatBlock({
  block,
  inspectOpen,
  selected,
  onSelect,
}: {
  block: UIBlock
  inspectOpen: boolean
  selected: boolean
  onSelect: (id: string) => void
}) {
  const warn = block.accent === 'warn'
  return (
    <div
      onClick={() => inspectOpen && onSelect(block.id)}
      className={`border border-rule p-2.5 ${ring(inspectOpen, selected)}`}
    >
      <div className="text-[11.5px] font-medium text-ink-meta">{block.title}</div>
      <div
        className={`tnum mt-0.5 font-mono text-[21px] font-bold tracking-[-0.02em] ${
          warn ? 'text-warn-ink' : 'text-ink'
        }`}
      >
        {block.body}
      </div>
    </div>
  )
}

const ROWS = [
  ['Siti Rahmawati', 'Pemeriksaan Umum', '16 Nov', 'Lunas'],
  ['Budi Santoso', 'Kontrol Gigi', '16 Nov', 'Lunas'],
  ['Ani Wijaya', 'Imunisasi', '16 Nov', 'Tertunda'],
  ['Dedi Kurniawan', 'Pemeriksaan Umum', '16 Nov', 'Lunas'],
]

function TableBlock({
  block,
  inspectOpen,
  selected,
  onSelect,
}: {
  block: UIBlock
  inspectOpen: boolean
  selected: boolean
  onSelect: (id: string) => void
}) {
  const cols = (block.body ?? '').split('·').map((s) => s.trim())
  return (
    <div
      onClick={() => inspectOpen && onSelect(block.id)}
      className={`border border-rule ${ring(inspectOpen, selected)}`}
    >
      <div className="border-b border-rule px-3 py-2">
        <span className="text-meta font-medium text-ink-body">{block.title}</span>
      </div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-ground-sunken">
            {cols.map((c) => (
              <th
                key={c}
                className="px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-meta"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, i) => (
            <tr key={i} className="border-t border-rule-soft">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-[7px] text-meta text-ink-body">
                  {j === r.length - 1 ? (
                    <span
                      className={`rounded px-1.5 py-px text-[11.5px] font-semibold ${
                        cell === 'Lunas' ? 'bg-ok-bg text-ok-ink' : 'bg-warn-bg text-warn-ink'
                      }`}
                    >
                      {cell}
                    </span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GeneratingState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-action-soft text-action">
        <IconWand className="h-5 w-5" />
      </span>
      <p className="text-body font-medium text-ink">Menyusun aplikasi Anda</p>
      <p className="max-w-[42ch] text-meta leading-5 text-ink-meta">
        Koin sudah dipotong dan tercatat. Kalau proses ini gagal, koin dikembalikan otomatis dan
        baris refund muncul di riwayat.
      </p>
    </div>
  )
}

function FailedState() {
  const balance = useBuilder((s) => s.balance())
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-danger-bg text-danger-ink">
        <IconAlert className="h-5 w-5" />
      </span>
      <p className="text-body font-semibold text-ink">Generate gagal</p>
      <p className="max-w-[46ch] text-meta leading-5 text-ink-body">
        Deskripsi terlalu pendek untuk menurunkan skema. Koin sudah dikembalikan seluruhnya — saldo
        Anda kini <span className="tnum font-mono font-semibold">{balance}</span> koin, dan baris
        refund tercatat di riwayat.
      </p>
      <p className="max-w-[46ch] text-meta leading-5 text-ink-meta">
        Coba sebutkan entitas yang ingin dicatat, misalnya &ldquo;pasien, layanan, obat, dan
        pembayaran&rdquo;.
      </p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-body font-medium text-ink">Belum ada layar</p>
      <p className="max-w-[38ch] text-meta leading-5 text-ink-meta">
        Tulis deskripsi aplikasi di kolom prompt di atas, lalu jalankan generate untuk membuat PRD,
        skema, dan UI pertama.
      </p>
    </div>
  )
}
