import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleClient } from './openai-compatible-client'
import {
  LlmAuthError,
  LlmMalformedError,
  LlmProviderError,
  LlmRateLimitError,
  LlmTimeoutError,
} from './errors'
import type { LlmConfig } from '../config'
import type { LlmRequest } from './client'

/**
 * The configured key is a sentinel so Property 7 is checkable: after any failure, no thrown
 * message may contain it. A realistic-looking key would pass the same assertion without
 * proving anything, because the test would be searching for a string that never appears
 * anywhere by coincidence.
 */
const SENTINEL_KEY = 'sk-SENTINEL-do-not-log-0123456789'

const CONFIG: LlmConfig = {
  apiKey: SENTINEL_KEY,
  baseUrl: 'https://llm.test/v1',
  model: 'test-model',
  timeoutMs: 200,
  maxTokensGenerate: 8_000,
  maxTokensRevise: 12_000,
}

const okBody = (content = '{"name":"x"}', finish = 'stop') => ({
  choices: [{ message: { content }, finish_reason: finish }],
  usage: { prompt_tokens: 11, completion_tokens: 22 },
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

const request = (): LlmRequest => ({
  system: 'sys',
  messages: [{ role: 'user', content: 'halo' }],
  maxTokens: 100,
  signal: new AbortController().signal,
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const client = () => new OpenAiCompatibleClient(CONFIG)

describe('OpenAiCompatibleClient', () => {
  it('returns content and usage on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okBody('{"a":1}', 'stop')))

    const result = await client().complete(request())

    expect(result.content).toBe('{"a":1}')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 22 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends the system message first and appends the path once, without a double slash', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okBody()))

    await client().complete(request())

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://llm.test/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(body.model).toBe('test-model')
  })

  it('retries once on 429 and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse(okBody('{"ok":true}')))

    const result = await client().complete(request())

    expect(result.content).toBe('{"ok":true}')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws LlmRateLimitError when the 429 retry also fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 429, headers: { 'retry-after': '0' } }))

    await expect(client().complete(request())).rejects.toBeInstanceOf(LlmRateLimitError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries once on 5xx', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(okBody()))

    await expect(client().complete(request())).resolves.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws LlmProviderError with the provider status when 5xx persists', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 502 }))

    const error = await client()
      .complete(request())
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(LlmProviderError)
    expect((error as LlmProviderError).providerStatus).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  /**
   * Property 9. The assertion on call count is the whole point — a retried 401 is an
   * operational hazard, not just a slower failure.
   */
  it('does NOT retry on 401 and makes exactly one call', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 401 }))

    await expect(client().complete(request())).rejects.toBeInstanceOf(LlmAuthError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on 403', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 403 }))

    await expect(client().complete(request())).rejects.toBeInstanceOf(LlmAuthError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws LlmTimeoutError when the provider never answers in time', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const abort = new Error('aborted')
            abort.name = 'AbortError'
            reject(abort)
          })
        }),
    )

    await expect(client().complete(request())).rejects.toBeInstanceOf(LlmTimeoutError)
  })

  it('throws LlmMalformedError when the body is an HTML error page', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>502 Bad Gateway</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    await expect(client().complete(request())).rejects.toBeInstanceOf(LlmMalformedError)
  })

  it('throws LlmMalformedError when choices carry no content', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: {} }] }))

    await expect(client().complete(request())).rejects.toBeInstanceOf(LlmMalformedError)
  })

  /**
   * Found by smoke test rather than by this suite: with only a fake client, no transport
   * error ever reached `attempt()`, and a DNS failure came back as a generic 500. An
   * unreachable provider is an upstream fault, not a bug in this process.
   */
  it('maps a transport failure to LlmProviderError without retrying', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const error = await client()
      .complete(request())
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(LlmProviderError)
    expect((error as LlmProviderError).httpStatus).toBe(502)
    expect((error as LlmProviderError).providerStatus).toBe(0)
    // Transport failures do not improve on the second attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the transport cause out of the client-facing message', async () => {
    fetchMock.mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND internal.host.local'))

    const error = (await client()
      .complete(request())
      .catch((e: unknown) => e)) as LlmProviderError

    expect(error.message).not.toContain('internal.host.local')
    expect(error.message).not.toContain('ENOTFOUND')
    // But it is retained for the log.
    expect(error.cause).toContain('ENOTFOUND')
  })

  it('rethrows the caller abort rather than reporting it as a provider failure', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const abort = new Error('aborted')
            abort.name = 'AbortError'
            reject(abort)
          })
        }),
    )

    const pending = client().complete({ ...request(), signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.not.toBeInstanceOf(LlmProviderError)
  })

  /** Property 7. Every failure path, checked against the sentinel. */
  it('never puts the API key in a thrown message', async () => {
    const scenarios: (() => Response)[] = [
      () => jsonResponse({}, { status: 401 }),
      () => jsonResponse({}, { status: 403 }),
      () => jsonResponse({}, { status: 429, headers: { 'retry-after': '0' } }),
      () => jsonResponse({}, { status: 500 }),
      () => new Response('<html>oops</html>', { status: 200 }),
      () => jsonResponse({ choices: [{ message: {} }] }),
    ]

    for (const makeResponse of scenarios) {
      fetchMock.mockReset()
      fetchMock.mockImplementation(() => Promise.resolve(makeResponse()))

      const error = await client()
        .complete(request())
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toContain(SENTINEL_KEY)
    }
  })
})
