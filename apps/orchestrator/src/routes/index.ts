import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { projectSchema } from '@rakit/schema'
import type { LlmClient } from '../llm/client'
import { LlmError, LlmTimeoutError } from '../llm/errors'
import { generateProject, reviseProject } from '../services/generation'
import { badRequest } from '../errors'


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

function parseBody<T>(schema: z.ZodType<T>, req: Request, field: string): T {
  const result = schema.safeParse(req.body)

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
 * Wrap an async handler so a rejected promise reaches the error middleware.
 *
 * Express 4 does not await handlers: without this, a thrown error in an async function
 * becomes an unhandled rejection and the request hangs until it times out. Express 5 would
 * handle it, but the dependency is pinned to 4.
 */
const asyncHandler =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next)
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
  // `unref` so a pending deadline never keeps the process alive on shutdown.
  timer.unref?.()
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
 *
 * A client that hung up is deliberately not a 504: nobody is waiting for that response, and
 * `res` is already closed. Re-throwing lets the normal path settle without a send.
 */
async function underDeadline<T>(
  deadline: AbortSignal,
  clientGone: () => boolean,
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (deadline.aborted && !clientGone()) {
      throw error instanceof LlmError ? error : new LlmTimeoutError(timeoutMs)
    }
    throw error
  }
}

export function createRouter(client: LlmClient, timeoutMs: number = DEFAULT_TIMEOUT_MS): Router {
  const router = Router()

  router.get('/health', (_req: Request, res: Response) => {
    /**
     * Reports whether the key is present, never what it is, and does not call the provider.
     * A health check that spends tokens is a health check that gets disabled.
     */
    res.json({
      data: { status: 'ok', llmConfigured: Boolean(process.env.LLM_KITA_API_KEY) },
      error: null,
    })
  })

  router.post(
    '/generate',
    asyncHandler(async (req, res) => {
      const body = parseBody(generateRequestSchema, req, 'prompt')

      /**
       * Two ways this call ends early: the deadline, and the client hanging up. Both abort
       * the same signal, because either way nobody is waiting for the answer and the tokens
       * are being paid for regardless.
       */
      const { signal, abort, dispose } = abortAfter(timeoutMs)
      res.on('close', () => {
        abort()
        dispose()
      })

      try {
        const outcome = await underDeadline(
          signal,
          () => res.writableEnded,
          () => generateProject(client, body.prompt, signal),
          timeoutMs,
        )
        res.json({ data: outcome, error: null })
      } finally {
        dispose()
      }
    }),
  )

  router.post(
    '/revise',
    asyncHandler(async (req, res) => {
      const body = parseBody(reviseRequestSchema, req, 'instruction')

      const { signal, abort, dispose } = abortAfter(timeoutMs)
      res.on('close', () => {
        abort()
        dispose()
      })

      try {
        const outcome = await underDeadline(
          signal,
          () => res.writableEnded,
          () => reviseProject(client, body.project, body.instruction, signal),
          timeoutMs,
        )
        res.json({ data: outcome, error: null })
      } finally {
        dispose()
      }
    }),
  )

  return router
}
