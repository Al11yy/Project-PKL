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
 * The proxy is not the whole environment. String configuration comes from three places, and they
 * are layered in a stated order rather than left to whichever one happens to run first:
 *
 *   `process.env` (what `dev:all` forwards from `.env`)  >  the proxy  >  `wrangler.toml [vars]`
 *
 * `[vars]` are the deployed Worker's; they are the fallback that makes `LLM_KITA_BASE_URL` and
 * the model reach this path at all, without repeating their values in a second place. The proxy
 * sits above them because it merges `.dev.vars`, which `wrangler dev` treats as the more specific
 * store. `process.env` sits above both because `dev:all` forwards a deliberate, per-invocation
 * set and a stale file must not override it. See `readWranglerVars` and `mergeBindings`.
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

/** Reads the `[vars]` block alone, without starting miniflare. Injected in tests. */
export type VarsReader = (configPath: string) => Promise<Record<string, string>>

/**
 * Reads `[vars]` from `wrangler.toml` with wrangler's own reader.
 *
 * The point is to *not* repeat the values: `LLM_KITA_BASE_URL`, `LLM_KITA_MODEL` and the token
 * limits are already written down once, for the deployed Worker. Parsing the TOML here instead
 * of asking wrangler would be a second, hand-written parser that nobody keeps in step.
 *
 * `readConfig` is synchronous and does not touch miniflare, which is what makes it usable for
 * the fail-fast check that must happen *before* the proxy takes a lock on the database. It also
 * deliberately does not merge `.dev.vars` — that file is read by the proxy and by nothing else.
 *
 * Only strings are returned. A `[vars]` entry holding JSON cannot be an `Env` value, so it is
 * dropped rather than stringified into something the config loader would then trust.
 */
const wranglerVars: VarsReader = async (configPath) => {
  const { unstable_readConfig } = await import('wrangler')
  const config = unstable_readConfig({ config: configPath }, { hideWarnings: true })

  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.vars ?? {})) {
    if (typeof value === 'string') vars[key] = value
  }
  return vars
}

/**
 * The lowest-precedence configuration layer: `wrangler.toml`'s `[vars]`.
 *
 * Never throws. `[vars]` are a fallback, so a file that cannot be read must not stop the dev
 * server from starting — whatever is genuinely missing will still be named by `loadLlmConfig`,
 * which is a better error than "could not parse a file you did not edit".
 */
export async function loadWranglerVars(
  configPath: string = WRANGLER_CONFIG_PATH,
  read: VarsReader = wranglerVars,
): Promise<Record<string, string>> {
  try {
    return await read(configPath)
  } catch (error) {
    logger.warn('bindings.config_vars_failed', { configPath, error: String(error) })
    return {}
  }
}

/**
 * Lays `base` over a lower layer, with one deliberate exception: a blank string loses.
 *
 * The shipped templates write placeholders such as `LLM_KITA_BASE_URL=` with nothing after the
 * `=`. If that blank won, the `[vars]` value beside it would be masked and `loadLlmConfig` would
 * report the variable as missing — the same confusion this layering exists to remove, only
 * harder to see, because the value is visibly present in `wrangler.toml`.
 *
 * The exception is *narrow on purpose*: it only applies when the lower layer actually has a
 * non-blank string for that key. So an empty `RAKIT_SHARED_TOKEN`, which the docs describe as
 * "leave it empty to run with the API open", keeps that meaning instead of quietly adopting a
 * token from somewhere else.
 *
 * Explicitly skipping `undefined` makes the rest of the precedence a stated rule rather than an
 * accident of which keys `process.env` happens to carry — `process.env` casts are full of them.
 */
export function withConfigVars(base: Env, lower: Record<string, unknown> = {}): Env {
  const merged: Record<string, unknown> = { ...lower }

  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue

    const fallback = lower[key]
    if (
      typeof value === 'string' &&
      value.trim() === '' &&
      typeof fallback === 'string' &&
      fallback.trim() !== ''
    ) {
      continue
    }

    merged[key] = value
  }

  return merged as Env
}

/**
 * Merges the three configuration layers, lowest precedence first: `[vars]`, then the proxy's
 * bindings, then `base`.
 *
 * The proxy sits above `[vars]` because it is the more specific store: it merges `.dev.vars`
 * over the same `[vars]`, so it is what `wrangler dev` would serve. `base` sits above both
 * because `dev:all` forwards a deliberate, per-invocation set of values from the root `.env`.
 */
export function mergeBindings(
  base: Env,
  proxyEnv: Record<string, unknown>,
  configVars: Record<string, string> = {},
): Env {
  const lower: Record<string, unknown> = { ...configVars }

  for (const [key, value] of Object.entries(proxyEnv)) {
    if (value !== undefined) lower[key] = value
  }

  return withConfigVars(base, lower)
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

export interface LocalBindingsOptions {
  /** Injected in tests so the suite does not start miniflare. */
  factory?: ProxyFactory
  configPath?: string
  /**
   * The `[vars]` layer, normally the result of `loadWranglerVars`.
   *
   * Passed in rather than read here because the caller has to read it *before* this function
   * runs: configuration is validated before the proxy starts, and that validation must already
   * see `[vars]` — otherwise a value that `wrangler.toml` supplies is reported missing. See
   * `server.ts`.
   */
  configVars?: Record<string, string>
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
  { factory = wranglerProxy, configPath = WRANGLER_CONFIG_PATH, configVars = {} }: LocalBindingsOptions = {},
): Promise<LocalBindings> {
  const proxy = await factory({ configPath })

  return {
    env: mergeBindings(base, proxy.env, configVars),
    dispose: once(proxy.dispose),
  }
}
