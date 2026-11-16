export const COIN_COST = {
  generate: 20,
  revise: 5,
  manualEdit: 0,
  publish: 50,
} as const

export type PipelineStage = 'prompt' | 'schema' | 'ui' | 'edit' | 'publish'

export const PIPELINE: { id: PipelineStage; label: string }[] = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'schema', label: 'Skema' },
  { id: 'ui', label: 'UI' },
  { id: 'edit', label: 'Edit' },
  { id: 'publish', label: 'Terbit' },
]

export type StageState = 'done' | 'active' | 'pending'

export interface Column {
  name: string
  type: 'INTEGER' | 'TEXT' | 'REAL' | 'BOOLEAN'
  primary?: boolean
  nullable?: boolean
  note?: string
}

export interface Table {
  name: string
  columns: Column[]
  rows: number
}

export type BlockKind = 'navbar' | 'stat' | 'table' | 'form' | 'card' | 'chart'

export interface UIBlock {
  id: string
  kind: BlockKind
  /** Text the inspector may edit. Never markup. */
  title?: string
  /** Editable copy lines, in reading order. */
  body?: string
  /** Editable accent for this block, drawn from the palette. */
  accent?: string
}

export interface Screen {
  id: string
  name: string
  blocks: UIBlock[]
}

export interface Project {
  id: string
  name: string
  slug: string
  prompt: string
  tables: Table[]
  screens: Screen[]
  tablesCount: number
  screensCount: number
  status: 'draft' | 'live'
  updatedAt: string
}

export interface LedgerEntry {
  id: string
  at: string
  label: string
  detail: string
  coins: number
  outcome: 'spent' | 'free' | 'refunded' | 'failed'
  refId: string
}
