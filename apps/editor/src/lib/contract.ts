/**
 * Moved to `@rakit/schema` so the orchestrator can validate against the same whitelist.
 *
 * This shim exists so the move did not have to land as one enormous diff across the
 * editor. It re-exports rather than redefines: if it duplicated anything, the whitelist
 * would have two homes and drift — the exact failure `WHITELISTED_KINDS` exists to prevent.
 *
 * Delete this file once the editor's import sites point at `@rakit/schema` directly.
 */
export * from '@rakit/schema'
