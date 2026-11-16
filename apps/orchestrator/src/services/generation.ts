import {
  assembleProject,
  auditAccents,
  isRefusal,
  llmEnvelopeSchema,
  toIssues,
  type LlmEnvelope,
  type ParsedProject,
} from '@rakit/schema'
import type { LlmClient } from '../llm/client'
import { extractJsonObject } from '../llm/extract-json'
import {
  buildGenerateMessage,
  buildReviseMessage,
  buildSystemPrompt,
} from '../prompt/system-prompt'
import { ModelOutputError as BaseModelOutputError, badRequest } from '../errors'
import { PROMPT_MAX_LENGTH, PROMPT_MIN_LENGTH } from '../config'
import { logger } from '../logger'
import { projectId } from '../ids'

export interface GenerationUsage {
  inputTokens: number
  outputTokens: number
  durationMs: number
}

/**
 * The response body shape, fixed by M-6: `data` carries either `project` or `refusal`, and
 * `usage` alongside both.
 *
 * An earlier version used a `kind: 'project' | 'refusal'` tag. M-5 requires `data.refusal` to
 * be populated on a refusal, and a discriminator field would be a second, competing way for a
 * client to detect the same thing — the client would branch on `data.kind` and render nothing
 * when the field was renamed. Keying on the presence of `refusal` keeps one source of truth.
 */
export type GenerationOutcome =
  | { project: ParsedProject; usage: GenerationUsage }
  | { refusal: { reason: string }; usage: GenerationUsage }

/**
 * Prompt bounds, applied to the trimmed value.
 *
 * Trimming first is a deliberate choice with a consequence in both directions: not trimming
 * would reject honest input for invisible leading whitespace, and trimming means a 5 000
 * character run of spaces is measured as empty rather than as an over-length prompt. Both
 * bounds are then checked, so `"   "` fails PROMPT_TOO_SHORT and a long padded prompt still
 * fails PROMPT_TOO_LONG on its real length.
 */
export function checkPrompt(raw: string, field: string): string {
  const trimmed = raw.trim()

  if (trimmed.length < PROMPT_MIN_LENGTH) {
    throw badRequest(
      'PROMPT_TOO_SHORT',
      `Deskripsi minimal ${PROMPT_MIN_LENGTH} karakter agar skema bisa diturunkan.`,
      { field, minLength: PROMPT_MIN_LENGTH, actualLength: trimmed.length },
    )
  }

  if (trimmed.length > PROMPT_MAX_LENGTH) {
    throw badRequest(
      'PROMPT_TOO_LONG',
      `Deskripsi maksimal ${PROMPT_MAX_LENGTH} karakter.`,
      { field, maxLength: PROMPT_MAX_LENGTH, actualLength: trimmed.length },
    )
  }

  return trimmed
}

/**
 * A contract failure caused by the model's output, mapped to 422.
 *
 * `ContractError` alone is ambiguous: `assembleProject` throws it too, and that failure is a
 * bug in this process (500) rather than a bad answer from the provider (422). Distinguishing
 * them at the throw site is the only place that still knows which it is.
 */
export class ModelOutputError extends BaseModelOutputError {}

/**
 * Model text to a validated envelope, or a ModelOutputError explaining why not.
 *
 * The distinct detail for `finish_reason: "length"` is operationally important: truncated
 * output and a model that ignored the schema produce the same parse failure, and only the
 * former is fixed by raising `max_tokens`. It is attached to *both* failure paths — the
 * extractor and the schema — because truncation usually breaks the JSON itself, which is
 * exactly the path that would otherwise swallow the hint.
 */
export function parseEnvelope(content: string, finishReason: string | undefined): LlmEnvelope {
  const truncated = finishReason === 'length'
  const truncationNote = {
    path: '(root)',
    message: 'Balasan model terpotong sebelum JSON selesai.',
  }

  const extracted = extractJsonObject(content)

  if (!extracted.ok) {
    logger.warn('llm.output.not-json', {
      reason: extracted.reason,
      finishReason,
      contentLength: content.length,
    })
    throw new ModelOutputError([
      ...(truncated ? [truncationNote] : []),
      {
        path: '(root)',
        message:
          extracted.reason === 'unbalanced'
            ? 'Objek JSON tidak lengkap di dalam balasan model.'
            : 'Model tidak mengembalikan objek JSON.',
      },
    ])
  }

  const result = llmEnvelopeSchema.safeParse(extracted.value)
  if (!result.success) {
    const issues = toIssues(result.error, extracted.value)
    if (truncated) issues.unshift(truncationNote)

    logger.warn('llm.output.invalid', {
      finishReason,
      issuePaths: issues.map((i) => i.path),
    })
    throw new ModelOutputError(issues)
  }

  return result.data
}

export async function generateProject(
  client: LlmClient,
  rawPrompt: string,
  signal: AbortSignal,
): Promise<GenerationOutcome> {
  const prompt = checkPrompt(rawPrompt, 'prompt')
  const started = Date.now()

  const completion = await client.complete({
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildGenerateMessage(prompt) }],
    maxTokens: 8_000,
    signal,
  })

  const envelope = parseEnvelope(completion.content, completion.finishReason)
  const usage: GenerationUsage = {
    inputTokens: completion.usage.inputTokens,
    outputTokens: completion.usage.outputTokens,
    durationMs: Date.now() - started,
  }

  if (isRefusal(envelope)) {
    return { refusal: { reason: envelope.refusal.reason }, usage }
  }

  const project = assembleProject(envelope, { id: projectId(), prompt })

  // A warn only, never a failure: an unusable accent is already rejected by the schema, so
  // anything reported here is a prompt-tuning signal rather than a defect.
  const strayAccents = auditAccents(envelope)
  if (strayAccents.length > 0) {
    logger.warn('llm.output.stray-accent', { count: strayAccents.length })
  }

  return { project, usage }
}

export async function reviseProject(
  client: LlmClient,
  currentProject: unknown,
  rawInstruction: string,
  signal: AbortSignal,
): Promise<GenerationOutcome> {
  const instruction = checkPrompt(rawInstruction, 'instruction')
  const started = Date.now()

  const completion = await client.complete({
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildReviseMessage(currentProject, instruction) }],
    maxTokens: 12_000,
    signal,
  })

  const envelope = parseEnvelope(completion.content, completion.finishReason)
  const usage: GenerationUsage = {
    inputTokens: completion.usage.inputTokens,
    outputTokens: completion.usage.outputTokens,
    durationMs: Date.now() - started,
  }

  if (isRefusal(envelope)) {
    return { refusal: { reason: envelope.refusal.reason }, usage }
  }

  const project = assembleProject(envelope, { id: projectId(), prompt: instruction })

  /**
   * Dropped screens are logged, not repaired. Splicing the old screens back in would make a
   * model that ignored half the input look like it succeeded, and M-7 wants that visible.
   * The client keeps its pre-revision state on failure, so nothing is lost either way.
   */
  const dropped = droppedScreenIds(currentProject, envelope)
  if (dropped.length > 0) {
    logger.warn('llm.revision.dropped-screens', { count: dropped.length, ids: dropped })
  }

  return { project, usage }
}

export function droppedScreenIds(
  before: unknown,
  after: { screens: { id: string }[] },
): string[] {
  if (before === null || typeof before !== 'object') return []

  const prior = (before as { screens?: { id?: unknown }[] }).screens
  if (!Array.isArray(prior)) return []

  const afterIds = new Set(after.screens.map((s) => s.id))
  return prior
    .map((s) => s?.id)
    .filter((id): id is string => typeof id === 'string' && !afterIds.has(id))
}
