import type {
  BlockKind,
  ParsedColumn,
  ParsedProject,
  ParsedScreen,
  ParsedTable,
  ParsedUIBlock,
} from './contract'

/**
 * Structural types come from the Zod schema — the schema is the definition and these are
 * its shadows. Keeping the union in one place means the whitelist, the runtime check and
 * the TypeScript type cannot drift apart.
 */
export type { BlockKind }
export type UIBlock = ParsedUIBlock
export type Screen = ParsedScreen
export type Project = ParsedProject
export type Table = ParsedTable
export type Column = ParsedColumn

export type PipelineStage = 'prompt' | 'schema' | 'ui' | 'edit' | 'publish'

export const PIPELINE: { id: PipelineStage; label: string }[] = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'schema', label: 'Skema' },
  { id: 'ui', label: 'UI' },
  { id: 'edit', label: 'Edit' },
  { id: 'publish', label: 'Terbit' },
]

export type StageState = 'done' | 'active' | 'pending'
