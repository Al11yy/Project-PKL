import { describe, expect, it } from 'vitest'
import { createNodeHandler } from './node-handler'
import { fakeD1 } from './testing/fake-d1'
import { clientProject } from './testing/fixtures'
import type { Env } from './config'

/**
 * Guards the Node dev path's binding wiring.
 *
 * The bug this file exists for: `server.ts` used to call `serve({ fetch: app.fetch })`, so Hono
 * received no `env` and `c.env` was `undefined` on every request. Every check reading `env`
 * then did nothing — the token gate most importantly — and the whole suite stayed green because
 * the tests pass `env` themselves. Only a live `curl` against a real server revealed it.
 *
 * These tests go through `createNodeHandler` rather than `createApp` for exactly that reason:
 * they exercise the same wiring the dev server uses, so removing the `env` closure fails here.
 */

const TOKEN = 'token-node-handler-0123456789abcdef'

const ENV: Env = {
  LLM_KITA_API_KEY: 'test-key',
  LLM_KITA_BASE_URL: 'https://api.example.test/api/v1',
  LLM_KITA_MODEL: 'auto',
  RAKIT_SHARED_TOKEN: TOKEN,
  FEATURE_GENERATE_ENABLED: 'true',
}

const handlerFor = (env: Env = ENV) => createNodeHandler(env)

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers })

describe('createNodeHandler', () => {
  it('enforces the token, proving env reaches the app', async () => {
    /**
     * The regression test. If the handler drops `env`, `sharedToken` sees `undefined`, the gate
     * opens, and this returns 503 (no D1 binding) instead of 401.
     */
    const response = await handlerFor()(get('/api/v1/projects'))

    expect(response.status).toBe(401)
  })

  it('allows a request carrying the token through the gate', async () => {
    const response = await handlerFor()(
      get('/api/v1/projects', { 'X-Rakit-Token': TOKEN }),
    )

    // 503 is the database binding being absent in this env — past the gate, which is the point.
    expect(response.status).not.toBe(401)
  })

  it('enforces the generate flag, proving env reaches the app', async () => {
    const handler = createNodeHandler({ ...ENV, FEATURE_GENERATE_ENABLED: 'false' })
    const response = await handler(
      new Request('http://localhost/api/v1/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Rakit-Token': TOKEN },
        body: JSON.stringify({ prompt: 'sistem kasir untuk warung kopi' }),
      }),
    )

    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FEATURE_DISABLED')
  })

  it('leaves /health open when a token is configured', async () => {
    const response = await handlerFor()(get('/api/v1/health'))

    expect(response.status).toBe(200)
  })

  it('fails at construction when the LLM config is unusable', () => {
    // The dev server should refuse to start rather than serve an API that 500s on every call.
    expect(() => createNodeHandler({} as Env)).toThrow()
  })

  it('can persist once the D1 binding is supplied', async () => {
    /**
     * The regression guard for `dev:all` having no database.
     *
     * Before `local-bindings.ts`, the Node path's env was `process.env`, which cannot carry a
     * workerd binding. `requireDb` therefore threw on every persistence route and this POST
     * answered 503 `DATABASE_UNAVAILABLE` — while generation itself returned 200, so the editor
     * showed "Generate gagal" for what was really a save failure.
     *
     * A `fakeD1` is passed here rather than a real one: the point under test is that a binding
     * put on the env reaches the repository, not that miniflare works.
     */
    const db = fakeD1()
    const handler = createNodeHandler({ ...ENV, DB: db })

    const response = await handler(
      new Request('http://localhost/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Rakit-Token': TOKEN },
        body: JSON.stringify(clientProject()),
      }),
    )

    expect(response.status).toBe(201)
    expect(db.rows).toHaveLength(1)
  })

  it('reports DATABASE_UNAVAILABLE when the binding is genuinely missing', async () => {
    /**
     * Kept deliberately: the 503 is correct for a Worker deployed without its binding. What
     * changed is that the Node dev path no longer lands here by default.
     */
    const response = await handlerFor()(
      new Request('http://localhost/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Rakit-Token': TOKEN },
        body: JSON.stringify(clientProject()),
      }),
    )

    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE')
  })
})
