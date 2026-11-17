/**
 * Starts the three processes the browser needs, in the right order, so trying the product does
 * not require three terminals and a remembered set of environment variables.
 *
 *   1. tools/fake-llm.mjs   — stands in for LLM-Kita on :5197
 *   2. @rakit/orchestrator  — the real API on :5181, pointed at the fake
 *   3. @rakit/editor        — Vite on :5180, proxying /api to the orchestrator
 *
 * If `LLM_KITA_API_KEY` is already set in the environment it is left alone, so the same command
 * runs against the real provider when a key is present. The fake is a fallback for a machine
 * that has no key, not a replacement for testing against the model.
 *
 * Ctrl-C stops all three. Output is prefixed so it is clear which process is talking.
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const usingFake = !process.env.LLM_KITA_API_KEY

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
  usingFake
    ? {
        LLM_KITA_API_KEY: 'fake',
        LLM_KITA_BASE_URL: 'http://localhost:5197/v1',
        LLM_KITA_MODEL: 'fake-model',
      }
    : {},
  true,
)

// The editor is last: its proxy targets the orchestrator, and starting it first only means the
// first requests fail while the server is still booting.
await sleep(6000)
start('editor', '32', 'npm', ['run', 'dev', '-w', '@rakit/editor'], {}, true)

await sleep(5000)
console.log('\n\x1b[32mEditor:\x1b[0m      http://localhost:5180/')
console.log('\x1b[32mOrchestrator:\x1b[0m http://localhost:5181/api/v1/health')
console.log('\nPress Ctrl-C to stop.\n')

const shutdown = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
