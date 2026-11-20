import { describe, expect, it, vi } from 'vitest'
import { loadLocalBindings, mergeBindings, type ProxyFactory } from './local-bindings'
import type { Env } from './config'

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

describe('loadLocalBindings', () => {
  it('points wrangler at this app’s wrangler.toml', async () => {
    const { factory, factorySpy } = fakeProxy()

    await loadLocalBindings(BASE, factory)

    expect(factorySpy).toHaveBeenCalledTimes(1)
    expect(factorySpy.mock.calls[0]![0].configPath).toMatch(/wrangler\.toml$/)
  })

  it('returns an env that can persist, not one that merely starts', async () => {
    const { factory } = fakeProxy()

    const { env } = await loadLocalBindings(BASE, factory)

    expect(env.DB).toBe(DB_SENTINEL)
    expect(env.LLM_KITA_API_KEY).toBe('test-key')
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

    await expect(loadLocalBindings(BASE, factory)).rejects.toThrow('miniflare could not start')
  })

  it('disposes once even when called repeatedly', async () => {
    /**
     * `tsx watch` can deliver a signal mid-shutdown, and the hard-exit timer may fire after a
     * normal close. A second teardown of a closed handle must not throw.
     */
    const { factory, dispose } = fakeProxy()
    const { dispose: shutdown } = await loadLocalBindings(BASE, factory)

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
    const { dispose } = await loadLocalBindings(BASE, factory)

    await expect(dispose()).resolves.toBeUndefined()
  })
})
