import { createApp } from './app'
import { allowedOrigins, isOriginAllowed } from './config'
import { ConfigError, loadLlmConfig, type Env } from './config'
import { OpenAiCompatibleClient } from './llm/openai-compatible-client'
import { logger } from './logger'

/**
 * Cloudflare Worker entry point.
 *
 * One app instance is built per isolate and reused across requests, which is the point of the
 * module scope: `OpenAiCompatibleClient` holds no per-request state, so constructing it once
 * is both cheaper and correct. Anything request-specific — the API key, the D1 binding —
 * arrives through `env` instead, because a Worker's secrets are per-request bindings and are
 * not guaranteed to be readable at module scope.
 *
 * Configuration is validated per request rather than at startup. A Worker has no startup: it
 * is instantiated on first request and may be evicted at any time. Failing loudly on a missing
 * key is still the goal, so the failure becomes a 500 with `CONFIG_INVALID` naming the
 * variable — the same message the Node path prints before exiting, just delivered over HTTP
 * because there is no console to exit to.
 *
 * **The CORS preflight is answered before configuration is read.**
 *
 * This is the one request that must never depend on the LLM being configured, and getting it
 * wrong is not subtle: the first deployed version of this file validated config first, so with
 * no API key stored every `OPTIONS` returned a 500 `CONFIG_INVALID`. A browser reads that as a
 * CORS failure and reports a bare network error, which points the user at the wrong problem
 * entirely — they go looking for a CORS misconfiguration in `wrangler.toml` while the actual
 * cause is a missing secret.
 *
 * The middleware in `app.ts` already returns early for `OPTIONS`; that early return could not
 * help here, because this function never reached it. The check therefore lives here too.
 */
const CORS_METHODS = 'GET, POST, PUT, DELETE, OPTIONS'
const CORS_HEADERS = 'Content-Type, X-Rakit-Token'

/**
 * A minimal preflight answer, without the app.
 *
 * Allowlist membership still applies: an origin that is not permitted gets the 204 with no
 * `Access-Control-Allow-Origin`, which is how a browser is told "no" without this endpoint
 * becoming a way to enumerate what is allowed.
 */
function preflightResponse(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin')
  const headers = new Headers({ Vary: 'Origin' })

  if (origin !== null && isOriginAllowed(origin, allowedOrigins(env))) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', CORS_METHODS)
    headers.set('Access-Control-Allow-Headers', CORS_HEADERS)
    headers.set('Access-Control-Max-Age', '86400')
  }

  return new Response(null, { status: 204, headers })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return preflightResponse(request, env)
    }

    let app
    try {
      const config = loadLlmConfig(env)
      app = createApp(new OpenAiCompatibleClient(config), config.timeoutMs)
    } catch (error) {
      if (error instanceof ConfigError) {
        logger.error('config.invalid', { message: error.message })
        return Response.json(
          {
            data: null,
            error: { code: 'CONFIG_INVALID', message: error.message },
          },
          { status: 500 },
        )
      }
      throw error
    }

    return app.fetch(request, env)
  },
} satisfies ExportedHandler<Env>
