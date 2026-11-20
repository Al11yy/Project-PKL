import { useEffect, useRef, useState } from 'react'
import { useBuilder } from '../../store/useBuilder'
import { ActionButton, IconButton } from '../ui/Button'
import { IconArrowUpRight, IconExternal, IconRocket, IconSliders, IconTable } from '../ui/Icons'

export function TopBar() {
  const project = useBuilder((s) => s.activeProject())
  const publish = useBuilder((s) => s.publish)
  const runPublish = useBuilder((s) => s.runPublish)
  const inspectOpen = useBuilder((s) => s.inspectOpen)
  const toggleInspect = useBuilder((s) => s.toggleInspect)
  const setView = useBuilder((s) => s.setView)
  const renameProject = useBuilder((s) => s.renameProject)

  const [draft, setDraft] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const editing = draft !== null

  /**
   * Select the whole name once, when the editor opens, so the first keystroke replaces it.
   * Renaming almost always means retyping, and leaving the caret at the end would make the
   * common case an extra step.
   *
   * The dependency is `editing`, not `draft`. Depending on the text meant this ran on every
   * keystroke: each new character re-selected the whole field, so the next character replaced
   * it and the name could never grow past one letter. The selection belongs to the *opening*
   * of the editor, which is what `editing` tracks — the text is not an input to it at all.
   */
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  /**
   * Abandoning the edit restores the stored name. Called on Escape and on blur, the latter
   * because a click elsewhere reads as "I am done here" — and closing without saving is better
   * than a half-typed name silently saving when the user meant to cancel.
   */
  const cancel = () => {
    if (savingName) return
    setDraft(null)
  }

  const commit = async () => {
    if (draft === null || savingName) return
    const next = draft.trim()

    // Rejected before the round trip: an empty name has nothing to save and would leave the
    // project unnameable in the rail.
    if (next === '') {
      setDraft(null)
      return
    }
    // Unchanged: close quietly rather than claim a change that did not happen.
    if (next === project?.name) {
      setDraft(null)
      return
    }

    setSavingName(true)
    const ok = await renameProject(next)
    setSavingName(false)
    // `false` means the store already reverted the name and raised a toast; closing the editor
    // would hide that, so it stays open with the user's text for a retry.
    if (ok) setDraft(null)
  }

  // The top bar names the active project and its counts, so it has nothing to show without
  // one. `App` renders the empty state instead in that case.
  if (project === undefined) return null

  const publishing = publish.state === 'running'
  const live = project.status === 'live'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule bg-ground px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        {/* The title keeps its room and truncates only as a last resort; the
            meta yields first, since it is context rather than an action. */}
        {draft === null ? (
          /**
           * A button, not a heading with a click handler: the title is now an action, so it
           * must be reachable by keyboard and announced as something that does something.
           * It keeps the heading's type so the bar still reads as a title.
           */
          <h1 className="max-w-[22rem] truncate text-[17px] font-semibold tracking-[-0.015em]">
            <button
              onClick={() => setDraft(project.name)}
              title="Klik untuk mengganti nama"
              aria-label={`Ganti nama proyek: ${project.name}`}
              className="press max-w-full truncate rounded px-1 -mx-1 text-left hover:bg-ground-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/30"
            >
              {project.name}
            </button>
          </h1>
        ) : (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commit()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
            disabled={savingName}
            aria-label="Nama proyek"
            maxLength={80}
            className="w-[22rem] max-w-full rounded border border-action bg-ground px-1 -mx-1 text-[17px] font-semibold tracking-[-0.015em] outline-none ring-2 ring-action/20 disabled:opacity-60"
          />
        )}
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
              onClick={() => void runPublish()}
              disabled={publishing}
              title="Terbitkan ulang versi terbaru"
            >
              {publishing ? 'Menerbitkan…' : 'Terbitkan ulang'}
            </ActionButton>
          </>
        ) : (
          <ActionButton
            variant="primary"
            size="sm"
            icon={<IconRocket className="h-3.5 w-3.5" />}
            onClick={() => void runPublish()}
            disabled={publishing}
            title="Terbitkan ke Cloudflare"
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
