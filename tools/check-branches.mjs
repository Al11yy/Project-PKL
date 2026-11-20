/**
 * Drives every branch the browser can reach and prints one line per case.
 *
 * Restarts the fake provider before each case, because the fake carries state: a case that
 * deletes a screen changes what the next case starts from, which silently turned a passing
 * "unchanged revision" into a false failure when this was run by hand.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const EDITOR = 'http://localhost:5180'

/**
 * The shared token, read the same way `dev-all` reads it.
 *
 * The editor sends `X-Rakit-Token` on every request, and the orchestrator rejects requests
 * without it whenever one is configured. This script talked to the editor directly and sent no
 * header, so every case returned 401 and the failure looked like a broken revision check rather
 * than a missing token.
 *
 * Kept a best-effort read rather than a hard requirement: with no token configured the API is
 * open on localhost and an empty header is simply ignored.
 */
function readToken() {
  if (process.env.RAKIT_SHARED_TOKEN !== undefined) return process.env.RAKIT_SHARED_TOKEN
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('RAKIT_SHARED_TOKEN=')) continue
      return trimmed.slice('RAKIT_SHARED_TOKEN='.length).replace(/^["']|["']$/g, '').trim()
    }
  } catch {
    // No `.env` — the API is open locally, or the operator set the variable directly.
  }
  return ''
}

const TOKEN = readToken()
const headers = {
  'Content-Type': 'application/json',
  ...(TOKEN === '' ? {} : { 'X-Rakit-Token': TOKEN }),
}

const CASES = [
  ['hilangkan layar', 422, 'REVISION_DROPPED_DATA'],
  ['jangan hapus layar s-laporan', 422, 'REVISION_DROPPED_DATA'],
  ['hapus kolom alergi dari tabel', 422, 'REVISION_DROPPED_DATA'],
  ['ganti id blok semuanya', 422, 'REVISION_DROPPED_DATA'],
  ['hapus layar s-laporan', 200, null],
  ['ubah judul jadi Klinik Sehat', 200, null],
]

async function restartFake() {
  const kill = spawn('sh', ['-c',
    "netstat -ano | grep ':5197.*LISTENING' | head -1 | awk '{print $5}' | xargs -r -I{} taskkill //F //PID {} >/dev/null 2>&1"])
  await new Promise((r) => kill.on('exit', r))
  await sleep(700)
  const child = spawn(process.execPath, ['tools/fake-llm.mjs'], { stdio: 'ignore', detached: true })
  child.unref()
  await sleep(1200)
}

async function generate() {
  const res = await fetch(`${EDITOR}/api/v1/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: 'buat sistem kasir klinik dengan data pasien dan laporan' }),
  })
  const body = await res.json()
  return body.data.project
}

let failures = 0
for (const [instruction, wantStatus, wantCode] of CASES) {
  await restartFake()
  const project = await generate()
  const res = await fetch(`${EDITOR}/api/v1/revise`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ project, instruction }),
  })
  const body = await res.json()
  const code = body.error?.code ?? null
  const screens = body.data?.project?.screens?.length ?? null
  const ok = res.status === wantStatus && code === wantCode
  if (!ok) failures += 1
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${instruction.padEnd(32)} ${res.status} ${String(code).padEnd(24)} layar=${screens}`,
  )
}

console.log(failures === 0 ? '\nall branches behave as intended' : `\n${failures} case(s) wrong`)
process.exit(failures === 0 ? 0 : 1)
