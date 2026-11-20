/**
 * Starts the three processes the browser needs, in the right order, so trying the product does
 * not require three terminals and a remembered set of environment variables.
 *
 *   1. tools/fake-llm.mjs   — stands in for LLM-Kita on :5197
 *   2. @rakit/orchestrator  — the real API on :5181, pointed at the fake
 *   3. @rakit/editor        — Vite on :5180, proxying /api to the orchestrator
 *
 * If `LLM_KITA_API_KEY` is already set — in the environment *or* in the root `.env`, which is
 * where `.env.example` tells you to put it — it is left alone, so the same command runs against
 * the real provider when a key is present. The fake is a fallback for a machine that has no key,
 * not a replacement for testing against the model.
 *
 * Ctrl-C stops all three. Output is prefixed so it is clear which process is talking.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Read the root `.env`, if there is one.
 *
 * This process starts `server.ts`, a plain Node server that reads `process.env` — it does not
 * read `.dev.vars`, which only `wrangler dev` understands. Without this, a token placed in
 * `.dev.vars` would silently not reach the orchestrator that `npm run dev:all` actually runs,
 * and every request would fail with 401 while the file looked correct.
 *
 * Parsed here rather than with `dotenv` to keep the dev tooling dependency-free. Only the
 * subset this harness needs is supported: `KEY=value`, optional quotes, `#` comments.
 */
function readRootEnv() {
  const values = {}
  let text
  try {
    text = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  } catch {
    return values
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at === -1) continue
    const key = trimmed.slice(0, at).trim()
    let value = trimmed.slice(at + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

const rootEnv = readRootEnv()

/**
 * Values the browser half and the server half must agree on.
 *
 * `RAKIT_SHARED_TOKEN` is what the orchestrator checks; `VITE_RAKIT_TOKEN` is what the editor
 * sends. Two names for one value is deliberate — the `VITE_` prefix is what makes Vite expose
 * it to client code at all, and reusing one name would either leak the server variable into the
 * bundle or fail to expose it. They are wired together here so they cannot drift.
 */
const sharedToken = process.env.RAKIT_SHARED_TOKEN ?? rootEnv.RAKIT_SHARED_TOKEN ?? ''
const generateEnabled =
  process.env.FEATURE_GENERATE_ENABLED ?? rootEnv.FEATURE_GENERATE_ENABLED ?? ''

/**
 * Generation is OFF unless the root `.env` says otherwise.
 *
 * This harness runs on localhost, so the flag is not protecting anyone here — but defaulting it
 * on would mean the local setup never exercises the same configuration as the deployed Worker,
 * and a bug in the off-path would first appear in production.
 */
const featureFlag = generateEnabled === 'true' ? 'true' : 'false'

/**
 * The key comes from either place, so both are checked.
 *
 * Reading only `process.env` here used to mean that filling `LLM_KITA_API_KEY` in the root
 * `.env` — which is exactly what `.env.example` tells you to do — still selected the fake
 * provider, and then overwrote the real key with `fake` on the way in. The harness looked
 * configured, ran, and quietly never called the model.
 */
const llmApiKey = process.env.LLM_KITA_API_KEY ?? rootEnv.LLM_KITA_API_KEY ?? ''

const usingFake = llmApiKey === ''

const children = []

/**
 * `useShell` is set only for `npm`, which on Windows is a `.cmd` shim that needs a shell to
 * run. Node itself is spawned directly: with a shell, `process.execPath` — `C:\Program
 * Files\nodejs\node.exe` — is split at the space and the child dies with "'C:\Program' is not
 * recognized", which is silent apart from a missing process.
 */
function start(name, color, command, args, env = {}, useShell = false) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
  })
  children.push(child)

  const prefix = `\x1b[${color}m[${name}]\x1b[0m`
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim() !== '') console.log(`${prefix} ${line}`)
    })
  }
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.log(`${prefix} exited with code ${code}`)
  })
  return child
}

if (usingFake) {
  console.log('\x1b[33mNo LLM_KITA_API_KEY set — using tools/fake-llm.mjs as the provider.\x1b[0m')
  console.log('\x1b[33mSet the key to run against the real model instead.\x1b[0m\n')
  start('fake-llm', '35', process.execPath, ['tools/fake-llm.mjs'])
  await sleep(1200)
}

start(
  'orchestrator',
  '36',
  'npm',
  ['run', 'dev', '-w', '@rakit/orchestrator'],
  {
    ...(usingFake
      ? {
          LLM_KITA_API_KEY: 'fake',
          LLM_KITA_BASE_URL: 'http://localhost:5197/v1',
          LLM_KITA_MODEL: 'fake-model',
        }
      : { LLM_KITA_API_KEY: llmApiKey }),
    // Passed through `process.env` because `npm run dev` starts `server.ts`, a plain Node
    // process that never reads `.dev.vars` — that file belongs to `wrangler dev` alone.
    RAKIT_SHARED_TOKEN: sharedToken,
    FEATURE_GENERATE_ENABLED: featureFlag,
  },
  true,
)

// The editor is last: its proxy targets the orchestrator, and starting it first only means the
// first requests fail while the server is still booting.
await sleep(6000)
start(
  'editor',
  '32',
  'npm',
  ['run', 'dev', '-w', '@rakit/editor'],
  // The same token under the `VITE_` name, which is the only way Vite exposes a value to
  // browser code. Both sides come from one source, so they cannot drift apart.
  { VITE_RAKIT_TOKEN: sharedToken },
  true,
)

await sleep(5000)
console.log('\n\x1b[32mEditor:\x1b[0m      http://localhost:5180/')
console.log('\x1b[32mOrchestrator:\x1b[0m http://localhost:5181/api/v1/health')
console.log(
  `\x1b[36mGenerate:\x1b[0m    ${
    featureFlag === 'true'
      ? 'ON'
      : 'OFF — set FEATURE_GENERATE_ENABLED=true in .env to enable'
  }`,
)
console.log(
  `\x1b[36mToken:\x1b[0m       ${
    sharedToken === '' ? 'not set — the localStorage API requires none' : 'configured'
  }`,
)
console.log('\nPress Ctrl-C to stop.\n')

const shutdown = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
