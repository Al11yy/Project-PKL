import type { LlmClient, LlmCompletion, LlmRequest } from '../llm/client'

/**
 * A client that returns whatever it is told, in order, and records every call.
 *
 * The entire orchestrator suite runs against this, which is why `LlmClient` has exactly one
 * method: every fake stays trivial, and no test touches the network. Phase tuning — invalid
 * kinds, truncated JSON, refusals — becomes a matter of writing a string, not standing up a
 * fake HTTP server.
 */
export class ScriptedLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = []

  constructor(
    private readonly script: (callIndex: number) => Promise<LlmCompletion> | LlmCompletion,
  ) {}

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const index = this.calls.length
    this.calls.push(request)
    return this.script(index)
  }
}

/** Convenience for the common case: a client that always returns the same content. */
export const clientReturning = (
  content: string,
  options: { finishReason?: string; inputTokens?: number; outputTokens?: number } = {},
): ScriptedLlmClient =>
  new ScriptedLlmClient(() => ({
    content,
    finishReason: options.finishReason ?? 'stop',
    usage: {
      inputTokens: options.inputTokens ?? 100,
      outputTokens: options.outputTokens ?? 200,
    },
  }))

/** A client that never resolves, for timeout property tests. */
export const hangingClient = (): ScriptedLlmClient =>
  new ScriptedLlmClient(
    () =>
      new Promise<LlmCompletion>((_resolve, reject) => {
        // Reject only when the caller aborts, mirroring a real fetch.
        setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 5_000)
      }),
  )

/**
 * A minimal valid envelope body. Deliberately includes no server-owned fields — if one
 * leaked into the response, the corresponding test would catch assembleProject passing it
 * through rather than generating it.
 */
export function validLlmProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Kasir Klinik Sehat',
    slug: 'kasir-klinik-sehat',
    tables: [
      {
        name: 'pasien',
        columns: [
          { name: 'id', type: 'INTEGER', primary: true },
          { name: 'nama', type: 'TEXT' },
        ],
        rows: 3,
      },
    ],
    screens: [
      {
        id: 's-kasir',
        name: 'Kasir',
        blocks: [
          { id: 'b-nav', kind: 'navbar', title: 'Kasir', body: 'Kasir · Pasien' },
        ],
      },
    ],
    ...overrides,
  }
}

export const validProjectJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify(validLlmProject(overrides))

/** A full client-facing project, for the revise request body. */
export function clientProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p-existing-123',
    ...validLlmProject(),
    prompt: 'sistem kasir untuk klinik',
    tablesCount: 1,
    screensCount: 1,
    status: 'draft',
    updatedAt: 'baru saja',
    ...overrides,
  }
}
