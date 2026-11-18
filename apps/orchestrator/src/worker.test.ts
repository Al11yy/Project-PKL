import { describe, expect, it } from 'vitest'
import worker from './worker'
import type { Env } from './config'

/**
 * Tests for the Worker entry point itself.
 *
 * These exist because of a real production bug. `cors.test.ts` covers `createApp()`, but the
 * deployed Worker never reached `createApp()` when configuration was missing: `worker.ts`
 * validated config first and returned 500 `CONFIG_INVALID` for *every* request, including the
 * CORS preflight. A browser reads a failed preflight as a network error, so the symptom
 * pointed at CORS while the cause was a missing secret.
 *
 * Those tests were green throughout. They proved the app handles preflight correctly and said
 * nothing about whether the entry point ever let a preflight through — a distinction that
 * only shows up in a test that calls `worker.fetch` rather than `createApp().fetch`.
 */

const ALLOWED = 'http://localhost:5180,https://rakit-editor.pages.dev,*.preview.pages.dev'

const envWith = (overrides: Partial<Env> = {}): Env => ({
  LLM_KITA_API_KEY: 'test-key',
  LLM_KITA_BASE_URL: 'https://api.example.test/api/v1',
  LLM_KITA_MODEL: 'auto',
  CORS_ALLOWED_ORIGINS: ALLOWED,
  ...overrides,
})

const preflight = (origin: string, env: Env) =>
  worker.fetch(
    new Request('https://worker.test/api/v1/generate', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    }),
    env,
  )

describe('worker preflight', () => {
  it('answers a permitted origin with 204 and the CORS headers', async () => {
    const response = await preflight('http://localhost:5180', envWith())

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5180')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type')
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  /**
   * The regression test proper. Without the early return in `worker.ts`, this returns 500
   * with `CONFIG_INVALID` — the exact failure that shipped.
   */
  it('answers the preflight even when the API key is missing', async () => {
    const response = await preflight('http://localhost:5180', envWith({ LLM_KITA_API_KEY: undefined }))

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5180')
  })

  it('answers the preflight when the base URL and model are missing too', async () => {
    // Config fails on the first missing variable it checks, so a test that only removes the
    // key would not catch a reordering that made a different variable fail first.
    const response = await preflight(
      'http://localhost:5180',
      envWith({ LLM_KITA_BASE_URL: undefined, LLM_KITA_MODEL: undefined }),
    )

    expect(response.status).toBe(204)
  })

  it('withholds the allow-origin header from an origin that is not permitted', async () => {
    const response = await preflight('https://evil.example.com', envWith())

    // A 204 either way: the browser is told "no" by the absent header, and the endpoint does
    // not become a way to enumerate which origins are allowed.
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('advertises PUT and DELETE, which the project endpoints require', async () => {
    const response = await preflight('http://localhost:5180', envWith())
    const methods = response.headers.get('Access-Control-Allow-Methods') ?? ''

    // The editor saves with PUT and deletes with DELETE. A preflight that omits either makes
    // the browser block the real request, and the failure looks like a CORS bug in the client.
    expect(methods).toContain('PUT')
    expect(methods).toContain('DELETE')
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
  })

  it('varies the response by origin so a cache cannot serve one origin headers meant for another', async () => {
    const permitted = await preflight('http://localhost:5180', envWith())
    const rejected = await preflight('https://evil.example.com', envWith())

    expect(permitted.headers.get('Vary')).toBe('Origin')
    expect(rejected.headers.get('Vary')).toBe('Origin')
  })
})

describe('worker configuration errors', () => {
  it('returns 500 CONFIG_INVALID with the envelope for a non-preflight request', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/api/v1/projects', {
        method: 'GET',
        headers: { Origin: 'http://localhost:5180' },
      }),
      envWith({ LLM_KITA_API_KEY: undefined }),
    )

    expect(response.status).toBe(500)
    const body = (await response.json()) as { data: null; error: { code: string } }
    expect(body.data).toBeNull()
    expect(body.error.code).toBe('CONFIG_INVALID')
  })

  it('names the missing variable so the operator knows what to set', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/api/v1/projects'),
      envWith({ LLM_KITA_API_KEY: undefined }),
    )
    const body = (await response.json()) as { error: { message: string } }

    expect(body.error.message).toContain('LLM_KITA_API_KEY')
  })

  /**
   * A config failure must not carry allow-origin, or a rejected origin would learn from the
   * error body that its preflight was refused rather than the request being broken.
   */
  it('does not echo an origin it never permitted, even on the config error', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/api/v1/projects', {
        method: 'GET',
        headers: { Origin: 'https://evil.example.com' },
      }),
      envWith({ LLM_KITA_API_KEY: undefined }),
    )

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
