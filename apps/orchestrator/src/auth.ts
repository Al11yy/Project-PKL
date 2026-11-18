import { sharedToken } from './config'
import type { Env } from './config'
import { unauthorized } from './errors'

/**
 * The header a client presents the shared token in.
 *
 * A custom header rather than `Authorization: Bearer` for one practical reason: a custom name
 * cannot be set by a cross-site form post, and it makes the token obviously not a user
 * credential. It is also the name that must appear in `Access-Control-Allow-Headers`, or the
 * browser preflight blocks the request before the server ever sees it.
 */
export const TOKEN_HEADER = 'X-Rakit-Token'

/**
 * Compare two strings without leaking, through timing, where they first differ.
 *
 * `===` on strings short-circuits at the first mismatched character, so how long the comparison
 * takes depends on how much of the token the guess got right. That is exploitable in principle
 * over enough requests. It is not a realistic attack on a Cloudflare Worker with a long random
 * token, but the constant-time version costs a few lines and removes the question.
 *
 * Length is compared first and *outside* the loop, which does leak the token's length. That is
 * unavoidable — the loop has to know when to stop — and harmless: the token is fixed-length
 * random, and its length is not the secret.
 */
export function tokensMatch(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false

  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= presented.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

/**
 * Decide whether a request may reach a protected route.
 *
 * Returns `null` when it may, or a 401-shaped error when it may not.
 *
 * Three cases pass without a token, each for a different reason:
 *
 *   - **`OPTIONS`** is the browser's preflight. It carries no custom headers by definition —
 *     the browser is asking permission to send them — so requiring the token here would make
 *     every real request fail the preflight and never arrive. This is not a weakening: an
 *     `OPTIONS` response calls no provider and reads no database.
 *   - **No token configured** means the deployment has not opted in. See `sharedToken`.
 *   - **A correct token** is the ordinary case.
 *
 * The presented token is read from the header only. A query parameter would end up in logs,
 * in referrers, and in browser history, which is a worse place for it than a header.
 */
export function checkToken(request: Request, env: Env | undefined): Error | null {
  if (request.method === 'OPTIONS') return null

  const expected = sharedToken(env)
  if (expected === undefined) return null

  const header = request.headers.get(TOKEN_HEADER)
  if (header === null) return unauthorized()

  return tokensMatch(header.trim(), expected) ? null : unauthorized()
}
