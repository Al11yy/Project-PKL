# CLAUDE.md

Project instructions for AI agents working in this repository.

## Project

**AI-First App Builder for Indonesia** — a low-code/no-code platform where users describe
an app in plain language and AI generates the database schema plus a working full-stack
app, deployed to Cloudflare.

The complete requirements live in [prd_ai_first_app_builder.md](prd_ai_first_app_builder.md).
That document is the source of truth for *what* to build.

**Current state: documentation only.** There is no source code yet. Do not assume files
exist — verify with glob/grep before citing a path.

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

Read `.amanah/atlas/*.md` before planning or modifying any feature. These are generated
from the PRD and describe the intended architecture:

- `product.md` — product concepts, personas, business model, core rules
- `tech.md` — stack, services, databases, billing mechanics
- `structure.md` — target directory layout, code patterns, file locations
- `conventions.md` — naming, gotchas, security non-negotiables
- `quickstart.md` — copy-paste recipes for common tasks

`/atlas` regenerates these. **Run it once real code exists** — the current atlas is
PRD-derived, not code-derived.

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

## Setup status

- Commands: installed in `.claude/commands/` (12 commands)
- Atlas: generated in `.amanah/atlas/` (5 files, PRD-derived)
- Skills/agents: **not installed** — `.claude/skills/` and `.claude/agents/` do not exist
  yet. The source files are in `.amanah/SKILL.md`, `.amanah/atlas-generator/SKILL.md`, and
  `.amanah/AGENT.md`. Install them by copying those files to:

  ```
  .amanah/SKILL.md                      → .claude/skills/amanah-blueprint/SKILL.md
  .amanah/atlas-generator/SKILL.md      → .claude/skills/amanah-atlas-generator/SKILL.md
  .amanah/AGENT.md                      → .claude/agents/amanah-blueprint-generator.agent.md
  ```

  Until then, read the `.amanah/` sources directly.
