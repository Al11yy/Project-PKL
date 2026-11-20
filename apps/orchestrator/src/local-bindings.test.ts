import { describe, expect, it, vi } from 'vitest'
import {
  loadLocalBindings,
  loadWranglerVars,
  mergeBindings,
  withConfigVars,
  type ProxyFactory,
  type VarsReader,
} from './local-bindings'
import { loadLlmConfig, type Env } from './config'

/**
 * Guards the fix for "the Node dev path has no database".
 *
 * The bug: `dev:all` runs `server.ts`, which read configuration from `process.env` alone. D1's
 * `DB` binding is a workerd object, so it was never there and every `/projects` route answered
 * 503 — generation succeeded, saving failed, and the editor said "Generate gagal".
 *
 * Miniflare is not started here. A fake proxy is enough to pin the two things that were
 * actually wrong: bindings must reach the env, and teardown must run exactly once.
 */

const DB_SENTINEL = { prepare: () => undefined }

const fakeProxy = (overrides: { env?: Record<string, unknown> } = {}) => {
  const dispose = vi.fn(async () => {})
  const factory = vi.fn(async (_options: { configPath: string }) => ({
    env: { DB: DB_SENTINEL, ...overrides.env },
    dispose,
  }))

  return { factory: factory satisfies ProxyFactory, factorySpy: factory, dispose }
}

const BASE: Env = {
  LLM_KITA_API_KEY: 'test-key',
  LLM_KITA_BASE_URL: 'https://api.example.test/api/v1',
  LLM_KITA_MODEL: 'auto',
  FEATURE_GENERATE_ENABLED: 'true',
}

describe('mergeBindings', () => {
  it('carries the DB binding into the env', () => {
    // The whole point. Without this, requireDb() throws on every persistence route.
    expect(mergeBindings(BASE, { DB: DB_SENTINEL }).DB).toBe(DB_SENTINEL)
  })

  it('lets process.env win over a string the proxy also has', () => {
    /**
     * `wrangler.toml` and a stray `.env` next to it must not override what `dev:all` forwarded.
     * `dev:all` sends a deliberate set of variables; the proxy's `[vars]` are the deployed
     * Worker's, and `FEATURE_GENERATE_ENABLED` is `"false"` there.
     */
    const merged = mergeBindings(
      { FEATURE_GENERATE_ENABLED: 'true' },
      { FEATURE_GENERATE_ENABLED: 'false', LLM_KITA_MODEL: 'auto' },
    )

    expect(merged.FEATURE_GENERATE_ENABLED).toBe('true')
  })

  it('keeps a binding the base env does not mention', () => {
    expect(mergeBindings(BASE, { DB: DB_SENTINEL }).DB).toBe(DB_SENTINEL)
  })

  it('does not let an undefined base value erase a real binding', () => {
    // `process.env` casting is full of undefined keys; spreading naively would drop DB.
    const merged = mergeBindings({ DB: undefined } as Env, { DB: DB_SENTINEL })

    expect(merged.DB).toBe(DB_SENTINEL)
  })
})

describe('withConfigVars', () => {
  it('keeps a value the upper layer does not define', () => {
    /**
     * The regression test. `LLM_KITA_BASE_URL` and `LLM_KITA_MODEL` live in `wrangler.toml` and
     * nowhere else, so without this layer `loadLlmConfig` rejected every correctly configured
     * machine with "Missing required environment variable LLM_KITA_BASE_URL".
     */
    const env = withConfigVars({ LLM_KITA_API_KEY: 'test-key' }, { LLM_KITA_BASE_URL: 'from-toml' })

    expect(env.LLM_KITA_BASE_URL).toBe('from-toml')
    expect(env.LLM_KITA_API_KEY).toBe('test-key')
  })

  it('lets the upper layer win over a lower one', () => {
    // `dev:all` forwards a deliberate per-invocation value; a file must not override it.
    const env = withConfigVars({ LLM_KITA_BASE_URL: 'from-env' }, { LLM_KITA_BASE_URL: 'from-toml' })

    expect(env.LLM_KITA_BASE_URL).toBe('from-env')
  })

  it('treats a blank placeholder as absent when the lower layer has a value', () => {
    /**
     * Both shipped templates write `LLM_KITA_BASE_URL=` with nothing after it. If that blank
     * won, the value sitting in `wrangler.toml` would be masked and the error would name a
     * variable that is visibly configured.
     */
    const env = withConfigVars({ LLM_KITA_BASE_URL: '  ' }, { LLM_KITA_BASE_URL: 'from-toml' })

    expect(env.LLM_KITA_BASE_URL).toBe('from-toml')
  })

  it('keeps a deliberate blank when the lower layer has nothing to offer', () => {
    /**
     * `RAKIT_SHARED_TOKEN=` is documented as "leave it empty to run with the API open". Falling
     * back to some other token would silently start rejecting the editor's requests.
     */
    const env = withConfigVars({ RAKIT_SHARED_TOKEN: '' }, {})

    expect(env.RAKIT_SHARED_TOKEN).toBe('')
  })
})

