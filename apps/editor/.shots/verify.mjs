import { chromium } from 'playwright'
const b = await chromium.launch()
const errs = []

for (const [w, h, tag] of [[1440,900,'wide'],[1280,800,'narrow'],[1024,768,'small']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  p.on('pageerror', e => errs.push(`${tag} PAGEERROR: ` + e.message))
  p.on('console', m => { if (m.type() === 'error') errs.push(`${tag}: ` + m.text()) })
  await p.goto('http://localhost:5180/', { waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  // overflow detection
  const over = await p.evaluate(() => {
    const bad = []
    document.querySelectorAll('*').forEach(el => {
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'auto' && getComputedStyle(el).overflowX !== 'scroll') {
        const t = (el.textContent||'').trim().slice(0,40)
        if (t) bad.push(el.tagName + '.' + (el.className||'').toString().slice(0,50) + ' :: ' + t)
      }
    })
    return bad.slice(0,6)
  })
  console.log(`${tag} (${w}px) overflow:`, over.length ? over.join(' | ') : 'none')
  await p.screenshot({ path: `.shots/${tag}.png` })
  await p.close()
}
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none')
await b.close()
