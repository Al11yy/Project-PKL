import { projectSchema, type ParsedProject } from '@rakit/schema'

/**
 * The client for the orchestrator.
 *
 * The server never returns a project the editor has not checked. It validates on the way in,
 * but that check is about *its* contract; this one is about what is allowed into the editor's
 * state, and it stays even though the two agree today. The orchestrator is a separate process
 * that can be redeployed, proxied, or replaced with a fake, and a payload that parses here is
 * the only kind the preview is built to render — a bad tree reaching state would crash the
 * preview rather than show an error, which is the failure the guard exists to prevent.
 *
 * Errors carry the server's `code` rather than only a message: the caller branches on it
 * (`REVISION_DROPPED_DATA` needs different copy from `INVALID_SCHEMA`), and flattening that to
 * a string would force the caller to match on prose.
 */

/** The response envelope from `conventions.md`, mirrored from the orchestrator. */
interface Envelope<T> {
  data: T | null
  error: { code: string; message: string; details?: unknown } | null
}

/**
 * A failure the server described. `code` is the contract's code, not an HTTP status — the
 * status is one number for many meanings, and the caller cares about which meaning.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * A failure with no server answer: the orchestrator is down, unreachable, or not running at
 * all. Kept apart from `ApiError` because the remedy differs — this one is worth retrying
 * once the server is up, while a rejected payload is not.
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * The dev server proxies `/api` to the orchestrator, so the browser sees one origin and no
 * CORS preflight is involved. `VITE_ORCHESTRATOR_URL` overrides it for a deployed editor
 * that talks to a server elsewhere.
 */
const BASE = import.meta.env.VITE_ORCHESTRATOR_URL ?? ''

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    // A caller abort is not a network fault; rethrown so the caller can tell them apart.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError('Tidak dapat menghubungi server. Pastikan orchestrator berjalan.')
  }

  let envelope: Envelope<T>
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    // A proxy or crash can answer with HTML. Reported as such rather than as a JSON parse
    // error, which would name the symptom instead of the cause.
    throw new NetworkError(`Server membalas dengan format tak dikenal (HTTP ${response.status}).`)
  }

  if (envelope.error !== null) {
    throw new ApiError(
      envelope.error.code,
      envelope.error.message,
      response.status,
      envelope.error.details,
    )
  }

  if (envelope.data === null) {
    throw new NetworkError('Server membalas tanpa data.')
  }

  return envelope.data
}

/**
 * Validate before returning. `safeParse` rather than `parse` so the failure carries every
 * issue at once — a tree with three problems should report three, not whichever Zod reached
 * first, because the user fixes them in one pass.
 */
function asProject(candidate: unknown): ParsedProject {
  const result = projectSchema.safeParse(candidate)
  if (!result.success) {
    throw new ApiError(
      'UNRENDERABLE_PAYLOAD',
      'Server mengembalikan proyek yang tidak dapat dirender.',
      200,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return result.data
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  durationMs: number
}

export interface GenerationResult {
  project: ParsedProject
  usage: Usage
}

/**
 * Generate a project from a description.
 *
 * A refusal comes back as `data.project` being absent with `data.refusal` set, so it is
 * surfaced as an `ApiError` with the model's own reason: the caller's refund path is the same
 * for any failure, and inventing a second shape for it would mean two failure paths to test.
 */
export async function generateProject(
  prompt: string,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  const data = await post<{ project?: unknown; refusal?: { reason: string }; usage: Usage }>(
    '/api/v1/generate',
    { prompt },
    signal,
  )

  if (data.project === undefined) {
    throw new ApiError(
      'LLM_REFUSED',
      data.refusal?.reason ?? 'Model menolak permintaan ini.',
      200,
    )
  }

  return { project: asProject(data.project), usage: data.usage }
}

/** Revise an existing project. `project` is the tree the user is currently holding. */
export async function reviseProject(
  project: ParsedProject,
  instruction: string,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  const data = await post<{ project?: unknown; refusal?: { reason: string }; usage: Usage }>(
    '/api/v1/revise',
    { project, instruction },
    signal,
  )

  if (data.project === undefined) {
    throw new ApiError(
      'LLM_REFUSED',
      data.refusal?.reason ?? 'Model menolak permintaan ini.',
      200,
    )
  }

  return { project: asProject(data.project), usage: data.usage }
}
