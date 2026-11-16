import { z } from 'zod'
import { projectSchema, type ParsedProject } from './contract'

/**
 * A validation failure that carries enough context for a user-facing message but never the
 * whole payload. Quoting the offending value is useful; quoting a user's business data into
 * a toast or a log is not.
 */
export class ContractError extends Error {
  readonly code = 'INVALID_SCHEMA' as const
  readonly issues: { path: string; message: string }[]

  constructor(issues: { path: string; message: string }[]) {
    const first = issues[0]
    super(first ? `${first.path}: ${first.message}` : 'Payload tidak valid')
    this.name = 'ContractError'
    this.issues = issues
  }
}

/** Truncate a value quoted in an error so a long body cannot flood a toast. */
const quote = (value: unknown): string => {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  if (s === undefined) return 'undefined'
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/**
 * Turn a Zod error into flat, user-legible issues.
 *
 * The one value worth naming explicitly is a rejected `kind`: "kind tidak dikenal" alone
 * tells a user nothing, while "kind tidak dikenal: iframe" tells them the model emitted
 * something the UI cannot render. Zod does not include the rejected value in its message,
 * so the raw payload is consulted for that path — by key, not by dumping the payload.
 */
export function toIssues(
  error: z.ZodError,
  raw?: unknown,
): { path: string; message: string }[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)'
    if (issue.path[issue.path.length - 1] === 'kind' && raw !== undefined) {
      const received = rawAt(raw, issue.path)
      if (received !== undefined) {
        return { path, message: `${issue.message}: ${quote(received)}` }
      }
    }
    return { path, message: issue.message }
  })
}

/** Walk a path through unknown data without trusting its shape. */
function rawAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let cursor: unknown = root
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<PropertyKey, unknown>)[key]
  }
  return cursor
}

/**
 * Parse one project. Throws `ContractError`; never returns a partially valid value.
 *
 * All-or-nothing is deliberate: dropping bad blocks would hide model misbehaviour during
 * early tuning, which is exactly when it is worth seeing.
 */
export function parseProject(raw: unknown): ParsedProject {
  if (raw === null || raw === undefined) {
    throw new ContractError([{ path: '(root)', message: 'payload is null or undefined' }])
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContractError([
      { path: '(root)', message: `expected an object, got ${quote(raw)}` },
    ])
  }
  const result = projectSchema.safeParse(raw)
  if (!result.success) throw new ContractError(toIssues(result.error, raw))
  return result.data
}

/** Parse a list of projects. One failure fails the list — see the note above. */
export function parseProjects(raw: unknown): ParsedProject[] {
  if (!Array.isArray(raw)) {
    throw new ContractError([
      { path: '(root)', message: `expected an array, got ${quote(raw)}` },
    ])
  }
  const result = z.array(projectSchema).safeParse(raw)
  if (!result.success) throw new ContractError(toIssues(result.error, raw))
  return result.data
}

/**
 * Escape hatch for the seed, which is authored in this repo rather than produced by a model.
 *
 * A failure here is a coding error, not user input, so it throws loudly at module load
 * instead of degrading to an empty app: an app that renders nothing is much harder to
 * diagnose than one that says exactly which seed field broke the contract.
 */
export function parseProjectsOrThrowAtStartup(raw: unknown): ParsedProject[] {
  try {
    return parseProjects(raw)
  } catch (error) {
    const detail = error instanceof ContractError ? error.message : String(error)
    throw new Error(`Seed data violates the block contract: ${detail}`)
  }
}
