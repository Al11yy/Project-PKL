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

/** Prompt bounds. Applied to the trimmed value — see `checkPrompt` in services/generation.ts. */
export const PROMPT_MIN_LENGTH = 12
export const PROMPT_MAX_LENGTH = 4_000
