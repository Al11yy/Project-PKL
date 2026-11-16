import type { ReactNode } from 'react'
import { COIN_COST } from '../../lib/types'
import { useBuilder, type View } from '../../store/useBuilder'
import { ActionButton } from '../ui/Button'
import { IconCoins, IconLayers, IconPlus, IconTable } from '../ui/Icons'

const NAV: { id: View; label: string; icon: ReactNode }[] = [
  { id: 'builder', label: 'Editor', icon: <IconLayers /> },
  { id: 'schema', label: 'Skema', icon: <IconTable /> },
  { id: 'ledger', label: 'Riwayat koin', icon: <IconCoins /> },
]

export function Rail() {
  const projects = useBuilder((s) => s.projects)
  const activeId = useBuilder((s) => s.activeId)
  const view = useBuilder((s) => s.view)
  const setView = useBuilder((s) => s.setView)
  const setActive = useBuilder((s) => s.setActive)
  const balance = useBuilder((s) => s.balance())
  const topUp = useBuilder((s) => s.topUp)

  const low = balance < COIN_COST.generate

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-rule bg-ground-panel">
      <div className="flex items-center gap-2.5 border-b border-rule px-4 py-4">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-action font-mono text-[13px] font-bold text-white">
          R
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.01em]">
          Rakit<span className="text-ink-meta">.ai</span>
        </span>
      </div>

      <nav className="flex flex-col gap-0.5 p-2.5" aria-label="Utama">
        {NAV.map((item) => {
          const on = view === item.id
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-current={on ? 'page' : undefined}
              className={`press flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-body font-medium ${
                on
                  ? 'bg-action-soft text-action'
                  : 'text-ink-body hover:bg-ground-sunken hover:text-ink'
              }`}
            >
              <span className={on ? 'text-action' : 'text-ink-meta'}>{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="flex items-center justify-between px-4 pb-1.5 pt-3">
        <h2 className="text-micro font-semibold uppercase tracking-[0.07em] text-ink-meta">
          Proyek Anda
        </h2>
        <span className="tnum font-mono text-[11.5px] text-ink-meta">{projects.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {projects.map((p) => {
          const on = p.id === activeId
          return (
            <button
              key={p.id}
              onClick={() => setActive(p.id)}
              aria-current={on ? 'true' : undefined}
              className={`press mb-0.5 flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left ${
                on
                  ? 'border-rule-strong bg-ground shadow-[0_1px_2px_rgba(17,24,39,0.06)]'
                  : 'border-transparent hover:bg-ground-sunken'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="truncate text-body font-medium text-ink">{p.name}</span>
                {p.status === 'live' && (
                  <span className="shrink-0 rounded bg-ok-bg px-1.5 py-px text-[11px] font-semibold text-ok-ink">
                    Terbit
                  </span>
                )}
              </span>
              <span className="tnum font-mono text-[11.5px] text-ink-meta">
                {p.tablesCount} tabel · {p.screensCount} layar
              </span>
            </button>
          )
        })}
        <button className="press mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-rule-strong px-2.5 py-2 text-meta font-medium text-ink-muted hover:border-ink-meta hover:text-ink">
          <IconPlus className="h-3.5 w-3.5" />
          Proyek baru
        </button>
      </div>

      <div className="border-t border-rule p-3">
        <div className="rounded-lg border border-rule bg-ground p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-micro font-semibold uppercase tracking-[0.07em] text-ink-meta">
              Saldo koin
            </span>
            <span className="tnum font-mono text-figure font-bold text-ink">{balance}</span>
          </div>
          <div
            className={`mt-1 text-[11.5px] leading-4 ${low ? 'text-warn-ink' : 'text-ink-meta'}`}
          >
            {low
              ? `Kurang dari ${COIN_COST.generate} — generate butuh ${COIN_COST.generate} koin.`
              : `Generate butuh ${COIN_COST.generate} · terbit butuh ${COIN_COST.publish}.`}
          </div>
          {/* No price badge here: topping up buys coins, it never spends them.
              A "gratis" chip on a purchase would be the exact lie the rest of
              this surface exists to avoid. */}
          <ActionButton
            className="mt-2.5 w-full"
            variant="secondary"
            size="sm"
            onClick={() => topUp(100)}
          >
            Isi saldo
          </ActionButton>
        </div>
      </div>
    </aside>
  )
}
