import { useState } from 'react'
import { COIN_COST } from '../../lib/types'
import { useBuilder } from '../../store/useBuilder'
import { ActionButton } from '../ui/Button'
import { IconSliders, IconWand } from '../ui/Icons'

export function PromptRow() {
  const project = useBuilder((s) => s.activeProject())
  const generation = useBuilder((s) => s.generation)
  const revision = useBuilder((s) => s.revision)
  const runGeneration = useBuilder((s) => s.runGeneration)
  const runRevision = useBuilder((s) => s.runRevision)
  const toggleInspect = useBuilder((s) => s.toggleInspect)
  const balance = useBuilder((s) => s.balance())
  const [text, setText] = useState('')

  const busy = generation.state === 'running' || revision.state === 'running'
  const canRevise = balance >= COIN_COST.revise
  const canAfford = balance >= COIN_COST.generate

  return (
    <section className="shrink-0 border-b border-rule bg-ground px-5 py-3.5" aria-label="Prompt">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <label htmlFor="prompt" className="sr-only">
            Deskripsikan aplikasi atau perubahan
          </label>
          <textarea
            id="prompt"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder={project.prompt}
            className="w-full resize-none rounded-md border border-rule-strong bg-ground px-3 py-2.5 text-body leading-5 text-ink-body placeholder:text-ink-meta focus:border-action focus:outline-none disabled:bg-ground-sunken disabled:text-ink-meta"
          />
        </div>
        <div className="mt-0.5 flex shrink-0 flex-col gap-1.5">
          {/* Two prompts, two prices, side by side: a full rebuild and a
              targeted revision are different purchases and must not share a
              button. */}
          <ActionButton
            variant="primary"
            // `void`: the action handles its own failures and reports them as toasts, so
            // there is no rejection left to await. Marked explicitly rather than left as a
            // floating promise, which would read as a forgotten await.
            onClick={() => void runGeneration(text || project.prompt)}
            disabled={busy || !canAfford}
            cost={COIN_COST.generate}
            icon={<IconWand className="h-3.5 w-3.5" />}
            title={
              canAfford
                ? `Generate PRD & UI · −${COIN_COST.generate} koin`
                : `Butuh ${COIN_COST.generate} koin, saldo Anda ${balance}`
            }
          >
            {generation.state === 'running' ? 'Memproses…' : 'Generate PRD & UI'}
          </ActionButton>
          <ActionButton
            variant="secondary"
            onClick={() => void runRevision(text)}
            disabled={busy || !text.trim() || !canRevise}
            cost={COIN_COST.revise}
            title={
              !text.trim()
                ? 'Tulis dulu perubahan yang diinginkan di kolom prompt'
                : canRevise
                  ? `Revisi terarah · −${COIN_COST.revise} koin`
                  : `Butuh ${COIN_COST.revise} koin, saldo Anda ${balance}`
            }
          >
            {revision.state === 'running' ? 'Menerapkan…' : 'Revisi lewat prompt'}
          </ActionButton>
        </div>
      </div>

      <p className="mt-2 text-meta leading-5 text-ink-meta">
        Mengubah teks, warna, dan susunan langsung di pratinjau{' '}
        <button
          onClick={() => toggleInspect(true)}
          className="press inline-flex items-center gap-1 font-medium text-ok-ink underline decoration-ok-ink/40 underline-offset-2 hover:decoration-ok-ink"
        >
          <IconSliders className="h-3 w-3" />
          gratis 0 koin
        </button>
        . Prompt di atas untuk membuat ulang PRD &amp; UI ({COIN_COST.generate} koin) atau revisi
        terarah ({COIN_COST.revise} koin).
      </p>
    </section>
  )
}
