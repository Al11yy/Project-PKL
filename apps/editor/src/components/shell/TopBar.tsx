import { COIN_COST } from '../../lib/types'
import { useBuilder } from '../../store/useBuilder'
import { ActionButton, IconButton } from '../ui/Button'
import { IconArrowUpRight, IconExternal, IconRocket, IconSliders, IconTable } from '../ui/Icons'

export function TopBar() {
  const project = useBuilder((s) => s.activeProject())
  const balance = useBuilder((s) => s.balance())
  const publish = useBuilder((s) => s.publish)
  const runPublish = useBuilder((s) => s.runPublish)
  const inspectOpen = useBuilder((s) => s.inspectOpen)
  const toggleInspect = useBuilder((s) => s.toggleInspect)
  const setView = useBuilder((s) => s.setView)

  const publishing = publish.state === 'running'
  const canAfford = balance >= COIN_COST.publish
  const live = project.status === 'live'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule bg-ground px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        {/* The title keeps its room and truncates only as a last resort; the
            meta yields first, since it is context rather than an action. */}
        <h1 className="max-w-[22rem] truncate text-[17px] font-semibold tracking-[-0.015em]">
          {project.name}
        </h1>
        {/* Shown only once the bar genuinely has room for it: at 1280px it
            would force the project name to truncate, which reads far worse. */}
        <span className="tnum hidden shrink-0 whitespace-nowrap font-mono text-meta text-ink-meta min-[1400px]:inline">
          {project.tablesCount} tabel · {project.screensCount} layar · {project.updatedAt}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Schema has its own rail item, so this shortcut yields first when the
            bar gets tight rather than pushing the priced action off-screen. */}
        <ActionButton
          variant="ghost"
          size="sm"
          icon={<IconTable className="h-3.5 w-3.5" />}
          onClick={() => setView('schema')}
          className="hidden xl:inline-flex"
        >
          Lihat skema
        </ActionButton>
        <ActionButton
          variant={inspectOpen ? 'secondary' : 'ghost'}
          size="sm"
          icon={<IconSliders className="h-3.5 w-3.5" />}
          onClick={() => toggleInspect()}
          aria-pressed={inspectOpen}
        >
          Edit visual
          <span className="ml-0.5 rounded border border-ok-ink/25 bg-ok-bg px-1.5 py-px font-mono text-[11.5px] leading-4 text-ok-ink">
            gratis
          </span>
        </ActionButton>

        {live ? (
          <>
            <ActionButton
              variant="secondary"
              size="sm"
              icon={<IconExternal className="h-3.5 w-3.5" />}
              onClick={() => setView('schema')}
            >
              Buka aplikasi
            </ActionButton>
            {/* Publishing stays reachable after the first deploy: an edit made
                after going live still needs a way back out, and the price must
                stay on the button that charges it. */}
            <ActionButton
              variant="primary"
              size="sm"
              icon={<IconRocket className="h-3.5 w-3.5" />}
              onClick={runPublish}
              disabled={publishing || !canAfford}
              cost={COIN_COST.publish}
              title={
                canAfford
                  ? `Terbitkan ulang · −${COIN_COST.publish} koin`
                  : `Butuh ${COIN_COST.publish} koin, saldo Anda ${balance}`
              }
            >
              {publishing ? 'Menerbitkan…' : 'Terbitkan ulang'}
            </ActionButton>
          </>
        ) : (
          <ActionButton
            variant="primary"
            size="sm"
            icon={<IconRocket className="h-3.5 w-3.5" />}
            onClick={runPublish}
            disabled={publishing || !canAfford}
            cost={COIN_COST.publish}
            title={
              canAfford
                ? `Terbitkan ke Cloudflare · −${COIN_COST.publish} koin`
                : `Butuh ${COIN_COST.publish} koin, saldo Anda ${balance}`
            }
          >
            {publishing ? 'Menerbitkan…' : 'Terbitkan'}
          </ActionButton>
        )}

        <IconButton label="Buka pratinjau di tab baru">
          <IconArrowUpRight />
        </IconButton>
      </div>
    </header>
  )
}
