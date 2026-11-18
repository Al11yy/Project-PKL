import { Hono } from 'hono'
import { createRouter } from './routes/index'
import { toApiError } from './errors'
import { logger } from './logger'
import { requestId } from './ids'
import { allowedOrigins, isOriginAllowed } from './config'
import type { LlmClient } from './llm/client'
import type { Env } from './config'

/**
 * Body limit, in bytes. 32 kB, the same cap Express had.
 *
 * Hono's `bodyLimit` refuses an oversized body before it is read into memory, which is the
 * point: a cap enforced after parsing has already buffered the payload.
 */
const BODY_LIMIT_BYTES = 32 * 1024

/**
 * `timeoutMs` is optional so production callers keep the configured default, while a test
 * can run the deadline in milliseconds rather than waiting out the real 60 s.
 */
export function createApp(client: LlmClient, timeoutMs?: number): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  /**
   * CORS, first, before anything that could fail.
   *
   * This has to be the outermost middleware for two reasons. A browser sends the preflight
   * `OPTIONS` *instead of* the real request, so a preflight that reaches a handler depending on
   * configuration fails before it can ever answer — which is exactly what happened when this
   * Worker was first deployed without an API key: `OPTIONS` returned 500 and the browser
   * reported it to the user as a network error with no explanation.
   *
   * And the CORS decision itself must not depend on the LLM being configured. Whether an
   * origin may talk to this API and whether the API can talk to its provider are unrelated
   * questions; coupling them means a missing key presents as a broken frontend.
   *
   * `Allow-Credentials` is deliberately absent. Nothing here is cookie-authenticated, and
   * sending it while reflecting an origin is how an allowlist quietly becomes a wildcard.
   */
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin')
    const allowed = allowedOrigins(c.env ?? {})
    const permitted = origin !== undefined && isOriginAllowed(origin, allowed)

    if (origin !== undefined && !permitted) {
      /**
       * A disallowed origin is logged, not silently dropped. During setup the failure is almost
       * always a typo in `CORS_ALLOWED_ORIGINS` or a forgotten Pages domain, and without this
       * line the symptom is an unexplained browser error.
       */
      logger.warn('cors.rejected', { origin })
    }

    if (permitted) {
      c.header('Access-Control-Allow-Origin', origin)
      // The response varies by origin, so a cache must not serve one origin's response to
      // another. Without this a CDN can hand a permitted origin's CORS headers to everyone.
      c.header('Vary', 'Origin')
    }

    // Preflight ends here, with no handler and no configuration involved.
    if (c.req.method === 'OPTIONS') {
      if (permitted) {
        c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        /**
         * `X-Rakit-Token` must be listed, or the browser refuses to send the real request and
         * the failure looks like a CORS bug rather than a missing header declaration. The list
         * is exact — a wildcard is not an option while `Allow-Credentials` is absent.
         */
        c.header('Access-Control-Allow-Headers', 'Content-Type, X-Rakit-Token')
        c.header('Access-Control-Max-Age', '86400')
      }
      return c.body(null, 204)
    }

    await next()
  })

  /**
   * Reject a non-JSON Content-Type before the parser sees it.
   *
   * Calling `c.req.json()` on a `text/plain` body would fail as INVALID_REQUEST (400) with a
   * confusing parse error. M-8 asks for 415, and the distinction is real: nothing was wrong
   * with the content, the declared type was wrong.
   *
   * Only requests that declare a type are checked. A bodyless GET has no Content-Type and
   * must pass through, and so must a request with no body at all.
   */
  app.use('*', async (c, next) => {
    const contentType = c.req.header('content-type')
    const method = c.req.method

    // Only methods that can carry a body are checked; a GET with a stray header is not a
    // media-type error worth failing.
    const carriesBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE'

    if (carriesBody && contentType !== undefined && !contentType.includes('application/json')) {
      return c.json(
        {
          data: null,
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Isi permintaan harus berformat application/json.',
          },
        },
        415,
      )
    }

    await next()
  })

  /**
   * Body-limit enforcement, before any route runs.
   *
   * Registered *before* `app.route(...)`, not after. Hono dispatches middleware in
   * registration order, so a limit declared after the router is only reached when no route
   * matched — never for the requests it exists to refuse. The first version of this file made
   * exactly that mistake.
   *
   * Two checks, because one is not enough. `Content-Length` is trusted when present, which
   * refuses an oversized body without buffering it. But the header is not always there: a
   * `Request` built from a string does not populate it, and a chunked upload omits it, so
   * relying on the header alone lets an oversized body through in exactly the environment
   * the tests run in. The fallback reads the body and measures its encoded length before
   * handing it on.
   *
   * Known limit: the fallback buffers the body, so it bounds what handlers *use* rather than
   * what the process *reads*. A hard memory bound needs a streaming check, which is not worth
   * its complexity for two trusted clients. Worth revisiting if this ever faces the public.
   */
  app.use('*', async (c, next) => {
    const tooLarge = () =>
      c.json(
        {
          data: null,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Permintaan terlalu besar.' },
        },
        413,
      )

    const declared = c.req.header('content-length')
    if (declared !== undefined && Number.parseInt(declared, 10) > BODY_LIMIT_BYTES) {
      return tooLarge()
    }

    // Measure only when the declared length was absent or unparseable. On a real Workers
    // deployment `Content-Length` is always set, so this path costs nothing in production.
    const declaredBytes = declared === undefined ? Number.NaN : Number.parseInt(declared, 10)
    if (!Number.isFinite(declaredBytes)) {
      const raw = await c.req.raw.clone().text()
      if (new TextEncoder().encode(raw).length > BODY_LIMIT_BYTES) {
        return tooLarge()
      }
    }

    await next()
  })

  /**
   * Request id and one log line per request, matching the previous middleware.
   */
  app.use('*', async (c, next) => {
    const id = requestId()
    c.header('x-request-id', id)
    logger.info('request', { id, method: c.req.method, path: c.req.path })
    await next()
  })

  app.route('/api/v1', createRouter(client, timeoutMs))

  /**
   * One error handler for the whole app.
   *
   * Handlers throw; this converts. Without a single conversion point the envelope would vary
   * by endpoint, and `conventions.md` requires `{ data, error: { code, message, details } }`
   * everywhere so a client can branch on `code`.
   */
  app.onError((error, c) => {
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
    return c.json({ data: null, error: apiError.apiError }, apiError.httpStatus as 400)
  })

  /**
   * A 404 that uses the same envelope as every other failure.
   *
   * Hono's default is a bare `404 Not Found` text/plain body, which a client that branches on
   * `error.code` cannot parse. The editor treats a non-envelope response as a network error,
   * so an unknown route would be reported to the user as "server tidak merespons" — true of
   * the shape, misleading about the cause.
   */
  app.notFound((c) =>
    c.json(
      {
        data: null,
        error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' },
      },
      404,
    ),
  )

  return app
}
