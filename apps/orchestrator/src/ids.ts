import { randomUUID } from 'node:crypto'

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
