import { Hono } from 'hono'
import { z } from 'zod'
import { projectSchema } from '@rakit/schema'
import type { LlmClient } from '../llm/client'
import { LlmError, LlmTimeoutError } from '../llm/errors'
import { generateProject, reviseProject } from '../services/generation'
import { badRequest } from '../errors'
import type { Env } from '../config'

/**
 * Request bodies.
 *
 * `z.object` strips unknown keys, so `{"prompt": "...", "model": "gpt-4"}` loses `model`
 * and the server's configured model is used. Model selection is not a client decision:
 * letting a caller name the model is letting a caller choose what it costs us.
 *
 * Length bounds are deliberately NOT enforced here. A `.min()`/`.max()` on this schema would
 * reject an over-length prompt with a generic `INVALID_REQUEST` before `checkPrompt` ever
 * runs, turning the specific `PROMPT_TOO_SHORT`/`PROMPT_TOO_LONG` codes — the ones a client
 * can act on — into dead code. Only the type is checked here; the service owns the bounds,
 * applied to the trimmed value, so the two checks cannot disagree.
 */
const generateRequestSchema = z.object({
  prompt: z.string(),
})

const reviseRequestSchema = z.object({
  project: projectSchema,
  instruction: z.string(),
})

/**
 * A body that failed to parse is reported as INVALID_REQUEST rather than allowed to throw.
 *
 * Under Express a malformed body surfaced as a middleware error; Hono's `c.req.json()` simply
 * rejects. Catching it here keeps the promise the envelope makes — every failure has a `code`
 * a client can branch on — instead of letting a SyntaxError become an opaque 500.
 */
async function readJson(c: {
  req: { json: () => Promise<unknown> }
}): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw badRequest('INVALID_REQUEST', 'Isi permintaan tidak valid.')
  }
}

function parseBody<T>(schema: z.ZodType<T>, raw: unknown, field: string): T {
  const result = schema.safeParse(raw)

  if (!result.success) {
    throw badRequest(`INVALID_REQUEST`, `Field "${field}" tidak valid.`, {
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
    })
  }

  return result.data
}

/**
 * An AbortController that also fires on a deadline.
 *
 * Q-2 requires that *no* code path awaits the provider without an active AbortController
 * timeout. Leaving that to the adapter is not enough: the adapter's timer is its own
 * implementation detail, so any client that does not enforce one — a fake, or a future
 * adapter someone writes in a hurry — hangs the request until the socket dies. The deadline
 * belongs to the caller that owns the controller, which is here.
 *
 * The adapter keeps its own per-attempt timeout for retries; this is the outer bound that
 * spans the whole request, including backoff.
 *
 * `unref` is gone. It existed so a pending deadline would not hold a Node process open at
 * shutdown; Workers have no process to hold open, and `unref` does not exist there. The
 * optional call was a silent no-op on the Worker — deleting it removes a line that told a
 * reader something untrue about the runtime.
 */
function abortAfter(ms: number): {
  signal: AbortSignal
  abort: () => void
  dispose: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new LlmTimeoutError(ms))
  }, ms)
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    dispose: () => clearTimeout(timer),
  }
}

/**
 * The default deadline, matching `LLM_TIMEOUT_MS`'s fallback in `loadLlmConfig()`. Read as a
 * constant rather than by calling `loadLlmConfig()`, which would demand the API key and base
 * URL just to import this module — the tests import it with no environment at all.
 */
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Run a provider call under the deadline, converting our own timeout into a 504.
 *
 * The adapter raises `LlmTimeoutError` for its per-attempt deadline, but a client that does
 * not enforce its own timeout surfaces a bare `AbortError` when *this* deadline fires — and a
 * bare AbortError maps to a generic 500, reporting a slow provider as a bug in this process.
 * Translating here means the bound holds for any `LlmClient`, not only the one adapter that
 * happens to be careful.
 */
async function underDeadline<T>(
  deadline: AbortSignal,
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (deadline.aborted) {
      throw error instanceof LlmError ? error : new LlmTimeoutError(timeoutMs)
    }
    throw error
  }
}

/**
 * The `/api/v1` surface.
 *
 * `client` is injected so tests can drive the routes without a provider. `env` is read at
 * request time rather than captured, because on a Worker the API key is a secret binding that
 * is not available at module scope.
 */
export function createRouter(
  client: LlmClient,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Hono<{ Bindings: Env }> {
  const router = new Hono<{ Bindings: Env }>()

  router.get('/health', (c) => {
    /**
     * Reports whether the key is present, never what it is, and does not call the provider.
     * A health check that spends tokens is a health check that gets disabled.
     *
     * Read from `c.env`, not `process.env`: on the Worker the key is a secret binding.
     */
    return c.json({
      data: { status: 'ok', llmConfigured: Boolean(c.env?.LLM_KITA_API_KEY) },
      error: null,
    })
  })

  router.post('/generate', async (c) => {
    const body = parseBody(generateRequestSchema, await readJson(c), 'prompt')

    /**
     * Two ways this call ends early: the deadline, and the client hanging up. Hono exposes
     * the request signal, so a disconnect aborts the provider call instead of leaving it to
     * spend tokens for a response nobody will read.
     */
    const { signal, abort, dispose } = abortAfter(timeoutMs)
    c.req.raw.signal.addEventListener('abort', () => abort())

    try {
      const outcome = await underDeadline(
        signal,
        () => generateProject(client, body.prompt, signal),
        timeoutMs,
      )
      return c.json({ data: outcome, error: null })
    } finally {
      dispose()
    }
  })

  router.post('/revise', async (c) => {
    const body = parseBody(reviseRequestSchema, await readJson(c), 'instruction')

    const { signal, abort, dispose } = abortAfter(timeoutMs)
    c.req.raw.signal.addEventListener('abort', () => abort())

    try {
      const outcome = await underDeadline(
        signal,
        () => reviseProject(client, body.project, body.instruction, signal),
        timeoutMs,
      )
      return c.json({ data: outcome, error: null })
    } finally {
      dispose()
    }
  })

  return router
}
