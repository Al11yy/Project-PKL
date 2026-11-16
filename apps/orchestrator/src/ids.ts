import { createHash, randomUUID } from 'node:crypto'

/**
 * Server-generated project id.
 *
 * Generated here rather than accepted from the model because a model-supplied id is
 * indistinguishable from a real one once it is in React state — the exact confusion
 * `llmProjectSchema` exists to prevent.
 *
 * The `p-` prefix must satisfy `idSchema` in `@rakit/schema` (`^[A-Za-z0-9_.:-]+$`, max 64
 * characters). A UUID's hyphens are allowed by that pattern, and the prefix keeps a
 * generated id recognisable in a log or a seed file.
 */
export const projectId = (): string => `p-${randomUUID()}`

/**
 * Short correlation id for logs.
 *
 * Eight hex characters: enough to follow one request through a log, not a security token.
 * Never used for authorisation or as a project identifier.
 */
export const requestId = (): string => randomUUID().slice(0, 8)

/**
 * Stable short hash of a prompt, for correlating a validation failure with the input that
 * produced it.
 *
 * M-5 requires the prompt hash in the warn line, and a hash rather than the prompt is the
 * point: the prompt is the user's business text. Twelve hex characters is enough to group
 * identical prompts in a log without being a way to read them back.
 *
 * `sha256` rather than a fast non-cryptographic hash so that a hash of a short, guessable
 * prompt cannot be reversed by brute force — "kasir" has few enough variants that a weak
 * hash would be a redaction in name only.
 */
export const promptHash = (prompt: string): string =>
  createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 12)
