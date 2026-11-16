import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger, redact } from './logger'

const SENTINEL = 'zz-QWERTYUIOP-AS-DFG-HJKL'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('redact', () => {
  it('scrubs keys that name a credential', () => {
    for (const key of ['apiKey', 'api_key', 'authorization', 'Authorization', 'token', 'secret', 'password']) {
      expect(redact(key, SENTINEL)).toBe('[redacted]')
    }
  })

  it('replaces prompt and content with a length, never the text', () => {
    // Computed rather than hand-counted: the assertion is that the length is right, not
    // that a literal happens to match it.
    const prompt = 'sistem kasir untuk klinik'
    expect(redact('prompt', prompt)).toBe(`[${prompt.length} chars]`)
    expect(redact('content', 'rahasia')).toBe('[7 chars]')
  })

  it('passes ordinary fields through', () => {
    expect(redact('count', 3)).toBe(3)
    expect(redact('ids', ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('logger', () => {
  /**
   * Q-3. Captures the emitted line rather than trusting the implementation: the assertion
   * is on the actual bytes that would reach a log file.
   */
  it('never emits the API key, even when passed as a field value', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.info('test.event', {
      apiKey: SENTINEL,
      authorization: `Bearer ${SENTINEL}`,
      note: 'safe',
    })

    const emitted = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(emitted).not.toContain(SENTINEL)
    expect(emitted).toContain('safe')
  })

  it('never emits prompt text', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.info('llm.call', { prompt: 'pasien klinik dengan alergi penisilin' })

    const emitted = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(emitted).not.toContain('penisilin')
    expect(emitted).toContain('chars')
  })

  it('emits parseable JSON with an event name and level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    logger.info('server.listening', { port: 5_181 })

    const parsed = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(parsed).toMatchObject({ level: 'info', event: 'server.listening', port: 5_181 })
    expect(typeof parsed.at).toBe('string')
  })

  it('routes warn and error to their own streams', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    logger.warn('a')
    logger.error('b')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })
})
