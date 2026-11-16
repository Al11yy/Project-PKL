import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { projectSchema } from '@rakit/schema'
import type { LlmClient } from '../llm/client'
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

export function createRouter(client: LlmClient): Router {
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

      // Abort the provider call if the client hangs up: nobody is waiting for the answer,
      // and the tokens are being paid for either way.
      const controller = new AbortController()
      res.on('close', () => controller.abort())

      const outcome = await generateProject(client, body.prompt, controller.signal)
      res.json({ data: outcome, error: null })
    }),
  )

  router.post(
    '/revise',
    asyncHandler(async (req, res) => {
      const body = parseBody(reviseRequestSchema, req, 'instruction')

      const controller = new AbortController()
      res.on('close', () => controller.abort())

      const outcome = await reviseProject(
        client,
        body.project,
        body.instruction,
        controller.signal,
      )
      res.json({ data: outcome, error: null })
    }),
  )

  return router
}
