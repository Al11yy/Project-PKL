import { serve } from '@hono/node-server'
import { ConfigError, loadLlmConfig, loadServerConfig, type Env } from './config'
import { createNodeHandler } from './node-handler'
import { loadLocalBindings, type LocalBindings } from './local-bindings'
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
 *
 * The one thing the two runtimes do not share is the *bindings*. `process.env` can supply the
 * string variables, but `DB` is a workerd object and Node has no such thing — so this entry
 * point asks wrangler's `getPlatformProxy` for it. That is what makes `npm run dev:all` able to
 * persist anything at all; see `local-bindings.ts`.
 */
async function main(): Promise<void> {
  let llmConfig
  let serverConfig

  const baseEnv = process.env as Env

  try {
    llmConfig = loadLlmConfig(baseEnv)
    serverConfig = loadServerConfig(baseEnv)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[config] ${error.message}`)
      process.exit(1)
    }
    throw error
  }

  /**
   * Configuration is validated *before* the proxy is started, so a missing API key exits
   * immediately instead of after miniflare has booted and taken a lock on the local database.
   */
  let bindings: LocalBindings
  try {
    bindings = await loadLocalBindings(baseEnv)
  } catch (error) {
    console.error(`[bindings] ${(error as Error).message}`)
    process.exit(1)
  }

  const env = bindings.env

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
   * Graceful shutdown: stop accepting connections, release the database, then exit.
   *
   * The dispose is awaited *before* `process.exit` on purpose. Exiting first would leave
   * miniflare's SQLite handle open, and on Windows an open handle keeps
   * `.wrangler/state/v3/d1/*.sqlite` locked — `tsx watch` then reloads into `SQLITE_BUSY` and
   * the next start fails for a reason that looks nothing like a restart. `dispose` is
   * idempotent, so the hard-exit timer firing after a normal close is harmless.
   *
   * The timer itself is the backstop: without it a hung keep-alive connection would hold the
   * process open forever and a deploy would have to be killed.
   */
  const shutdown = (signal: string): void => {
    logger.info('server.shutdown', { signal })

    const forceExit = setTimeout(() => process.exit(1), 5_000)
    forceExit.unref()

    server.close(() => {
      void bindings.dispose().finally(() => {
        clearTimeout(forceExit)
        process.exit(0)
      })
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  /**
   * `tsx watch` reloads by sending SIGTERM, which the handler above covers. These two are for
   * the paths that handler cannot reach: an unhandled rejection or a thrown error mid-request
   * would otherwise exit with the proxy still holding the database file.
   */
  for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
    process.on(event, (error: unknown) => {
      logger.error('server.crashed', { event, error: String(error) })
      void bindings.dispose().finally(() => process.exit(1))
    })
  }
}

void main()
