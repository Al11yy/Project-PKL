import { createApp } from './app'
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
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
