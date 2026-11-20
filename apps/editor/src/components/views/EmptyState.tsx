import { useState } from 'react'
import { useBuilder } from '../../store/useBuilder'
import { ActionButton } from '../ui/Button'
import { IconLayers, IconWand } from '../ui/Icons'

/**
 * Shown when the server holds zero projects.
 *
 * This exists because "no projects yet" is a normal first state, not an error — and before it
 * existed the editor crashed instead, reading `.status` off an undefined project. The whole
 * shell (rail, top bar, preview) needs a project to render, so the empty case replaces the
 * shell rather than sitting inside it.
 *
 * The prompt box here is the one place a first project can be created without a project to
 * revise, so it goes straight to `runGeneration`.
 */
export function EmptyState() {
  const loading = useBuilder((s) => s.loading)
  const loadError = useBuilder((s) => s.loadError)
  const runGeneration = useBuilder((s) => s.runGeneration)
  const generation = useBuilder((s) => s.generation)
  const [prompt, setPrompt] = useState('')

  const generating = generation.state === 'running'
  const canGenerate = prompt.trim().length > 0 && !generating

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-ground p-6">
      <div className="w-full max-w-lg">
        <div className="mb-1 flex items-center gap-2 text-ink-meta">
          <IconLayers />
          <span className="font-mono text-meta uppercase tracking-wide">Belum ada proyek</span>
        </div>

        <h2 className="text-title font-semibold tracking-[-0.015em]">
          {loading ? 'Memuat proyek…' : 'Jelaskan aplikasi yang ingin dibuat'}
        </h2>

        <p className="mt-1.5 text-body text-ink-meta">
          {loadError
            ? `Daftar proyek gagal dimuat: ${loadError}`
            : 'Deskripsi Anda menjadi skema database dan layar yang bisa langsung disunting.'}
        </p>

        <label htmlFor="empty-prompt" className="mt-5 block text-meta font-medium text-ink-meta">
          Deskripsi aplikasi
        </label>
        <textarea
          id="empty-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={generating}
          rows={3}
          placeholder="sistem kasir untuk klinik kecil"
          className="mt-1.5 w-full resize-none rounded-md border border-rule-strong bg-ground px-3 py-2.5 text-body outline-none focus-visible:border-action focus-visible:ring-2 focus-visible:ring-action/20 disabled:opacity-60"
        />

        <div className="mt-3 flex items-center gap-3">
          <ActionButton
            onClick={() => void runGeneration(prompt)}
            disabled={!canGenerate}
            variant="primary"
          >
            <IconWand />
            {generating ? 'Membuat…' : 'Buat aplikasi'}
          </ActionButton>
          {generating && generation.message && (
            <span className="text-meta text-ink-meta">{generation.message}</span>
          )}
        </div>
      </div>
    </div>
  )
}
