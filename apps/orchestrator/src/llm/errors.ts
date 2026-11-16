/**
 * Every provider failure carries an HTTP status and a stable code.
 *
 * The status is what *we* return to our client, which is deliberately not the provider's
 * status. A 401 from LLM-Kita becomes our 502: the user's credentials were not what was
 * rejected, and echoing 401 would make the editor treat a provider misconfiguration as a
 * user session problem — sending someone to re-login to fix our API key.
 *
 * Messages name the status and the shape of the failure, never the key, the request body,
 * or the provider's raw response. A provider error body can echo the request back, and the
 * request carries the user's business description.
 */
export type LlmErrorCode =
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMITED'
  | 'LLM_UNAVAILABLE'
  | 'LLM_AUTH_FAILED'
  | 'LLM_MALFORMED'

export class LlmError extends Error {
  readonly code: LlmErrorCode
  readonly httpStatus: number
  /** Provider status when one was received; undefined for timeouts and parse failures. */
  readonly providerStatus?: number

  constructor(code: LlmErrorCode, httpStatus: number, message: string, providerStatus?: number) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.httpStatus = httpStatus
    this.providerStatus = providerStatus
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(timeoutMs: number) {
    super('LLM_TIMEOUT', 504, `Penyedia AI tidak merespons dalam ${timeoutMs} ms.`)
    this.name = 'LlmTimeoutError'
  }
}

/** 503, not 429: the provider is throttling *us*, and the user did nothing wrong. */
export class LlmRateLimitError extends LlmError {
  constructor() {
    super('LLM_RATE_LIMITED', 503, 'Penyedia AI sedang membatasi permintaan. Coba lagi nanti.')
    this.name = 'LlmRateLimitError'
  }
}

export class LlmProviderError extends LlmError {
  /**
   * `providerStatus` is 0 for transport failures, where the provider was never reached and
   * there is no status to report. `cause` carries the underlying message for the *log* — it
   * is never sent to a client, since a transport error's text can contain a hostname or an
   * internal address.
   */
  override readonly cause: string | undefined

  constructor(providerStatus: number, cause?: string) {
    super(
      'LLM_UNAVAILABLE',
      502,
      providerStatus === 0
        ? 'Penyedia AI tidak dapat dihubungi.'
        : `Penyedia AI mengembalikan status ${providerStatus}.`,
      providerStatus,
    )
    this.name = 'LlmProviderError'
    this.cause = cause
  }
}

/**
 * A provider 401/403.
 *
 * Carries `LLM_UNAVAILABLE`, which M-6 requires: "the client's 401 is not the user's 401".
 * A distinct `LLM_AUTH_FAILED` code reads better but is wrong — it tells the editor that
 * *its* credentials were rejected, when in fact our API key was, and the user can do nothing
 * about it. The specific cause still reaches the log via `providerStatus`.
 *
 * It remains its own class because the retry policy needs to distinguish it: this is never
 * retried, while a 5xx is retried once.
 */
export class LlmAuthError extends LlmError {
  constructor(providerStatus: 401 | 403 = 401) {
    super(
      'LLM_UNAVAILABLE',
      502,
      'Konfigurasi penyedia AI ditolak. Hubungi administrator.',
      providerStatus,
    )
    this.name = 'LlmAuthError'
  }
}

export class LlmMalformedError extends LlmError {
  constructor(detail: string) {
    super('LLM_MALFORMED', 502, `Respons penyedia AI tidak dapat dibaca: ${detail}.`)
    this.name = 'LlmMalformedError'
  }
}
