import { fileURLToPath } from 'node:url'
import type { Env } from './config'
import { logger } from './logger'

/**
 * Gives the Node dev path the same Cloudflare bindings the Worker gets.
 *
 * The bug this exists for: `npm run dev:all` runs `server.ts`, a plain Node process whose only
 * source of configuration is `process.env`. `process.env` holds strings. A D1 binding is a
 * runtime object that only exists inside workerd, so `env.DB` was always `undefined` on that
 * path and every `/projects` route answered 503 `DATABASE_UNAVAILABLE`. Generating a project
 * still cost a model call, then failed to save, and the editor reported "Generate gagal" — a
 * persistence bug wearing a generation bug's clothes.
 *
 * `getPlatformProxy` starts miniflare in-process and hands back the bindings it would have
 * injected into the Worker. By default it persists to `.wrangler/state/v3`, the *same* directory
 * `wrangler dev` uses, so the two entry points read and write one database instead of drifting
 * apart into two that look identical and disagree.
 *
 * Only bindings are taken from the proxy. String configuration stays whatever `process.env`
 * says, because `dev:all` forwards a specific, deliberate set of variables and a `.env` file
 * sitting next to `wrangler.toml` must not quietly override them.
 */

/** The slice of `PlatformProxy` this module uses, structurally typed to avoid importing wrangler. */
export interface ProxyLike {
  env: Record<string, unknown>
  dispose: () => Promise<void>
}

/** Injected in tests so the suite does not start miniflare. */
export type ProxyFactory = (options: { configPath: string }) => Promise<ProxyLike>

export interface LocalBindings {
  /** `base` with the proxy's bindings merged underneath it. */
  env: Env
  /**
   * Releases miniflare and the SQLite handle it holds.
   *
   * Idempotent: `tsx watch` sends a signal on every reload and a shutdown path can be reached
   * twice (signal, then a hard-exit timer), and a second dispose must not throw. On Windows an
   * undisposed handle keeps `.wrangler/state/**​/*.sqlite` locked, which turns the next reload
   * into `SQLITE_BUSY` — so this is called on every exit path, not just the happy one.
   */
  dispose: () => Promise<void>
}

/**
 * The real factory.
 *
 * Loaded dynamically so importing this module in a unit test does not pull wrangler's CLI
 * bundle into the process — `getPlatformProxy` is only reachable through that entry point.
 */
const wranglerProxy: ProxyFactory = async (options) => {
  const { getPlatformProxy } = await import('wrangler')
  const proxy = await getPlatformProxy({ configPath: options.configPath })
  return proxy as unknown as ProxyLike
}

/** `wrangler.toml` sits one level above `src/`, next to this app's `package.json`. */
export const WRANGLER_CONFIG_PATH = fileURLToPath(new URL('../wrangler.toml', import.meta.url))

/**
 * Merges the proxy's bindings under `base`, with `base` winning.
 *
 * Spreading alone would be wrong: `{ ...proxyEnv, ...base }` is fine only as long as `base` has
 * no key that is present-but-`undefined`. Explicitly skipping `undefined` values makes the
 * precedence a stated rule rather than an accident of which keys `process.env` happens to carry.
 */
export function mergeBindings(base: Env, proxyEnv: Record<string, unknown>): Env {
  const merged: Record<string, unknown> = { ...proxyEnv }

  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) merged[key] = value
  }

  return merged as Env
}

/**
 * Wraps a proxy so `dispose` can be called from more than one place.
 *
 * The concurrency case is not hypothetical: a signal handler and the hard-exit backstop can
 * both fire, and on `tsx watch` a reload can arrive mid-shutdown. The first call runs the
 * underlying dispose; every later call resolves to the same promise instead of starting a
 * second teardown of an already-closed handle.
 */
function once(dispose: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined

  return () => {
    pending ??= dispose().catch((error: unknown) => {
      logger.warn('bindings.dispose_failed', { error: String(error) })
    })
    return pending
  }
}

/**
 * Loads the local bindings and returns the env the Node server should serve with.
 *
 * Throws rather than returning an env without `DB`. Falling back silently is what made the
 * original bug so hard to see: the server started, `/health` answered 200, and only a
 * non-`/health` request revealed that nothing could be persisted.
 */
export async function loadLocalBindings(
  base: Env,
  factory: ProxyFactory = wranglerProxy,
  configPath: string = WRANGLER_CONFIG_PATH,
): Promise<LocalBindings> {
  const proxy = await factory({ configPath })

  return {
    env: mergeBindings(base, proxy.env),
    dispose: once(proxy.dispose),
  }
}
