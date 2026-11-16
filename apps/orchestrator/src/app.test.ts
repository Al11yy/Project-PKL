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

  it('returns 422 INVALID_SCHEMA for a non-whitelisted kind', async () => {
    const badKind = JSON.stringify({
      name: 'X',
      slug: 'x',
      tables: [],
      screens: [{ id: 's-1', name: 'S', blocks: [{ id: 'b-1', kind: 'iframe' }] }],
    })

    const response = await request(app(clientReturning(badKind)))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('INVALID_SCHEMA')
    // The issue paths are the whole value of a 422 to a client: they say which field was
    // rejected and why, so a caller can fix the prompt rather than guess.
    expect(Array.isArray(response.body.error.details)).toBe(true)
    expect(response.body.error.details.length).toBeGreaterThan(0)
    expect(response.body.error.details[0]).toHaveProperty('path')
    expect(response.body.error.details[0]).toHaveProperty('message')
  })

  it('returns 200 with a refusal, not an error', async () => {
    const response = await request(app(clientReturning('{"refusal":{"reason":"Terlalu luas."}}')))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(200)
    expect(response.body.data.kind).toBe('refusal')
    expect(response.body.data.reason).toBe('Terlalu luas.')
  })

  it('returns 502 LLM_AUTH_FAILED when the provider rejects the key', async () => {
    const response = await request(app(failingClient(new LlmAuthError())))
      .post('/api/v1/generate')
      .send({ prompt: PROMPT })

    expect(response.status).toBe(502)
    expect(response.body.error.code).toBe('LLM_AUTH_FAILED')
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
