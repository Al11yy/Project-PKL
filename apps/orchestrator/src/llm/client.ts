/**
 * The seam that isolates the provider.
 *
 * `what.md` records that LLM-Kita's endpoint shape is *assumed* OpenAI-compatible. This
 * interface is what makes that assumption cheap to be wrong about: a second adapter
 * satisfies the same type, and nothing upstream — prompt building, extraction, validation,
 * error mapping, routes — changes.
 *
 * One method on purpose. A `stream()` or `embed()` added speculatively would have to be
 * implemented by every fake in the test suite, to serve no current caller.
 */
export interface LlmMessage {
  role: 'system' | 'user'
  content: string
}

export interface LlmRequest {
  system: string
  messages: LlmMessage[]
  maxTokens: number
  /**
   * Caller-owned, so the signal spans the whole request rather than one attempt. A signal
   * created inside the adapter would be replaced on retry, silently extending the deadline
   * to `attempts x timeoutMs` — and the caller would have no way to cancel the whole thing.
   */
  signal: AbortSignal
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

export interface LlmCompletion {
  content: string
  usage: LlmUsage
  /** Provider's stop reason, e.g. "stop" | "length". Undefined if the provider omits it. */
  finishReason: string | undefined
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmCompletion>
}
