import { useBuilder } from '../../store/useBuilder'
import { IconAlert, IconCheck, IconClose } from './Icons'

const STYLE = {
  ok: { box: 'border-ok-ink/30 bg-ok-bg', ink: 'text-ok-ink', icon: <IconCheck className="h-3.5 w-3.5" /> },
  warn: { box: 'border-warn-ink/30 bg-warn-bg', ink: 'text-warn-ink', icon: <IconAlert className="h-3.5 w-3.5" /> },
  danger: {
    box: 'border-danger-ink/30 bg-danger-bg',
    ink: 'text-danger-ink',
    icon: <IconAlert className="h-3.5 w-3.5" />,
  },
} as const

export function Toasts() {
  const toasts = useBuilder((s) => s.toasts)
  const dismiss = useBuilder((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.slice(-3).map((t) => {
        const s = STYLE[t.tone]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-[0_4px_16px_rgba(17,24,39,0.10)] ${s.box}`}
          >
            <span className={`mt-px shrink-0 ${s.ink}`}>{s.icon}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-meta font-semibold ${s.ink}`}>{t.title}</p>
              {t.body && <p className="mt-0.5 text-[11.5px] leading-4 text-ink-body">{t.body}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Tutup pemberitahuan"
              className={`shrink-0 rounded p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 ${s.ink}`}
            >
              <IconClose className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