describe('loadWranglerVars', () => {
  it('passes the config path through and returns the strings it read', async () => {
    const read = vi.fn<VarsReader>(async () => ({ LLM_KITA_MODEL: 'auto' }))

    const vars = await loadWranglerVars('/some/wrangler.toml', read)

    expect(read).toHaveBeenCalledWith('/some/wrangler.toml')
    expect(vars).toEqual({ LLM_KITA_MODEL: 'auto' })
  })

  it('returns an empty layer rather than throwing when the file cannot be read', async () => {
    /**
     * `[vars]` are a fallback. A missing file must not stop the dev server from booting — the
     * genuinely missing value is named by `loadLlmConfig`, which is a better error than this.
     */
    const read: VarsReader = async () => {
      throw new Error('ENOENT: no such file or directory')
    }

    await expect(loadWranglerVars('/nope/wrangler.toml', read)).resolves.toEqual({})
  })
})

describe('loadLocalBindings', () => {
  it('points wrangler at this app’s wrangler.toml', async () => {
    const { factory, factorySpy } = fakeProxy()

    await loadLocalBindings(BASE, { factory })

    expect(factorySpy).toHaveBeenCalledTimes(1)
    expect(factorySpy.mock.calls[0]![0].configPath).toMatch(/wrangler\.toml$/)
  })

  it('returns an env that can persist, not one that merely starts', async () => {
    const { factory } = fakeProxy()

    const { env } = await loadLocalBindings(BASE, { factory })

    expect(env.DB).toBe(DB_SENTINEL)
    expect(env.LLM_KITA_API_KEY).toBe('test-key')
  })

  it('serves with the [vars] layer merged underneath the proxy', async () => {
    /**
     * The end-to-end shape of the fix: `[vars]` reach the runtime env, while a `.dev.vars` value
     * the proxy carries still wins over them.
     */
    const { factory } = fakeProxy({ env: { LLM_KITA_MODEL: 'from-dev-vars' } })

    const { env } = await loadLocalBindings(
      {},
      { factory, configVars: { LLM_KITA_BASE_URL: 'from-toml', LLM_KITA_MODEL: 'auto' } },
    )

    expect(env.LLM_KITA_BASE_URL).toBe('from-toml')
    expect(env.LLM_KITA_MODEL).toBe('from-dev-vars')
    expect(env.DB).toBe(DB_SENTINEL)
  })

  it('lets the shipped .env placeholder fall back to the value in wrangler.toml', async () => {
    /**
     * The actual setup that failed. `.env.example` ships `LLM_KITA_BASE_URL=` as a blank
     * placeholder, `[vars]` holds the real one, and `loadLlmConfig` then reported the variable
     * missing — pointing the reader at the file that was already correct.
     *
     * Asserted through the validator rather than against the raw fields, because the validator
     * is the contract that broke.
     */
    const { factory } = fakeProxy()
    const shellLikeEnv = {
      LLM_KITA_API_KEY: 'test-key',
      LLM_KITA_BASE_URL: '',
      LLM_KITA_MODEL: '',
    } as Env

    const { env } = await loadLocalBindings(shellLikeEnv, {
      factory,
      configVars: {
        LLM_KITA_BASE_URL: 'https://api.llm-kita.com/api/v1',
        LLM_KITA_MODEL: 'auto',
      },
    })

    expect(loadLlmConfig(env).baseUrl).toBe('https://api.llm-kita.com/api/v1')
    expect(loadLlmConfig(env).model).toBe('auto')
  })

  it('propagates a proxy failure instead of serving without a database', async () => {
    /**
     * Degrading to "no DB" is what made the original bug invisible: the server booted,
     * `/health` answered 200, and only a persistence call revealed the problem. Starting and
     * failing loudly is the honest behaviour.
     */
    const factory: ProxyFactory = async () => {
      throw new Error('miniflare could not start')
    }

    await expect(loadLocalBindings(BASE, { factory })).rejects.toThrow('miniflare could not start')
  })

  it('disposes once even when called repeatedly', async () => {
    /**
     * `tsx watch` can deliver a signal mid-shutdown, and the hard-exit timer may fire after a
     * normal close. A second teardown of a closed handle must not throw.
     */
    const { factory, dispose } = fakeProxy()
    const { dispose: shutdown } = await loadLocalBindings(BASE, { factory })

    await Promise.all([shutdown(), shutdown()])
    await shutdown()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('resolves rather than throwing when the underlying dispose fails', async () => {
    // A teardown error must not mask the exit code the process was already committing to.
    const factory: ProxyFactory = async () => ({
      env: { DB: DB_SENTINEL },
      dispose: async () => {
        throw new Error('EBUSY: resource busy or locked')
      },
    })
    const { dispose } = await loadLocalBindings(BASE, { factory })

    await expect(dispose()).resolves.toBeUndefined()
  })
})
