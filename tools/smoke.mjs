/**
 * Opens the editor in a real browser and drives a generate, so "it works in the browser" is
 * something observed rather than inferred from curl.
 *
 * Saves screenshots to tools/shots/ — one per state — because a page can render a blank
 * panel without throwing, and console errors alone would not show that.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('tools/shots', { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:5180/', { waitUntil: 'networkidle' })
await page.screenshot({ path: 'tools/shots/1-initial.png' })

// The prompt box is the only textarea on the shell; fill it with something long enough to
// pass the editor's 12-character minimum.
const prompt = page.locator('textarea').first()
await prompt.fill('buat sistem kasir klinik dengan data pasien dan laporan')
await page.screenshot({ path: 'tools/shots/2-prompt.png' })

const generate = page.getByRole('button', { name: /Generate PRD/i })
await generate.click()

// Wait for the result rather than a fixed delay: the call is real and its duration is the
// server's to decide.
await page
  .getByText(/Aplikasi siap ditinjau|Generate gagal/i)
  .first()
  .waitFor({ timeout: 30_000 })
  .catch(() => {})

await page.screenshot({ path: 'tools/shots/3-after-generate.png' })

const bodyText = await page.locator('body').innerText()
const sawSuccess = /Aplikasi siap ditinjau/.test(bodyText)

/**
 * Read the counts the header reports, which come from the server's answer. Asserting on a
 * screen *name* was wrong: the preview renders only the first screen, so "Laporan" is not on
 * the page even when the server sent it. The counts are the signal that the whole tree landed.
 */
const summary = /(\d+) tabel · (\d+) layar/.exec(bodyText)
const tables = summary ? Number(summary[1]) : null
const screens = summary ? Number(summary[2]) : null

// The project the fake returns: one table, three screens.
const countsOk = tables === 1 && screens === 3
const sidebarOk = /Klinik Sehat/.test(bodyText)

console.log(`success toast : ${sawSuccess}`)
console.log(`header counts : ${tables} tabel · ${screens} layar`)
console.log(`sidebar entry : ${sidebarOk}`)
console.log(`console errors: ${errors.length}`)
for (const e of errors) console.log(`  - ${e}`)

await browser.close()
process.exit(sawSuccess && countsOk && sidebarOk && errors.length === 0 ? 0 : 1)
