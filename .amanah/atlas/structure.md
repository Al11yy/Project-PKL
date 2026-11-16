# AI-First App Builder for Indonesia — Project Structure & Patterns

> **Regenerated from code on 2026-07-15.** The previous version described a target tree
> that did not exist. The editor portion below is now the **actual** tree; the backend
> portion is still aspirational and marked as such.

## Directory Layout (actual)

```
D:\PKL\Project
├── .amanah/
│   ├── atlas/                       Project context maps (this folder)
│   ├── blueprints/                  ** does not exist yet **
│   ├── commands/, SKILL.md, AGENT.md  Framework install sources
├── .claude/
│   ├── commands/                    Installed slash commands (12)
│   ├── agents/                      4 impeccable agents
│   └── skills/impeccable/           Skill + reference docs + scripts
├── .impeccable/
│   └── surfaces/editor-builder.md   Surface spec
├── apps/
│   └── editor/                      ** THE ONLY APP **
│       ├── .shots/                  Playwright harness + screenshots (png gitignored)
│       │   ├── verify.mjs           overflow + console errors at 3 widths
│       │   ├── flow.mjs             free-inspect / fail+refund / publish
│       │   └── shot.mjs             screenshots
│       ├── dist/                    build output (gitignored)
│       ├── src/
│       │   ├── App.tsx              Shell composition + view switch
│       │   ├── main.tsx             React root
│       │   ├── index.css            Tailwind layers + base/browser surfaces
│       │   ├── components/
│       │   │   ├── shell/           TopBar, Pipeline, PromptRow, Rail
│       │   │   ├── preview/         Preview (+ NavBlock/StatBlock/TableBlock inline)
│       │   │   ├── inspector/       Inspector — the free visual editor
│       │   │   ├── views/           SchemaView, LedgerView
│       │   │   └── ui/              Button, Icons, Toasts
│       │   ├── lib/
│       │   │   ├── types.ts         Domain contracts + COIN_COST + PIPELINE
│       │   │   └── seed.ts          Synthetic demo data
│       │   └── store/
│       │       └── useBuilder.ts    ALL state + ALL actions
│       ├── index.html
│       ├── tailwind.config.js       Design tokens
│       ├── vite.config.ts           port 5180, strictPort
│       └── tsconfig.json
├── scripts/
│   ├── sync-confluence.mjs          Docs → Confluence (dry run by default)
│   └── README-confluence.md
├── CLAUDE.md, PRODUCT.md, KNOWLEDGE_BASE.md, TODO.md
├── prd_ai_first_app_builder.md      Requirements source of truth
└── .gitignore
```

### Planned but not created

Do not cite these as existing. Create them only when their blueprint is approved.

```
apps/orchestrator/          Express.js — auth, coins, LLM-Kita, Cloudflare API
packages/schema/            Shared Zod contracts (LLM JSON, PRD shapes)
packages/generator/         DDL + Worker source templates
templates/worker/           Per-project Worker template
apps/editor/src/components/impeccable/   Whitelisted component library
apps/editor/src/mapper/                  Should be extracted from Preview.tsx
```

## Code Patterns Actually In Use

### Single-store pattern

All state and behaviour live in `apps/editor/src/store/useBuilder.ts`. There is no service
layer. Components read via selectors and call actions directly:

```ts
const view = useBuilder((s) => s.view)
const balance = useBuilder((s) => s.balance())
const topUp = useBuilder((s) => s.topUp)
```

Selectors that compute (`balance()`, `activeProject()`) are **called**, not read — they are
functions on the state object, deliberately, so the balance is never a cacheable stored value.

### Derived balance — do not break this

```ts
// useBuilder.ts
const STARTER_BALANCE_BASE = STARTER_BALANCE - SEED_LEDGER.reduce((s, e) => s + e.coins, 0)
const balanceOf = (ledger) => ledger.reduce((sum, e) => sum + e.coins, STARTER_BALANCE_BASE)
```

`STARTER_BALANCE_BASE` auto-adjusts as seed entries change, so the demo always reconciles
to `STARTER_BALANCE` (128). Never introduce a stored `balance` field to "simplify" this.

### Block-kind switch (a mapper in embryo)

`ScreenView` in `Preview.tsx` branches on `block.kind`. This is the JSON-to-component
mapper, but unvalidated and partial — see Gotchas.

```ts
const nav = screen.blocks.find((b) => b.kind === 'navbar')
const stats = screen.blocks.filter((b) => b.kind === 'stat')
const rest = screen.blocks.filter((b) => b.kind !== 'navbar' && b.kind !== 'stat')
```

### Free-edit invariant

`updateBlock` (`useBuilder.ts`) maps over `projects` only. It never touches `ledger`. Any
refactor of the inspector must keep the ledger out of that code path — this is a product
promise, not an implementation detail.

### Thin-simulation seam

`runGeneration`, `runRevision`, `runPublish`, `topUp` are the four functions that fake
network calls with `setTimeout`. When the orchestrator lands, these are the functions to
replace. Nothing else in the editor knows the backend does not exist.

## Critical Rules

1. All LLM output must be validated by Zod before it touches React state. **Not yet true** —
   no Zod in the codebase, and no LLM to validate. Add the schema before adding the call.
2. Coin deduction completes before the LLM call; failed calls are refunded. **True in
   memory**, not guaranteed against concurrency or process death.
3. Every Cloudflare resource namespaced per project id (D1 name, Worker name, Pages project).
4. Generated SQL identifiers sanitized; no dynamic SQL from prompt text.
5. Secrets live in env / Cloudflare secrets only.
6. Every external call has an explicit timeout. (`scripts/sync-confluence.mjs` implements
   this at 20s; the editor makes no external calls.)

## Gotchas Discovered From Reading The Code

| Gotcha | Detail |
|--------|--------|
| **Three block kinds never render** | `BlockKind` declares `form`, `card`, `chart`, but `Preview.tsx` renders only `navbar`, `stat`, `table`. Seed data uses only those three. `form`/`card`/`chart` are dead type surface — a real gap, since the PRD lists Form and Card as core components. |
| **No router** | `App.tsx` switches on `view` from the store. No URL can address a view; reload loses everything. |
| **All state is ephemeral** | No persistence of any kind. Refresh resets to seed. |
| **Tailwind has no "project name truncation" guard** | `TopBar` hides meta below 1400px so the name stays whole; lowering that breakpoint re-introduces truncation at 1280px. |
| **Port is pinned** | `vite.config.ts` uses `strictPort: true` on 5180. A stale server causes "Port already in use", not a fallback port. |
| **`hasGenerated` starts `true`** | `useBuilder.ts` initialises it `true`, so a fresh session shows a finished app rather than an empty state. Intentional for the demo, misleading for a real new user. |
| **Screenshot output must stay gitignored** | `.gitignore` uses `**/.shots/*.png` — the `**/` prefix is required, because a slash-containing pattern is anchored to the `.gitignore`'s own directory. |

## Key File Locations

| Need to… | Look at |
|----------|---------|
| Change what the product must do | `prd_ai_first_app_builder.md` |
| Change UI copy or component behaviour | `apps/editor/src/components/` |
| Change coin prices or domain types | `apps/editor/src/lib/types.ts` (`COIN_COST`) |
| Change ledger behaviour or run actions | `apps/editor/src/store/useBuilder.ts` |
| Change the demo data | `apps/editor/src/lib/seed.ts` |
| Change design tokens | `apps/editor/tailwind.config.js` |
| Understand the system as built | `KNOWLEDGE_BASE.md` |
| See what is next | `TODO.md` |
| Read project context | `.amanah/atlas/*.md` |
