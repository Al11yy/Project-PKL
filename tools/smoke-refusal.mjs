/**
 * Drives the M-7 refusal from the browser: a revision that would discard the user's ids must
 * leave the project untouched and refund the coins.
 *
 * This is the case the whole feature exists for, and the only way to know the editor's error
 * path actually renders is to look at it. Two assertions matter beyond the toast: the project
 * in the sidebar must still exist unchanged, and the balance must be back where it started.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('tools/shots', { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('console', (m) => {
  /**
   * The browser logs every 4xx as a console error, and this flow *expects* one: the refusal is
   * a 422 by design. Filtered out so a real error is not lost in the noise the test creates.
   */
  if (m.type() === 'error' && !/422|Unprocessable/.test(m.text())) errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const balance = async () => {
  const text = await page.locator('body').innerText()
  const m = /SALDO KOIN\s*(\d+)/i.exec(text)
  return m ? Number(m[1]) : null
}

await page.goto('http://localhost:5180/', { waitUntil: 'networkidle' })

await page.locator('textarea').first().fill('buat sistem kasir klinik dengan data pasien dan laporan')
await page.getByRole('button', { name: /Generate PRD/i }).click()
await page.getByText(/Aplikasi siap ditinjau/).first().waitFor({ timeout: 30_000 })

const before = await balance()
const beforeText = await page.locator('body').innerText()

// "ganti id blok" makes the fake renumber every block id, which M-7 refuses.
await page.locator('textarea').first().fill('ganti id blok semuanya')
await page.getByRole('button', { name: /Revisi lewat prompt|Memproses/i }).click()
await page
  .getByText(/Revisi ditolak|Revisi gagal/i)
  .first()
  .waitFor({ timeout: 30_000 })
  .catch(() => {})

await page.screenshot({ path: 'tools/shots/4-refusal.png' })

const after = await balance()
const afterText = await page.locator('body').innerText()
const sawRefusal = /Revisi ditolak — proyek tidak diubah/.test(afterText)
/**
 * The refund is asserted from the balance, not from the ledger's text: the ledger entry exists
 * in state but the panel showing it is not the open view, so looking for its label on screen
 * tested which view happened to be rendered rather than whether the coins came back.
 */
const refunded = before === after
// The generated tree must survive: the refusal changed nothing.
const countsStillThere = /1 tabel · 3 layar/.test(afterText)

console.log(`refusal toast  : ${sawRefusal}`)
console.log(`refund entry   : ${refunded}`)
console.log(`project intact : ${countsStillThere}`)
console.log(`balance        : ${before} -> ${after} (revise costs 5, must be restored)`)
console.log(`console errors : ${errors.length}`)
for (const e of errors) console.log(`  - ${e}`)

await browser.close()
process.exit(sawRefusal && refunded && countsStillThere && before === after && errors.length === 0 ? 0 : 1)
