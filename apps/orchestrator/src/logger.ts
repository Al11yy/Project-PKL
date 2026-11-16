/**
 * Minimal structured logger.
 *
 * Hand-rolled rather than a dependency: this blueprint needs three event levels and one
 * redaction rule, and `what.md` §10 caps new runtime dependencies at express.
 *
 * Every value passes through `redact`, which is what makes the "no secret in any log" target
 * hold. Two categories are scrubbed:
 *
 *   - anything whose key looks like a credential (key, token, authorization, bearer, secret)
 *   - `prompt` and `content`, replaced with a length
 *
 * The second is not paranoia. A user's prompt describes their clinic or their shop's prices;
 * that is business data, and a log file is a place data goes to be forgotten about. The
 * length is enough to debug truncation; the text is not needed to debug anything.
 */

const SECRET_KEY = /api[_-]?key|authorization|bearer|token|secret|password/i

export function redact(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]'

  if (key === 'prompt' || key === 'content') {
    return typeof value === 'string' ? `[${value.length} chars]` : '[redacted]'
  }

  return value
}

type Level = 'info' | 'warn' | 'error'

function emit(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) safe[key] = redact(key, value)

  const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...safe })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
}
