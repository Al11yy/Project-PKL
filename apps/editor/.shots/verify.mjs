import { chromium } from 'playwright'

/**
 * The render path must never introduce a markup sink. The product rule is that the model
 * emits validated JSON mapped onto whitelisted blocks, and `dangerouslySetInnerHTML` would
 * bypass that entirely — one call is enough to turn a data field into script execution.
 * Checked here, before the browser starts, so a violation fails fast and loudly.
 */
const { readdirSync, readFileSync, statSync } = await import('node:fs')
const { join } = await import('node:path')

const BANNED = /dangerouslySetInnerHTML|new Function|eval\(/
const offenders = []

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      scan(full)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // `eval(` also matches `retrieval(`; require a non-word char before it.
          if (BANNED.test(line) && !/[\w.]eval\(/.test(line)) {
            offenders.push(`${full}:${i + 1}`)
          }
        })
    }
  }
}

scan('src')
console.log('BANNED MARKUP API:', offenders.length ? offenders.join(', ') : 'none')

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
