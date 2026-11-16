import { ContractError } from '@rakit/schema'
import { LlmError } from './llm/errors'

/**
 * A contract failure caused by the model's output.
 *
 * Declared here rather than imported from the service so the error mapper does not depend on
 * a service module — the dependency would be circular and the mapper is the lower layer. The
 * service's `ModelOutputError` extends this, so `instanceof` works from either side.
 */
export class ModelOutputError extends ContractError {
  constructor(issues: { path: string; message: string }[]) {
    super(issues)
    this.name = 'ModelOutputError'
  }
}

/**
 * The response envelope from `conventions.md`.
 *
 * Clients branch on `code`, never on the message, so `code` is stable UPPER_SNAKE and the
 * message is Indonesian prose that may be reworded freely without breaking a client.
 */
export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export class ApiErrorException extends Error {
  constructor(
    readonly httpStatus: number,
    readonly apiError: ApiError,
  ) {
    super(apiError.message)
    this.name = 'ApiErrorException'
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiErrorException(400, { code, message, details })

export const unsupportedMediaType = () =>
  new ApiErrorException(415, {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Isi permintaan harus berformat application/json.',
  })

export const payloadTooLarge = () =>
  new ApiErrorException(413, {
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Permintaan terlalu besar.',
  })

export const internalError = () =>
  new ApiErrorException(500, {
    code: 'INTERNAL_ERROR',
    message: 'Terjadi kesalahan tak terduga.',
  })

/**
 * Fold a thrown error into the envelope.
 *
 * Only these three shapes get a specific status. Everything else becomes a generic 500: an
 * unrecognised exception's `message` may carry a stack fragment, a file path, or a provider
 * body, and `conventions.md` forbids leaking any of those to a client.
 */
export function toApiError(error: unknown): ApiErrorException {
  if (error instanceof ApiErrorException) return error

  if (error instanceof LlmError) {
    return new ApiErrorException(error.httpStatus, {
      code: error.code,
      message: error.message,
      // Nothing is charged in this blueprint; the field exists so clients written against
      // the eventual coin ledger do not have to change shape later.
      details: { charged: false },
    })
  }

  /**
   * Model output that failed the contract: the provider answered, but not usably. 422,
   * because the request itself was fine and retrying the same prompt may well succeed.
   *
   * Checked before the bare ContractError case, since this is a subclass.
   */
  if (error instanceof ModelOutputError) {
    return new ApiErrorException(422, {
      code: 'INVALID_SCHEMA',
      message: 'Model mengembalikan struktur yang tidak sesuai kontrak.',
      details: error.issues,
    })
  }

  /**
   * Any other ContractError means already-assembled data failed validation — a bug in this
   * process rather than a bad answer from the provider. 500, and deliberately not a 422:
   * telling the user to rephrase their prompt would send them chasing a fault that is ours.
   */
  if (error instanceof ContractError) {
    return new ApiErrorException(500, {
      code: 'CONTRACT_VIOLATION',
      message: 'Data internal tidak sesuai kontrak.',
      details: error.issues,
    })
  }

  return internalError()
}
