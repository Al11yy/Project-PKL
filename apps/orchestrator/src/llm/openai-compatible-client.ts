import type { LlmConfig } from '../config'
import {
  LlmAuthError,
  LlmError,
  LlmMalformedError,
  LlmProviderError,
  LlmRateLimitError,
  LlmTimeoutError,
} from './errors'
import type { LlmClient, LlmCompletion, LlmRequest } from './client'

interface ChatCompletionResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

const RETRY_BACKOFF_MS = 500
const DEFAULT_RETRY_AFTER_MS = 2_000

type AttemptResult =
  | { ok: true; value: LlmCompletion }
  | { ok: false; error: LlmError; retryable: boolean; retryAfterMs?: number }

/**
 * OpenAI-compatible adapter for API LLM-Kita.
 *
 * Retry policy is deliberately asymmetric. Retrying pays off when the failure is transient
 * (429, 5xx) and is actively harmful when it is not: a 401 retried is a wasted timeout on
 * every single request and, against a provider that counts failures, a path to a locked
 * account. So auth failures propagate immediately.
 *
 * Only one retry. A provider that is down is not revived by a third attempt, and the user
 * is already waiting behind a timeout measured in tens of seconds.
 */
export class OpenAiCompatibleClient implements LlmClient {
  constructor(private readonly config: LlmConfig) {}

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const first = await this.attempt(request)
    if (first.ok) return first.value

    if (!first.retryable) throw first.error

    await this.sleep(first.retryAfterMs ?? RETRY_BACKOFF_MS, request.signal)

    const second = await this.attempt(request)
    if (second.ok) return second.value
    throw second.error
  }

  private async attempt(request: LlmRequest): Promise<AttemptResult> {
    const timeout = this.childTimeout(request.signal)

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'system', content: request.system }, ...request.messages],
          max_tokens: request.maxTokens,
          // Low temperature: this task is transcription of a schema, not creative writing,
          // and variety here is indistinguishable from misbehaviour.
          temperature: 0.2,
        }),
        signal: timeout.signal,
      })

      if (!response.ok) {
        return {
          ok: false,
          // 429 and 5xx are worth one more try; 401/403 and other 4xx are not.
          retryable: response.status === 429 || response.status >= 500,
          retryAfterMs: this.retryAfterMs(response),
          error: this.errorFor(response.status),
        }
      }

      return { ok: true, value: await this.readBody(response) }
    } catch (error) {
      /**
       * The caller's abort and our own timeout are different events that both surface as
       * AbortError. The former means the client hung up and nobody is listening, so it is
       * rethrown as-is; the latter is ours to report as a 504.
       */
      if (error instanceof Error && error.name === 'AbortError') {
        if (request.signal.aborted) throw error
        return { ok: false, retryable: false, error: new LlmTimeoutError(this.config.timeoutMs) }
      }

      /**
       * An already-classified LlmError came from `readBody` — a 200 whose body is HTML or has
       * no content. It is not a transport failure, and re-wrapping it here would turn a
       * precise LLM_MALFORMED into a vague LLM_UNAVAILABLE.
       */
      if (error instanceof LlmError) throw error

      /**
       * Anything else is a transport failure: DNS does not resolve, TLS is refused, the
       * network is down. Retrying is pointless — the second attempt fails identically — and
       * rethrowing would let it become a generic 500, reporting an unreachable provider as a
       * bug in this process. 502 says the right thing.
       */
      return {
        ok: false,
        retryable: false,
        error: new LlmProviderError(0, error instanceof Error ? error.message : undefined),
      }
    } finally {
      timeout.dispose()
    }
  }

  private async readBody(response: Response): Promise<LlmCompletion> {
    const text = await response.text()

    let parsed: ChatCompletionResponse
    try {
      parsed = JSON.parse(text) as ChatCompletionResponse
    } catch {
      /**
       * A proxy returning an HTML error page is the usual cause. Reporting the parser's
       * "unexpected token <" would send whoever reads it hunting in our code rather than at
       * the proxy.
       */
      throw new LlmMalformedError('body was not JSON')
    }

    const content = parsed.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new LlmMalformedError('response contained no message content')
    }

    return {
      content,
      finishReason: parsed.choices?.[0]?.finish_reason,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      },
    }
  }

  private errorFor(status: number): LlmError {
    if (status === 401 || status === 403) return new LlmAuthError(status)
    if (status === 429) return new LlmRateLimitError()
    return new LlmProviderError(status)
  }

  private retryAfterMs(response: Response): number | undefined {
    const header = response.headers.get('retry-after')
    if (header === null) return undefined

    const seconds = Number.parseInt(header, 10)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : DEFAULT_RETRY_AFTER_MS
  }

  /**
   * A child signal per attempt, so `dispose()` cleans up timers without cancelling the
   * caller's signal. `AbortSignal.any` needs Node 20+, which is the floor `what.md` §10 sets.
   */
  private childTimeout(parent: AbortSignal): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const onParentAbort = () => controller.abort()
    parent.addEventListener('abort', onParentAbort, { once: true })

    return {
      signal: AbortSignal.any([controller.signal, parent]),
      dispose: () => {
        clearTimeout(timer)
        parent.removeEventListener('abort', onParentAbort)
      },
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted before retry'))
        return
      }
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new Error('aborted during retry backoff'))
        },
        { once: true },
      )
    })
  }
}
