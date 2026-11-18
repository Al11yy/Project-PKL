/**
 * Configuration, read from an explicit environment object rather than `process.env`.
 *
 * The Worker has no `process.env`; its variables arrive as the second argument to `fetch` and
 * reach the app as `c.env`. Rather than reach for a `nodejs_compat` polyfill, every function
 * here takes the environment as a parameter. That makes the dependency visible in the
 * signature — a reader can see that `loadLlmConfig` reads configuration and does not touch
 * globals — and it is what lets the Node dev server and the Worker share one code path.
 *
 * Validated eagerly, at the edge of the request: a missing API key should be a message naming
 * the variable, not a 502 on the first user request that looks like the provider's fault.
 * `conventions.md` requires an explicit timeout on every external call, so the timeout is
 * configuration with a stated default rather than a literal buried in the client.
 */

/**
 * The subset of bindings this module reads. Structurally typed rather than importing
 * `Env` from the worker, so the pure unit tests can pass a plain object with no Cloudflare
 * types in scope.
 */
export interface Env {
  LLM_KITA_API_KEY?: string
  LLM_KITA_BASE_URL?: string
  LLM_KITA_MODEL?: string
  LLM_TIMEOUT_MS?: string
  LLM_MAX_TOKENS_GENERATE?: string
  LLM_MAX_TOKENS_REVISE?: string
  /** Node dev path only; a Worker ignores it. */
  PORT?: string
  /**
   * Comma-separated list of origins allowed to call this API from a browser.
   *
   * Read from configuration rather than hardcoded so a new deployment target — a Pages
   * domain, a custom domain — is a variable change rather than a code change and a redeploy.
   */
  CORS_ALLOWED_ORIGINS?: string
  /**
   * The shared token every API request must present, except `/health` and the CORS preflight.
   *
   * **This is containment, not authentication.** The editor is a browser app, so whatever token
   * it sends is readable by anyone who opens DevTools. It raises the cost of casual abuse —
   * crawlers, scanners, someone who found the URL — and does nothing against a person who
   * decides to look. Real auth is still required before the editor is published; this exists so
   * the deployed Worker is not wide open in the meantime.
   *
   * When unset, the token check is skipped entirely, which keeps local development and the
   * existing test suite working without a secret. That default is why the token is a second
   * layer rather than the first: the feature flag below is what protects the quota when nothing
   * is configured.
   */
  RAKIT_SHARED_TOKEN?: string
  /**
   * Whether `/generate` and `/revise` are served at all.
   *
   * **Off unless the value is exactly `true`.** Every other value — absent, empty, `1`, `TRUE`,
   * `yes` — leaves generation disabled. A flag that guards spending money should not be turned
   * on by a typo, and the failure mode of the strict reading is a 503 a developer sees
   * immediately rather than a bill nobody expected.
   */
  FEATURE_GENERATE_ENABLED?: string
  DB?: D1Database
}

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
  maxTokensGenerate: number
  maxTokensRevise: number
}

export class ConfigError extends Error {
  readonly code = 'CONFIG_INVALID' as const

  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const required = (env: Env, name: keyof Env): string => {
  const value = env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(
      `Missing required environment variable ${String(name)}. Locally: copy .env.example to ` +
        `.dev.vars and fill it in. Deployed: wrangler secret put ${String(name)}.`,
    )
  }
  return value
}

const positiveInt = (env: Env, name: keyof Env, fallback: number): number => {
  const raw = env[name]
  if (typeof raw !== 'string' || raw.trim() === '') return fallback

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${String(name)} must be a positive integer, got "${raw}"`)
  }
  return parsed
}

/**
 * Whether `/generate` and `/revise` may run.
 *
 * Strict by design: only the exact string `true` enables it. See the field's comment in `Env`
 * for why every other value means off.
 *
 * Read per request from `env` rather than captured at module scope, because a Worker's
 * bindings are per-request and a value captured at import time may be a stale isolate's.
 */
export function isGenerateEnabled(env: Env | undefined): boolean {
  return env?.FEATURE_GENERATE_ENABLED === 'true'
}

/**
 * The configured shared token, or `undefined` when the check should be skipped.
 *
 * An empty or whitespace-only value is treated as unset rather than as a token nobody can
 * match: `wrangler secret put` with a stray newline would otherwise lock every client out of a
 * deployment that looks correctly configured.
 */
export function sharedToken(env: Env | undefined): string | undefined {
  const raw = env?.RAKIT_SHARED_TOKEN
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

export function loadLlmConfig(env: Env): LlmConfig {
  return {
    apiKey: required(env, 'LLM_KITA_API_KEY'),
    // Trailing slashes stripped so the client can append `/chat/completions`
    // unconditionally without producing a double slash.
    baseUrl: required(env, 'LLM_KITA_BASE_URL').replace(/\/+$/, ''),
    model: required(env, 'LLM_KITA_MODEL'),
    timeoutMs: positiveInt(env, 'LLM_TIMEOUT_MS', 60_000),
    maxTokensGenerate: positiveInt(env, 'LLM_MAX_TOKENS_GENERATE', 8_000),
    maxTokensRevise: positiveInt(env, 'LLM_MAX_TOKENS_REVISE', 12_000),
  }
}

export interface ServerConfig {
  port: number
}

/**
 * Port 5181, not 5180: the editor's Vite server owns 5180 with `strictPort: true`, so a
 * collision is a hard startup failure rather than a fallback to another port.
 *
 * Node dev path only — a Worker has no port to choose.
 */
export function loadServerConfig(env: Env = {}): ServerConfig {
  return { port: positiveInt(env, 'PORT', 5_181) }
}

/**
 * Browser origins permitted to call the API, and the matcher that enforces them.
 *
 * There is no Auth yet, so the origin check is the only thing standing between a deployed
 * Worker and anyone who reads the URL out of a page source. That makes two rules matter:
 *
 *   1. An empty configuration denies everything rather than allowing everything. A missing
 *      variable should fail closed — the opposite default would mean forgetting to set it
 *      silently opens the API.
 *   2. Matching is exact, or a subdomain wildcard written as `*.example.com`. A `startsWith`
 *      or `includes` check would let `https://evil-example.com` through, which is the classic
 *      way an origin allowlist stops being one.
 */
export function allowedOrigins(env: Env): string[] {
  const raw = env.CORS_ALLOWED_ORIGINS
  if (typeof raw !== 'string' || raw.trim() === '') return []
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')
}

export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((entry) => {
    if (entry === origin) return true

    // `*.rakit-editor.pages.dev` allows any subdomain Cloudflare assigns to that Pages
    // project. The leading dot is required so `evILrakit-editor.pages.dev` cannot match.
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1)
      return origin.endsWith(suffix) && origin.length > suffix.length
    }

    return false
  })
}

/** Prompt bounds. Applied to the trimmed value — see `checkPrompt` in services/generation.ts. */
export const PROMPT_MIN_LENGTH = 12
export const PROMPT_MAX_LENGTH = 4_000
