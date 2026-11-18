import { serve } from '@hono/node-server'
import { ConfigError, loadLlmConfig, loadServerConfig, type Env } from './config'
import { createNodeHandler } from './node-handler'
import { logger } from './logger'

/**
 * Node dev entry point.
 *
 * This is a second way to run the *same* Hono app `worker.ts` serves on Cloudflare. Keeping
 * both is deliberate: `wrangler dev` boots a real workerd isolate, which is the honest test,
 * but it restarts slower and its D1 is a local copy — the Node path with `tsx watch` is the
 * fast inner loop. The risk of two entry points is drift, and the guard against it is that
 * neither one contains routing or business logic: both build the same `createApp`.
 *
 * `@hono/node-server` adapts a Node `IncomingMessage` into the `Request`/`Response` pair Hono
 * expects, so the handlers here are byte-for-byte the ones the Worker runs.
 */
function main(): void {
  let llmConfig
  let serverConfig

  const env = process.env as Env

  try {
    llmConfig = loadLlmConfig(env)
    serverConfig = loadServerConfig(env)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[config] ${error.message}`)
      process.exit(1)
    }
    throw error
  }

  /**
   * Built by `createNodeHandler`, which closes over `env`.
   *
   * Passing `app.fetch` directly would leave `c.env` undefined on every request — Hono takes
   * bindings as a second argument the Node adapter never supplies — and every check that reads
   * `env` would silently do nothing. See `node-handler.ts`.
   */
  const handler = createNodeHandler(env)

  const server = serve({ fetch: handler, port: serverConfig.port }, () => {
    // The two flags are logged because a misconfigured deployment is otherwise indistinguishable
    // from a client sending the wrong token: both look like a 401.
    logger.info('server.listening', {
      port: serverConfig.port,
      model: llmConfig.model,
      tokenRequired: (env.RAKIT_SHARED_TOKEN ?? '').trim() !== '',
      generateEnabled: env.FEATURE_GENERATE_ENABLED === 'true',
    })
  })

  /**
   * Graceful shutdown: stop accepting connections, then exit. The hard-exit timer is the
   * backstop — without it a hung keep-alive connection would hold the process open forever
   * and a deploy would have to be killed.
   */
  const shutdown = (signal: string): void => {
    logger.info('server.shutdown', { signal })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main()
