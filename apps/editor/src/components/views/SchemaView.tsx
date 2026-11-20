import { useBuilder } from '../../store/useBuilder'
import { IconTable } from '../ui/Icons'

export function SchemaView() {
  const project = useBuilder((s) => s.activeProject())

  // A schema belongs to a project; with none there is nothing to describe. `App` shows the
  // empty state in that case rather than this view.
  if (project === undefined) return null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-title font-semibold">Skema — {project.name}</h2>
          <p className="mt-1 text-meta text-ink-meta">
            Disimpan terpisah dari UI, di database D1 milik proyek ini saja.
          </p>
        </div>
        <span className="tnum font-mono text-meta text-ink-meta">
          {project.tables.length} tabel detail · {project.tablesCount} total
        </span>
      </div>

      {project.tables.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule-strong px-6 py-10 text-center">
          <IconTable className="mx-auto h-5 w-5 text-ink-meta" />
          <p className="mt-2 text-body font-medium text-ink">Skema belum dirinci</p>
          <p className="mx-auto mt-1 max-w-[42ch] text-meta leading-5 text-ink-meta">
            Jalankan generate ulang pada proyek ini untuk melihat kolom per tabel.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {project.tables.map((t) => (
            <section key={t.name} className="overflow-hidden rounded-lg border border-rule">
              <header className="flex items-baseline justify-between border-b border-rule bg-ground-sunken px-3.5 py-2">
                <span className="font-mono text-meta font-semibold text-ink">{t.name}</span>
                <span className="tnum font-mono text-[11.5px] text-ink-meta">
                  {t.rows} baris · {t.columns.length} kolom
                </span>
              </header>
              <table className="w-full border-collapse text-left">
                <tbody>
                  {t.columns.map((c) => (
                    <tr key={c.name} className="border-t border-rule-soft first:border-t-0">
                      <td className="w-1/2 px-3.5 py-1.5 font-mono text-meta text-ink-body">
                        {c.name}
                        {c.primary && (
                          <span className="ml-1.5 rounded bg-ground-sunken px-1 py-px text-[10.5px] font-semibold uppercase tracking-wide text-ink-meta">
                            pk
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-1.5 font-mono text-[11.5px] text-ink-meta">
                        {c.type}
                        {c.nullable && <span className="ml-1">null</span>}
                        {c.note && <span className="ml-1.5 text-ink-body">· {c.note}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
