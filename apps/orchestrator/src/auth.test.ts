import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Env } from './config'
import { TOKEN_HEADER, tokensMatch } from './auth'
import { ScriptedLlmClient, validProjectJson } from './testing/fixtures'

/**
 * The shared-token gate.
 *
 * Read the module comment in `src/auth.ts` before trusting these tests: the token is
 * containment, not authentication, and the tests below prove only that the check runs — not
 * that the API is safe. A green suite here means "an unauthenticated caller cannot spend the
 * LLM quota through this Worker", which is the narrow claim it is meant to support.
 */

const TOKEN = 'token-uji-yang-panjang-dan-acak-0123456789'

/**
 * A client whose call count is the one the parent records.
 *
 * Declaring `calls = 0` here would shadow `ScriptedLlmClient`'s request array, so the parent's
 * push would land in an array nobody reads and this counter would stay 0 forever — making every
 * "the provider was never reached" assertion below pass without testing anything.
 */
class CountingClient extends ScriptedLlmClient {
  constructor() {
    super(() => ({
      content: validProjectJson(),
      finishReason: 'stop',
      usage: { inputTokens: 100, outputTokens: 200 },
    }))
  }
}

const envWith = (overrides: Partial<Env> = {}): Env => ({
  LLM_KITA_API_KEY: 'test-key',
  LLM_KITA_BASE_URL: 'https://api.example.test/api/v1',
  LLM_KITA_MODEL: 'auto',
  FEATURE_GENERATE_ENABLED: 'true',
  ...overrides,
})

const call = (
  env: Env,
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
  client = new CountingClient(),
) => {
  const headers: Record<string, string> = {}
  if (init.token !== undefined) headers[TOKEN_HEADER] = init.token
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'

  return {
    client,
    response: createApp(client).fetch(
      new Request(`http://localhost${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      env,
    ),
  }
}

describe('tokensMatch', () => {
  it('accepts an identical token', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true)
  })

  it('rejects a token that differs in one character', () => {
    expect(tokensMatch('abc124', 'abc123')).toBe(false)
  })

  it('rejects a token that differs only in its last character', () => {
    // The case a first-character comparison would get wrong; a naive loop that returned on the
    // first mismatch would still pass, but one that compared only a prefix would not.
    expect(tokensMatch('abc12X', 'abc123')).toBe(false)
  })

  it('rejects a prefix of the real token', () => {
    expect(tokensMatch('abc', 'abc123')).toBe(false)
  })

  it('rejects an empty token', () => {
    expect(tokensMatch('', 'abc123')).toBe(false)
  })
})

describe('protected routes without a token', () => {
  it('refuses to create a project', async () => {
    const { response } = call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/projects', {
      method: 'POST',
      body: { id: 'p-1' },
    })

    expect((await response).status).toBe(401)
  })

  it('refuses to read the project list', async () => {
    const { response } = call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/projects')

    expect((await response).status).toBe(401)
  })

  it('returns the envelope with UNAUTHORIZED, not a bare status', async () => {
    const { response } = call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/projects')
    const body = (await (await response).json()) as { data: null; error: { code: string } }

    expect(body.data).toBeNull()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('does not say whether the token was missing or wrong', async () => {
    const missing = await call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/projects').response
    const wrong = await call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/projects', {
      token: 'tebakan-salah',
    }).response

    const a = (await missing.json()) as { error: { message: string } }
    const b = (await wrong.json()) as { error: { message: string } }

    // Identical wording: a prober must not learn that a token is configured here.
    expect(a.error.message).toBe(b.error.message)
  })

  it('refuses generation and never reaches the provider', async () => {
    const client = new CountingClient()
    const { response } = call(
      envWith({ RAKIT_SHARED_TOKEN: TOKEN }),
      '/api/v1/generate',
      { method: 'POST', body: { prompt: 'sistem kasir untuk warung kopi' } },
      client,
    )

    expect((await response).status).toBe(401)
    expect(client.calls.length).toBe(0)
  })

  it('refuses revision and never reaches the provider', async () => {
    const client = new CountingClient()
    const { response } = call(
      envWith({ RAKIT_SHARED_TOKEN: TOKEN }),
      '/api/v1/revise',
      { method: 'POST', body: { project: {}, instruction: 'tambah kolom' } },
      client,
    )

    expect((await response).status).toBe(401)
    expect(client.calls.length).toBe(0)
  })
})

describe('a wrong token', () => {
  it('is refused the same way as a missing one', async () => {
    const { response } = call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/projects', {
      token: `${TOKEN}x`,
    })

    expect((await response).status).toBe(401)
  })
})

describe('a correct token', () => {
  it('is allowed through to the route', async () => {
    const { response } = call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/projects', {
      token: TOKEN,
    })

    // 503 would still prove the gate opened (the D1 binding is absent in this test), but 500
    // or 401 would not. Asserting it is not 401 keeps the test about the gate.
    expect((await response).status).not.toBe(401)
  })

  it('tolerates surrounding whitespace, which a pasted secret often carries', async () => {
    const { response } = call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/projects', {
      token: `  ${TOKEN}\n`,
    })

    expect((await response).status).not.toBe(401)
  })
})

describe('routes that stay open', () => {
  it('serves /health without a token', async () => {
    const { response } = call(envWith({ RAKIT_SHARED_TOKEN: TOKEN }), '/api/v1/health')

    expect((await response).status).toBe(200)
  })

  it('answers the CORS preflight without a token', async () => {
    /**
     * The regression that would break every real request. A preflight carries no custom headers
     * by definition — the browser is asking permission to send them — so requiring the token on
     * OPTIONS would make the browser refuse to send the request that has the token.
     */
    const response = await createApp(new CountingClient()).fetch(
      new Request('http://localhost/api/v1/projects', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5180',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'x-rakit-token',
        },
      }),
      envWith({ RAKIT_SHARED_TOKEN: TOKEN, CORS_ALLOWED_ORIGINS: 'http://localhost:5180' }),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5180')
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-Rakit-Token')
  })
})

describe('an unconfigured token', () => {
  it('leaves the API open, so local development needs no secret', async () => {
    const { response } = call(envWith(), '/api/v1/projects')

    expect((await response).status).not.toBe(401)
  })

  it('treats a whitespace-only token as unset rather than as a lockout', async () => {
    // `wrangler secret put` with a trailing newline would otherwise lock out every client from
    // a deployment that looks correctly configured.
    const { response } = call(envWith({ RAKIT_SHARED_TOKEN: '   ' }), '/api/v1/projects')

    expect((await response).status).not.toBe(401)
  })
})
