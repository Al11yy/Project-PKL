import { describe, expect, it } from 'vitest'
import worker from './worker'
import type { Env } from './config'

/**
 * End-to-end checks through the Worker entry point.
 *
 * Every other test in this suite calls `createApp`, which skips `worker.ts` entirely — the CORS
 * handling, the body limit, and the top-level error handler all live there. These tests go
 * through `worker.fetch`, the function Cloudflare actually invokes, so the two access controls
 * are proven on the deployed path and not merely on the app they are mounted into.
 */

const TOKEN = 'token-worker-e2e-0123456789abcdef'
const ENV = {
  LLM_KITA_API_KEY: 'fake',
  LLM_KITA_BASE_URL: 'http://localhost:5197/v1',
  LLM_KITA_MODEL: 'fake-model',
  RAKIT_SHARED_TOKEN: TOKEN,
  FEATURE_GENERATE_ENABLED: 'false',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5180',
} as unknown as Env

const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://w.test${path}`, init), ENV)

describe('worker entry guards', () => {
  it('health is open', async () => {
    expect((await call('/api/v1/health')).status).toBe(200)
  })

  it('projects requires the token', async () => {
    expect((await call('/api/v1/projects')).status).toBe(401)
  })

  it('projects passes the gate with the token', async () => {
    const r = await call('/api/v1/projects', { headers: { 'X-Rakit-Token': TOKEN } })
    expect(r.status).not.toBe(401)
  })

  it('generate is refused by the flag, never reaching the provider', async () => {
    const r = await call('/api/v1/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Rakit-Token': TOKEN },
      body: JSON.stringify({ prompt: 'sistem kasir untuk warung kopi' }),
    })
    expect(r.status).toBe(503)
    const body = (await r.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FEATURE_DISABLED')
  })

  it('preflight succeeds without a token and advertises the header', async () => {
    const r = await call('/api/v1/projects', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5180',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-rakit-token',
      },
    })
    expect(r.status).toBe(204)
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('X-Rakit-Token')
  })
})
