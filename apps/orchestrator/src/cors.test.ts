import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { isOriginAllowed } from './config'
import type { Env } from './config'
import { clientReturning, validProjectJson } from './testing/fixtures'

/**
 * CORS is the only access control this API has until Auth ships, which makes these tests
 * load-bearing rather than cosmetic: a bug here either locks the editor out or opens the
 * Worker to every page on the internet.
 */

const ALLOWED = 'http://localhost:5180,https://rakit-editor.pages.dev,*.preview.pages.dev'
const ENV: Env = {
  LLM_KITA_API_KEY: 'test-key',
  FEATURE_GENERATE_ENABLED: 'true',
  CORS_ALLOWED_ORIGINS: ALLOWED,
}

const app = () => createApp(clientReturning(validProjectJson()))

const preflight = (origin: string, env: Env = ENV) =>
  app().fetch(
    new Request('http://localhost/api/v1/generate', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    }),
    env,
  )

describe('isOriginAllowed', () => {
  it('matches an exact origin', () => {
    expect(isOriginAllowed('http://localhost:5180', ['http://localhost:5180'])).toBe(true)
  })

  it('rejects an origin that merely contains an allowed one', () => {
    // The classic allowlist bug: `includes` lets this through. It must not.
    const allowed = ['https://rakit.example.com']
    expect(isOriginAllowed('https://evil-rakit.example.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://rakit.example.com.evil.io', allowed)).toBe(false)
  })

  it('matches a subdomain wildcard but not the bare domain', () => {
    const allowed = ['*.preview.pages.dev']
    expect(isOriginAllowed('https://abc123.preview.pages.dev', allowed)).toBe(true)
    // The suffix alone is the base domain, not a subdomain; `pages.dev` is not ours to allow.
    expect(isOriginAllowed('https://preview.pages.dev', allowed)).toBe(false)
  })

  it('rejects a lookalike domain against a wildcard', () => {
    const allowed = ['*.preview.pages.dev']
    expect(isOriginAllowed('https://evilpreview.pages.dev', allowed)).toBe(false)
    expect(isOriginAllowed('https://abc.preview.pages.dev.evil.io', allowed)).toBe(false)
  })

  it('denies everything when the list is empty', () => {
    // Fail closed: a forgotten variable must not mean "open to all".
    expect(isOriginAllowed('http://localhost:5180', [])).toBe(false)
  })
})

describe('CORS preflight', () => {
  it('answers 204 for an allowed origin, without touching the LLM config', async () => {
    const response = await preflight('http://localhost:5180')

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5180')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })

  /**
   * The bug this file was written for. The first deployed Worker answered `OPTIONS` with 500
   * because the preflight fell through to a handler that demanded the API key. A preflight
   * must be answerable by a Worker that cannot talk to its provider at all.
   */
  it('still answers 204 when the API key is missing', async () => {
    const response = await preflight('http://localhost:5180', {
      CORS_ALLOWED_ORIGINS: ALLOWED,
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5180')
  })

  it('omits the allow-origin header for a disallowed origin', async () => {
    const response = await preflight('https://evil.example.com')

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('CORS on real requests', () => {
  it('sets allow-origin on an allowed cross-origin POST', async () => {
    const response = await app().fetch(
      new Request('http://localhost/api/v1/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5180' },
        body: JSON.stringify({ prompt: 'sistem kasir untuk klinik' }),
      }),
      ENV,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5180')
    expect(response.headers.get('vary')).toContain('Origin')
  })

  it('does not set allow-origin for a disallowed origin', async () => {
    const response = await app().fetch(
      new Request('http://localhost/api/v1/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
        body: JSON.stringify({ prompt: 'sistem kasir untuk klinik' }),
      }),
      ENV,
    )

    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('never sends allow-credentials', async () => {
    // Reflecting an origin while allowing credentials is how an allowlist becomes a wildcard.
    const response = await preflight('http://localhost:5180')

    expect(response.headers.get('access-control-allow-credentials')).toBeNull()
  })
})
