# CLAUDE.md

Project instructions for AI agents working in this repository.

## Project

**AI-First App Builder for Indonesia** — a low-code/no-code platform where users describe
an app in plain language and AI generates the database schema plus a working full-stack
app, deployed to Cloudflare.

The complete requirements live in [prd_ai_first_app_builder.md](prd_ai_first_app_builder.md).
That document is the source of truth for *what* to build.

**Current state: working monorepo, pre-MVP.** Code exists for the editor, the
orchestrator, and the shared contract. Still absent: persistence, auth, coin ledger,
Cloudflare provisioning, and Midtrans. Do not assume a file exists — verify with
glob/grep before citing a path.

### Workspace layout

npm workspaces, root `package.json` owns the scripts.

```
apps/editor/         @rakit/editor        Vite + React + Tailwind + Zustand
apps/orchestrator/   @rakit/orchestrator  Express + TypeScript; LLM client, routes, services
packages/schema/     @rakit/schema        Zod contract shared by both apps
tools/               dev harnesses (see below), not published
```

| What is built | Evidence |
|---------------|----------|
| Editor UI, 4 views (editor / skema / riwayat) | `apps/editor/src/components/` |
| Component whitelist + Zod contract | `packages/schema/src/contract.ts` |
| Orchestrator HTTP surface | `apps/orchestrator/src/routes/` |
| LLM provider seam (OpenAI-compatible) | `apps/orchestrator/src/llm/` |
| System prompt builder | `apps/orchestrator/src/prompt/` |
| Unit tests (144 across 7 files) | `**/*.test.ts` |

| What is NOT built | Consequence |
|-------------------|-------------|
| Persistence of any kind | State is in-memory; reload loses work |
| Auth | Do not expose the orchestrator |
| Coin ledger on the server | `COIN_COST` is a client constant; nothing enforces it |
| Cloudflare D1 / Workers / Pages | Publish is simulated |
| Midtrans | `topUp()` credits locally with no verification |
| `packages/generator/` | DDL generation has no home yet |

`@rakit/schema` is imported as source (`"main": "./src/index.ts"`), not built to `dist/`.
TypeScript resolves it directly, so there is no build step between the packages.

### Dev commands (root)

```bash
npm run dev:all        # editor + orchestrator together
npm test               # vitest across all workspaces
npm run typecheck      # tsc --noEmit across all workspaces
npm run fake-llm       # stub LLM provider, no API key needed
npm run smoke          # end-to-end smoke against the fake provider
npm run smoke:refusal  # asserts the model's refusals surface correctly
npm run check:branches # guard for the ID-preservation invariants
```

The editor also runs standalone: `cd apps/editor && npm run dev` (port 5180,
`strictPort` — a second instance fails rather than picking another port).

### Locked stack decisions

| Layer | Choice |
|-------|--------|
| Frontend editor | Vite + React + Tailwind CSS + Zustand (Cloudflare Pages) |
| Backend core | Express.js (Node.js + TypeScript) |
| AI engine | API LLM-Kita (strict JSON output) |
| User project DB | Cloudflare D1 (one database per project) |
| User project compute | Cloudflare Workers |
| Payments | Midtrans (QRIS / Virtual Account), IDR prepaid coins |

### Non-negotiable rules

1. **The LLM never emits HTML or JS.** It returns JSON validated by Zod and mapped only to
   whitelisted Impeccable Style components. Reject unknown components.
2. **Coins are deducted before the LLM call**, refunded on failure. Ledger-based, with
   atomic conditional updates — never a bare mutable balance column.
3. **Visual Fallback Editor edits cost zero coins.**
4. **One D1 database per user project.** No cross-tenant tables.
5. **No secrets in code** — env vars / Cloudflare secrets only. Generated Workers get no
   platform secrets.
6. **All external calls have explicit timeouts.**

## Project Context Maps (Atlas)

Read `.amanah/atlas/*.md` before planning or modifying any feature:

- `product.md` — product concepts, personas, business model, core rules
- `tech.md` — stack, services, databases, billing mechanics
- `structure.md` — directory layout, code patterns, file locations
- `conventions.md` — naming, gotchas, security non-negotiables
- `quickstart.md` — copy-paste recipes for common tasks

They were last regenerated from code on **2026-07-15**, so they predate the orchestrator
and the schema package. Where an atlas file and the code disagree, **the code wins** — then
fix the atlas. `/atlas` regenerates all five; it is overdue.

## Feature Blueprints

Blueprints live in `.amanah/blueprints/{feature-name}/`:
- `what.md` — What the feature must do
- `how.md` — How it's implemented
- `now.md` — Action items (implementation checklist)
- `fix.md` — Bug fix plans (Lite Mode)

**Always read these before modifying code for a feature.**

### Slash Commands

- `/blueprint <name>` — Generate full feature blueprint
- `/fix <name>` — Generate bug fix plan
- `/spec <name>` — Read existing blueprint before working
- `/build <name>` — Autonomous implementation (marks tasks done in `now.md`)
- `/atlas` — Regenerate atlas from codebase
- `/setup` — Full setup (atlas + commands + skills + agents)
- `/review <file>` — Review code against `conventions.md`
- `/audit <file>` — Run the 29 Quality Gates
- `/security-review [mode]` — Security audit
- `/history <topic>` — Search past blueprints for patterns

### Blueprint workflow

Full Mode generates `what.md` → `how.md` → `now.md` **one file at a time**, pausing for
review after each. Lite Mode (bugs, ≤5 files) generates a single `fix.md`.

## Documentation publishing

Repository docs are published to Confluence at
`amanahagentdeveloper.atlassian.net/wiki`, space `developer amanahagent`, beneath the page
*AI-First App Builder — Knowledge Base*.

```bash
node scripts/sync-confluence.mjs                    # dry run (default)
node scripts/sync-confluence.mjs --apply             # publish all
node scripts/sync-confluence.mjs --apply --file TODO.md   # one document
```

Pages are matched **by title**, never by id — renaming a heading locally does not create a
duplicate page. Every child page carries an auto-generated banner; editing a page in
Confluence is lost on the next sync. Change the markdown here instead.

Requires `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`, and
`CONFLUENCE_SPACE_KEY` in `.env`. `.env` and `.mcp.json` are both gitignored.

## Setup status

- Commands: installed in `.claude/commands/`
- Atlas: generated in `.amanah/atlas/`, **stale** (see above)
- Skills/agents: includes the `impeccable` skill and its 4 agents under `.claude/`. The
  Amanah framework sources live in `.amanah/SKILL.md`, `.amanah/atlas-generator/SKILL.md`,
  and `.amanah/AGENT.md`; read them directly if the corresponding skill is not installed.
