import { Inspector } from './components/inspector/Inspector'
import { Preview } from './components/preview/Preview'
import { Pipeline } from './components/shell/Pipeline'
import { PromptRow } from './components/shell/PromptRow'
import { Rail } from './components/shell/Rail'
import { TopBar } from './components/shell/TopBar'
import { Toasts } from './components/ui/Toasts'
import { LedgerView } from './components/views/LedgerView'
import { SchemaView } from './components/views/SchemaView'
import { useBuilder } from './store/useBuilder'

export default function App() {
  const view = useBuilder((s) => s.view)

  return (
    <div className="flex h-full overflow-hidden bg-ground">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {view === 'builder' && <Pipeline />}
        {view === 'builder' && <PromptRow />}
        {view === 'builder' && <Preview />}
        {view === 'schema' && <SchemaView />}
        {view === 'ledger' && <LedgerView />}
      </div>
      <Inspector />
      <Toasts />
    </div>
  )
}
