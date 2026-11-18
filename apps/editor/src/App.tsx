import { useEffect } from 'react'
import { Inspector } from './components/inspector/Inspector'
import { Preview } from './components/preview/Preview'
import { Pipeline } from './components/shell/Pipeline'
import { PromptRow } from './components/shell/PromptRow'
import { Rail } from './components/shell/Rail'
import { TopBar } from './components/shell/TopBar'
import { Toasts } from './components/ui/Toasts'
import { SchemaView } from './components/views/SchemaView'
import { useBuilder } from './store/useBuilder'

export default function App() {
  const view = useBuilder((s) => s.view)
  const loadProjects = useBuilder((s) => s.loadProjects)

  /**
   * Load the server's projects once, on mount.
   *
   * This is what makes the editor survive a reload. Until it answers, the rail shows the seed
   * data, so the first paint is never an empty rail; if it fails, the seed stays and
   * `loadError` says why in the rail.
   *
   * No dependency array entry for `loadProjects`: Zustand actions are stable across renders,
   * and including it would be noise that implies otherwise.
   */
  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  return (
    <div className="flex h-full overflow-hidden bg-ground">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {view === 'builder' && <Pipeline />}
        {view === 'builder' && <PromptRow />}
        {view === 'builder' && <Preview />}
        {view === 'schema' && <SchemaView />}
      </div>
      <Inspector />
      <Toasts />
    </div>
  )
}
