import { PIPELINE } from '../../lib/types'
import { useBuilder } from '../../store/useBuilder'
import { IconCheck } from '../ui/Icons'

/**
 * The pipeline is the product's spine, so it is always readable rather than a
 * spinner. Each halt names its own state and its own count.
 */
export function Pipeline() {
  const generation = useBuilder((s) => s.generation)
  const project = useBuilder((s) => s.activeProject())
  const publish = useBuilder((s) => s.publish)

  // The pipeline narrates a project that exists. With none, `App` shows the empty state.
  if (project === undefined) return null

  const running = generation.state === 'running'
  const done = generation.state === 'done'
  const published = project.status === 'live' || publish.state === 'done'

  const subs = [
    'deskripsi diterima',
    `${project.tablesCount} tabel`,
    `${project.screensCount} layar`,
    'tersimpan',
    published ? 'aktif' : 'belum',
  ]

  return (
    <ol className="flex shrink-0 items-stretch overflow-x-auto border-b border-rule bg-ground px-5">
      {PIPELINE.map((stage, i) => {
        const state = done
          ? 'done'
          : running
            ? i < generation.stage
              ? 'done'
              : i === generation.stage
                ? 'active'
                : 'pending'
            : i < 3
              ? 'done'
              : 'pending'
        const isLast = i === PIPELINE.length - 1
        return (
          <li
            key={stage.id}
            className={`relative flex shrink-0 items-center gap-2.5 whitespace-nowrap py-2.5 pr-5 ${isLast ? '' : 'mr-5'}`}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${
                state === 'done'
                  ? 'border-ok-ink bg-ok-ink text-white'
                  : state === 'active'
                    ? 'border-action bg-action-soft text-action'
                    : 'border-rule-strong bg-ground text-transparent'
              }`}
            >
              {state === 'done' ? (
                <IconCheck className="h-2.5 w-2.5" />
              ) : state === 'active' ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-action" />
              ) : null}
            </span>
            <span className="flex flex-col leading-tight">
              <span
                className={`text-body font-medium ${
                  state === 'pending' ? 'text-ink-meta' : 'text-ink'
                }`}
              >
                {stage.label}
              </span>
              <span className="tnum whitespace-nowrap font-mono text-[11.5px] text-ink-meta">
                {running && state === 'active' ? generation.message : subs[i]}
              </span>
            </span>
            {!isLast && (
              <span
                aria-hidden
                className={`absolute right-0 top-1/2 h-5 w-px -translate-y-1/2 ${
                  state === 'done' ? 'bg-ok-ink/35' : 'bg-rule'
                }`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
