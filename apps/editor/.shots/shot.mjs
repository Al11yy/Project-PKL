import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errs = []
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
await p.goto('http://localhost:5180/', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.screenshot({ path: '.shots/builder.png' })
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none')
await b.close()
