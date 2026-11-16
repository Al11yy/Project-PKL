/**
 * Configuration, read once at startup and validated.
 *
 * Read eagerly rather than lazily on first use: a missing API key should stop the process
 * with a message naming the variable, not surface as a 502 on the first user request.
 * `conventions.md` requires an explicit timeout on every external call, so the timeout is
 * configuration with a stated default rather than a literal buried in the client.
 */
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

const required = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(
      `Missing required environment variable ${name}. Copy .env.example and fill it in.`,
    )
  }
  return value
}

const positiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${raw}"`)
  }
  return parsed
}

export function loadLlmConfig(): LlmConfig {
  return {
    apiKey: required('LLM_KITA_API_KEY'),
    // Trailing slashes stripped so the client can append `/chat/completions`
    // unconditionally without producing a double slash.
    baseUrl: required('LLM_KITA_BASE_URL').replace(/\/+$/, ''),
    model: required('LLM_KITA_MODEL'),
    timeoutMs: positiveInt('LLM_TIMEOUT_MS', 60_000),
    maxTokensGenerate: positiveInt('LLM_MAX_TOKENS_GENERATE', 8_000),
    maxTokensRevise: positiveInt('LLM_MAX_TOKENS_REVISE', 12_000),
  }
}

export interface ServerConfig {
  port: number
}

/**
 * Port 5181, not 5180: the editor's Vite server owns 5180 with `strictPort: true`, so a
 * collision is a hard startup failure rather than a fallback to another port.
 */
export function loadServerConfig(): ServerConfig {
  return { port: positiveInt('PORT', 5_181) }
}

/** Prompt bounds. Applied to the trimmed value — see `checkPrompt` in services/generation.ts. */
export const PROMPT_MIN_LENGTH = 12
export const PROMPT_MAX_LENGTH = 4_000
