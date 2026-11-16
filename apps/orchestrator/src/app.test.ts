import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { projectSchema } from '@rakit/schema'
import { createApp } from './app'
import { LlmAuthError, LlmProviderError, LlmRateLimitError, LlmTimeoutError } from './llm/errors'
import type { LlmClient } from './llm/client'
import {
  ScriptedLlmClient,
  clientProject,
  clientReturning,
  validProjectJson,
} from './testing/fixtures'

const PROMPT = 'sistem kasir untuk klinik'

const app = (client: LlmClient) => createApp(client)

/** A client whose every call rejects with the given error. */
const failingClient = (error: Error): LlmClient =>
  new ScriptedLlmClient(() => Promise.reject(error))

describe('GET /api/v1/health', () => {
  it('responds ok without calling the provider', async () => {
    const client = clientReturning(validProjectJson())

    const response = await request(app(client)).get('/api/v1/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ data: { status: 'ok' }, error: null })
    expect(client.calls).toHaveLength(0)
  })

  it('reports llmConfigured false when the key is absent', async () => {
    const previous = process.env.LLM_KITA_API_KEY
    delete process.env.LLM_KITA_API_KEY

    const response = await request(app(clientReturning('{}'))).get('/api/v1/health')
    expect(response.body.data.llmConfigured).toBe(false)

    if (previous !== undefined) process.env.LLM_KITA_API_KEY = previous
  })
})

describe('POST /api/v1/generate', () => {
  it('returns a project that passes projectSchema', async () => {
    const response = await request(app(clientReturning(validProjectJson())))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(200)
    expect(response.body.error).toBeNull()

    // Property 2: nothing leaves the process that the contract would reject.
    expect(projectSchema.safeParse(response.body.data.project).success).toBe(true)
  })

  it('returns 400 PROMPT_TOO_SHORT without calling the provider', async () => {
    const client = clientReturning(validProjectJson())

    const response = await request(app(client))
      .post('/api/v1/generate')
      .send({ prompt: 'kasir' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('PROMPT_TOO_SHORT')
    expect(client.calls).toHaveLength(0)
  })

  it('returns 400 PROMPT_TOO_LONG', async () => {
    const response = await request(app(clientReturning(validProjectJson())))
      .post('/api/v1/generate')
      .send({ prompt: 'a'.repeat(4_001) })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('PROMPT_TOO_LONG')
  })

  it('returns 400 INVALID_REQUEST when the body is not an object', async () => {
    const response = await request(app(clientReturning(validProjectJson())))
      .post('/api/v1/generate')
      .send(['not', 'an', 'object'])

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_REQUEST')
  })

  it('strips an unexpected model key rather than honouring it', async () => {
    const client = clientReturning(validProjectJson())

    await request(app(client))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT, model: 'gpt-4' })

    // The server's configured model is used; the request never reaches the client with a
    // client-chosen model, because the client interface does not expose one.
    expect(client.calls).toHaveLength(1)
  })

  /**
   * M-5 names the exact path and message for this case — `screens.0.blocks.2.kind` with
   * "kind tidak dikenal: iframe" — so the test asserts them literally rather than merely
   * checking that some detail exists. Three blocks, so the index is a real position and not
   * the trivially-correct zero.
   */
  it('returns 422 INVALID_SCHEMA naming the exact path and offending kind', async () => {
    const badKind = JSON.stringify({
      name: 'X',
      slug: 'x',
      tables: [],
      screens: [
        {
          id: 's-1',
          name: 'S',
          blocks: [
            { id: 'b-0', kind: 'navbar', title: 'A', body: 'B' },
            { id: 'b-1', kind: 'stat', title: 'C', body: 'D' },
            { id: 'b-2', kind: 'iframe', title: 'E', body: 'F' },
          ],
        },
      ],
    })

    const response = await request(app(clientReturning(badKind)))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('INVALID_SCHEMA')
    expect(response.body.error.details).toContainEqual({
      path: 'screens.0.blocks.2.kind',
      message: 'kind tidak dikenal: iframe',
    })
  })

  /**
   * M-5 forbids the tempting alternative: returning 200 with the offending block dropped.
   * Dropping would hide model misbehaviour during tuning, which is when it must be visible.
   */
  it('never returns 200 with a non-whitelisted kind silently dropped', async () => {
    const badKind = JSON.stringify({
      name: 'X',
      slug: 'x',
      tables: [],
      screens: [
        { id: 's-1', name: 'S', blocks: [{ id: 'b-1', kind: 'form', title: 'A', body: 'B' }] },
      ],
    })

    const response = await request(app(clientReturning(badKind)))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(422)
    expect(response.body.data).toBeNull()
  })

  /** M-5: prose instead of JSON is a 422 whose detail says so, never a raw SyntaxError. */
  it('states that no JSON object was found when the model returns prose', async () => {
    const response = await request(app(clientReturning('Tentu! Berikut skemanya.')))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('INVALID_SCHEMA')
    const detail = JSON.stringify(response.body.error.details)
    expect(detail).toContain('JSON')
    expect(detail).not.toContain('SyntaxError')
  })

  /** M-5: a fenced response is valid — models add fences even when told not to. */
  it('accepts a fenced JSON response', async () => {
    const response = await request(app(clientReturning(`\`\`\`json\n${validProjectJson()}\n\`\`\``)))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(200)
    expect(projectSchema.safeParse(response.body.data.project).success).toBe(true)
  })

  it('returns 200 with data.refusal populated, not an error', async () => {
    const response = await request(app(clientReturning('{"refusal":{"reason":"Terlalu luas."}}')))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    // M-5: a refusal is success. The statement is asserted twice, from both directions,
    // because reporting it as an error is the failure this criterion exists to prevent.
    expect(response.status).toBe(200)
    expect(response.body.error).toBeNull()
    expect(response.body.data.refusal).toEqual({ reason: 'Terlalu luas.' })
    expect(response.body.data.project).toBeUndefined()
  })

  /**
   * M-6: "the client's 401 is not the user's 401". Our provider rejecting our key must look
   * like an upstream fault, not like the user's session being invalid — otherwise the editor
   * sends someone to re-login to fix a server-side key problem.
   */
  it('returns 502 LLM_UNAVAILABLE when the provider rejects our key', async () => {
    const response = await request(app(failingClient(new LlmAuthError())))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(502)
    expect(response.body.error.code).toBe('LLM_UNAVAILABLE')
    // Never a 401: the response must not invite the user to authenticate.
    expect(response.status).not.toBe(401)
  })

  it('returns 503 LLM_RATE_LIMITED', async () => {
    const response = await request(app(failingClient(new LlmRateLimitError())))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('LLM_RATE_LIMITED')
  })

  it('returns 504 LLM_TIMEOUT with charged false', async () => {
    const response = await request(app(failingClient(new LlmTimeoutError(60_000))))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(504)
    expect(response.body.error.code).toBe('LLM_TIMEOUT')
    expect(response.body.error.details).toMatchObject({ charged: false })
  })

  it('returns 502 LLM_UNAVAILABLE for a provider 5xx', async () => {
    const response = await request(app(failingClient(new LlmProviderError(500))))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(502)
    expect(response.body.error.code).toBe('LLM_UNAVAILABLE')
  })
})

describe('POST /api/v1/revise', () => {
  it('returns a revised project that passes projectSchema', async () => {
    const response = await request(app(clientReturning(validProjectJson())))
      .post('/api/v1/revise')
      .send({ project: clientProject(), instruction: 'tambah kolom alergi pada tabel pasien' })

    expect(response.status).toBe(200)
    expect(projectSchema.safeParse(response.body.data.project).success).toBe(true)
  })

  it('returns 400 when the project body violates the contract', async () => {
    const response = await request(app(clientReturning(validProjectJson())))
      .post('/api/v1/revise')
      .send({ project: { name: 'tanpa id' }, instruction: 'tambah kolom alergi' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_REQUEST')
  })

  it('returns 400 PROMPT_TOO_LONG for an over-long instruction', async () => {
    const response = await request(app(clientReturning(validProjectJson())))
      .post('/api/v1/revise')
      .send({ project: clientProject(), instruction: 'a'.repeat(4_001) })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('PROMPT_TOO_LONG')
  })
})

describe('envelope discipline', () => {
  /**
   * Q-4: every failure is explainable. A client that branches on `code` cannot cope with a
   * bare string or a stack trace, so every error branch must carry both fields.
   */
  it('every error response has a non-empty code and message', async () => {
    const scenarios: [LlmClient, Record<string, unknown>, number][] = [
      [clientReturning(validProjectJson()), { prompt: 'kasir' }, 400],
      [clientReturning(validProjectJson()), { prompt: 'a'.repeat(4_001) }, 400],
      [failingClient(new LlmAuthError()), { prompt: PROMPT }, 502],
      [failingClient(new LlmRateLimitError()), { prompt: PROMPT }, 503],
      [failingClient(new LlmTimeoutError(1_000)), { prompt: PROMPT }, 504],
      [failingClient(new LlmProviderError(503)), { prompt: PROMPT }, 502],
      [clientReturning('bukan json'), { prompt: PROMPT }, 422],
    ]

    for (const [client, body, expectedStatus] of scenarios) {
      const response = await request(app(client)).post('/api/v1/generate').send(body)

      expect(response.status).toBe(expectedStatus)
      expect(response.body.data).toBeNull()
      expect(typeof response.body.error.code).toBe('string')
      expect(response.body.error.code.length).toBeGreaterThan(0)
      expect(typeof response.body.error.message).toBe('string')
      expect(response.body.error.message.length).toBeGreaterThan(0)
    }
  })

  it('never leaks the API key into an error response', async () => {
    const sentinel = 'sk-SENTINEL-DO-NOT-LEAK'
    process.env.LLM_KITA_API_KEY = sentinel

    const response = await request(app(failingClient(new LlmAuthError())))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(JSON.stringify(response.body)).not.toContain(sentinel)
  })

  it('sets an x-request-id header', async () => {
    const response = await request(app(clientReturning(validProjectJson()))).get('/api/v1/health')

    expect(response.headers['x-request-id']).toBeTruthy()
  })

  it('does not expose x-powered-by', async () => {
    const response = await request(app(clientReturning(validProjectJson()))).get('/api/v1/health')

    expect(response.headers['x-powered-by']).toBeUndefined()
  })
})
