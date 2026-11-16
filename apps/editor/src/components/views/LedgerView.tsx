import { useBuilder } from '../../store/useBuilder'
import { ActionButton } from '../ui/Button'
import { IconCoins } from '../ui/Icons'

const TONE = {
  spent: 'text-ink',
  free: 'text-ok-ink',
  refunded: 'text-warn-ink',
  failed: 'text-danger-ink',
} as const

const LABEL = {
  spent: 'terpakai',
  free: 'gratis',
  refunded: 'dikembalikan',
  failed: 'gagal',
} as const

/**
 * Every coin that leaves the balance has a row here, and so does every refund.
 * A user who doubts the charge can reconcile it without asking support.
 */
export function LedgerView() {
  const ledger = useBuilder((s) => s.ledger)
  const balance = useBuilder((s) => s.balance())
  const topUp = useBuilder((s) => s.topUp)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-title font-semibold">Riwayat koin</h2>
          <p className="mt-1 text-meta text-ink-meta">
            Saldo dihitung dari baris-baris ini, bukan angka terpisah yang bisa melenceng.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-meta">
            Saldo kini
          </div>
          <div className="tnum font-mono text-[28px] font-bold tracking-[-0.02em]">{balance}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-rule">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-ground-sunken">
              {['Waktu', 'Tindakan', 'Rujukan', 'Koin'].map((h, i) => (
                <th
                  key={h}
                  className={`px-3.5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-meta ${
                    i === 3 ? 'text-right' : ''
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr key={e.id} className="border-t border-rule-soft">
                <td className="tnum px-3.5 py-2 font-mono text-[11.5px] text-ink-meta">{e.at}</td>
                <td className="px-3.5 py-2">
                  <span className="text-meta font-medium text-ink">{e.label}</span>
                  <span className="block text-[11.5px] text-ink-meta">{e.detail}</span>
                </td>
                <td className="px-3.5 py-2 font-mono text-[11.5px] text-ink-meta">{e.refId}</td>
                <td className={`tnum px-3.5 py-2 text-right font-mono text-meta font-semibold ${TONE[e.outcome]}`}>
                  {e.coins > 0 ? `+${e.coins}` : e.coins === 0 ? '0' : e.coins}
                  <span className="ml-1 text-[11px] font-normal text-ink-meta">
                    {LABEL[e.outcome]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg border border-rule bg-ground-panel px-4 py-3">
        <p className="max-w-[52ch] text-meta leading-5 text-ink-meta">
          Isi saldo memakai Midtrans (QRIS / Virtual Account). Koin masuk hanya setelah webhook
          pembayaran terverifikasi, bukan setelah halaman redirect.
        </p>
        <ActionButton
          variant="secondary"
          size="sm"
          icon={<IconCoins className="h-3.5 w-3.5" />}
          onClick={() => topUp(100)}
        >
          Isi 100 koin
        </ActionButton>
      </div>
    </div>
  )
}
