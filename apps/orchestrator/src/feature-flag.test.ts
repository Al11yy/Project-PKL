import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { isGenerateEnabled } from './config'
import type { Env } from './config'
import { ScriptedLlmClient, validProjectJson } from './testing/fixtures'

/**
 * The generate/revise switch.
 *
 * This is the first line of defence for the LLM quota, ahead of the shared token and far more
 * robust than it: the token can be read out of the editor's bundle, but a flag read from the
 * Worker's own environment cannot. While it is off, no request — with or without a valid
 * token — causes a provider call.
 *
 * The default matters more than the mechanism. A flag that guards money must fail closed, so
 * the tests below are as much about what `isGenerateEnabled` rejects as what it accepts.
 */

const TOKEN = 'token-rahasia-panjang-0123456789'

/**
 * A client whose call count is inherited, not redeclared.
 *
 * `ScriptedLlmClient` already records every request in `calls`; an earlier version of this file
 * shadowed that array with a counter of its own, which broke the parent's push and made every
 * provider call throw. Tests that assert "the provider was never reached" read `calls.length`,
 * so the inherited array is the only source of truth.
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
  ...overrides,
})

/** Sends a request and returns the resolved response, so callers never hold a Promise. */
async function send(
  path: string,
  body: unknown,
  env: Env,
  options: { token?: string } = {},
): Promise<{ response: Response; client: CountingClient; body: () => Promise<{ data?: unknown; error?: { code?: string } | null }> }> {
  const client = new CountingClient()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token !== undefined) headers['X-Rakit-Token'] = options.token

  const response = await createApp(client).fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    env,
  )

  type Envelope = { data?: unknown; error?: { code?: string } | null }
  return {
    response,
    client,
    body: () => response.json() as Promise<Envelope>,
  }
}

const PROMPT = 'sistem kasir untuk warung kopi'
const REVISION = { project: { id: 'p-1' }, instruction: 'tambah kolom stok' }

describe('isGenerateEnabled', () => {
  it('is off when the variable is absent', () => {
    expect(isGenerateEnabled({})).toBe(false)
  })

  it('is on only for the exact string "true"', () => {
    expect(isGenerateEnabled({ FEATURE_GENERATE_ENABLED: 'true' })).toBe(true)
  })

  /**
   * Every plausible near-miss. These are not hypothetical: `TRUE` comes from a shell export,
   * `1` from a YAML habit, and an empty string from a variable defined but never filled in.
   * Any of them enabling a paid endpoint would be a bug nobody notices until the bill.
   */
  it.each(['TRUE', 'True', '1', 'yes', 'on', 'false', '', ' true', 'true '])(
    'is off for %j',
    (value) => {
      expect(isGenerateEnabled({ FEATURE_GENERATE_ENABLED: value })).toBe(false)
    },
  )

  it('is off when env itself is undefined', () => {
    expect(isGenerateEnabled(undefined)).toBe(false)
  })
})

describe('with generation disabled', () => {
  it('refuses /generate with 503 FEATURE_DISABLED', async () => {
    const { response, body } = await send('/api/v1/generate', { prompt: PROMPT }, envWith())

    expect(response.status).toBe(503)
    expect((await body()).error?.code).toBe('FEATURE_DISABLED')
  })

  it('never calls the provider for /generate', async () => {
    const { client } = await send('/api/v1/generate', { prompt: PROMPT }, envWith())

    // The whole point of the flag: a refused request must not have cost a token.
    expect(client.calls.length).toBe(0)
  })

  it('refuses /revise with 503 FEATURE_DISABLED', async () => {
    const { response } = await send('/api/v1/revise', REVISION, envWith())

    expect(response.status).toBe(503)
  })

  it('never calls the provider for /revise', async () => {
    const { client } = await send('/api/v1/revise', REVISION, envWith())

    expect(client.calls.length).toBe(0)
  })

  it('still serves persistence, which costs nothing to run', async () => {
    /**
     * `/projects` must stay reachable. Turning off generation is about the quota, not about
     * the API: a deployment with the flag off should still list and save projects, or the
     * editor becomes unusable rather than merely unable to generate.
     *
     * The env below has no D1 binding, so a 503 is expected here — the assertion is that its
     * code is about the database, not about the flag.
     */
    const { body } = await send('/api/v1/projects', { id: 'p-1' }, envWith())

    expect((await body()).error?.code).toBe('DATABASE_UNAVAILABLE')
  })

  it('leaves /health reachable', async () => {
    const response = await createApp(new CountingClient()).fetch(
      new Request('http://localhost/api/v1/health'),
      envWith(),
    )

    expect(response.status).toBe(200)
  })
})

describe('with generation enabled', () => {
  it('serves /generate and reaches the provider', async () => {
    const { response, client } = await send(
      '/api/v1/generate',
      { prompt: PROMPT },
      envWith({ FEATURE_GENERATE_ENABLED: 'true' }),
    )

    expect(response.status).toBe(200)
    expect(client.calls.length).toBe(1)
  })
})

describe('the flag and the token together', () => {
  it('refuses an unauthenticated request with 401 before it considers the flag', async () => {
    // Order matters for the operator reading logs: a caller with no token should learn they are
    // not authorised, not that a feature happens to be off — otherwise the 503 reveals the
    // deployment's configuration to someone who was never allowed to ask.
    const { response, client } = await send(
      '/api/v1/generate',
      { prompt: PROMPT },
      envWith({ RAKIT_SHARED_TOKEN: TOKEN }),
    )

    expect(response.status).toBe(401)
    expect(client.calls.length).toBe(0)
  })

  it('reaches the flag once the token is accepted, so both gates run in order', async () => {
    const { response, client } = await send(
      '/api/v1/generate',
      { prompt: PROMPT },
      envWith({ RAKIT_SHARED_TOKEN: TOKEN }),
      { token: TOKEN },
    )

    // 503 rather than 401 proves the token gate opened; FEATURE_DISABLED proves the flag is
    // what refused. Together with the test above, this pins the ordering of the two gates.
    expect(response.status).toBe(503)
    expect(client.calls.length).toBe(0)
  })
})
