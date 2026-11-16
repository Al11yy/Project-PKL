import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { createRouter } from './routes/index'
import { toApiError } from './errors'
import { logger } from './logger'
import { requestId } from './ids'
import type { LlmClient } from './llm/client'

/**
 * Body limit, set here rather than per route: Express refuses an oversized body before any
 * handler runs, which is the point. A cap enforced after parsing has already read the
 * payload into memory.
 */
const BODY_LIMIT = '32kb'

interface BodyParserError {
  type?: string
  status?: number
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as BodyParserError).type === 'string'
  )
}

export function createApp(client: LlmClient): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: BODY_LIMIT }))

  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = requestId()
    res.setHeader('x-request-id', id)
    logger.info('request', { id, method: req.method, path: req.path })
    next()
  })

  app.use('/api/v1', createRouter(client))

  /**
   * One error handler for the whole app.
   *
   * Handlers throw; this converts. Without a single conversion point the envelope would vary
   * by endpoint, and `conventions.md` requires `{ data, error: { code, message, details } }`
   * everywhere so a client can branch on `code`.
   *
   * `next` is unused but must stay in the signature: Express identifies an error handler by
   * arity, and a three-argument function would be registered as ordinary middleware.
   */
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isBodyParserError(error)) {
      const isTooLarge = error.type === 'entity.too.large'
      res.status(isTooLarge ? 413 : 400).json({
        data: null,
        error: {
          code: isTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
          message: isTooLarge ? 'Permintaan terlalu besar.' : 'Isi permintaan tidak valid.',
        },
      })
      return
    }

    const apiError = toApiError(error)
    if (apiError.httpStatus >= 500) {
      logger.error('request.failed', {
        code: apiError.apiError.code,
        message: apiError.apiError.message,
        /**
         * The underlying cause, for the operator. Without it a 502 LLM_UNAVAILABLE says
         * only "something went wrong upstream", which is not enough to tell a wrong base
         * URL from a DNS outage from a provider incident. It is logged and never returned:
         * a transport error's text can name an internal host.
         */
        cause: error instanceof Error ? error.cause : undefined,
      })
    }
    res.status(apiError.httpStatus).json({ data: null, error: apiError.apiError })
  })

  return app
}
