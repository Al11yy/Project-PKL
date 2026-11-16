import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto('http://localhost:5180/', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

// 1. Free inspector path
await p.getByRole('button', { name: /Edit visual/ }).click()
await p.waitForTimeout(400)
await p.screenshot({ path: '.shots/inspector-empty.png' })
const blocks = p.locator('.outline-dashed')
const n = await blocks.count()
if (n > 0) await blocks.nth(1).click()
await p.waitForTimeout(500)
await p.screenshot({ path: '.shots/inspector-selected.png' })

// 2. Failure + refund path
await p.getByLabel('Tutup editor visual').click()
const ta = p.locator('#prompt')
await ta.fill('toko')
await p.getByRole('button', { name: /Generate PRD/ }).click()
await p.waitForTimeout(900)
await p.screenshot({ path: '.shots/failed.png' })
const bal = await p.locator('.tnum.font-mono.text-figure').first().innerText()

// 3. Ledger shows the refund rows
await p.getByRole('button', { name: /Riwayat koin/ }).first().click()
await p.waitForTimeout(600)
await p.screenshot({ path: '.shots/ledger.png' })

// 4. Schema view
await p.getByRole('button', { name: 'Skema', exact: true }).click()
await p.waitForTimeout(500)
await p.screenshot({ path: '.shots/schema.png' })

console.log('BALANCE_AFTER_REFUND:', bal)
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none')
await b.close()
