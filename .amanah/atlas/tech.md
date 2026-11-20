# AI-First App Builder for Indonesia — Technology Stack

> **Regenerated from code on 2026-11-18.** Replaces a version that described Express, an
> in-memory coin ledger, and a `BALANCE_AFTER_REFUND = 128` invariant — none of which exist.
> Billing is deferred, not cancelled; see `prd_ai_first_app_builder.md`.

## Stack As Built

| Layer | Choice | State | Evidence |
|-------|--------|-------|----------|
| Language | TypeScript `^7.0.2` | Built | all three workspaces |
| Frontend editor | React `^18.3.1` + Vite `^8.3.8` + Tailwind `^3.4.13` | **Built** | `apps/editor/package.json` |
| State | Zustand `^4.5.5` | **Built** | `apps/editor/src/store/useBuilder.ts` |
| Routing | none — state-driven (`'builder' \| 'schema'`) | **Built** | `App.tsx`, `useBuilder.ts:17` |
| Backend core | Hono `^4.13.19` on Cloudflare Workers | **Built** | `apps/orchestrator/src/` |
| Dev runtime | Node + `tsx watch` on :5181 | **Built** | `apps/orchestrator/src/server.ts` |
| Contract | Zod `^4.6.7` | **Built** | `packages/schema/src/` |
| Platform DB | Cloudflare D1 (`rakit-db`) | **Built** | `migrations/`, `repositories/projects.ts` |
| AI engine | API LLM-Kita, OpenAI-compatible | **Built** | `llm/openai-compatible-client.ts` |
| Tests | Vitest `^5.1.0` | **Built** | 262 tests across 16 files |
| E2E harness | Playwright `^1.65.1` | **Built** | `apps/editor/.shots/` |
| User project DB/compute | D1 + Workers, one per project | **Not built** | `runPublish` is simulated |
| DDL generation | `packages/generator/` | **Not built** | does not exist |
| Auth | — | **Not built** | `owner_id` placeholder |
| Payments | Midtrans | **Deferred** | no code; vision only, per PRD |

Editor dev server runs on **port 5180 with `strictPort`**; a second instance fails rather than
picking another port. The orchestrator's Node entry uses **5181**, `wrangler dev` **8787**.

## Databases

- **Platform DB — D1 `rakit-db`.** Holds metadata only: `projects` (with `revision`) and
  `project_revisions`. Never user app data.
- **User project DB — D1, one per project.** Not provisioned.
- D1 constraints that will bite when DDL generation is written: no `SERIAL`, no sequences,
  limited `ALTER TABLE`. Use `INTEGER PRIMARY KEY AUTOINCREMENT` or TEXT ids, and rebuild
  tables rather than `ALTER COLUMN`.

There is **no ledger table and no balance column**, in either database. Do not add one
without an explicit decision to start the billing phase.

## External Services

| Service | Purpose | Timeout | State |
|---------|---------|---------|-------|
| API LLM-Kita | Prompt → PRD + JSON schema + component tree | `LLM_TIMEOUT_MS` (60000) | **Integrated** |
| Cloudflare API | Create D1 databases, deploy Pages/Workers | — | Not integrated |
| Midtrans | QRIS / VA top-ups | — | **Deferred** — no integration, no plan to add before auth |

The LLM-Kita **API** is `https://api.llm-kita.com/api/v1`, not the marketing site at
`https://llm-kita.com`, which answers every POST with 405. `LLM_KITA_BASE_URL` must include
`/api/v1`; the client appends `/chat/completions`.

## Key Libraries

`react`, `react-dom`, `zustand`, `tailwindcss`, `vite`, `typescript`, `playwright`,
`autoprefixer`, `postcss`, `@vitejs/plugin-react`; plus `hono`, `wrangler`,
`@cloudflare/workers-types`, `zod`, `vitest`.

**Zod 4.6.7, not 3.23.** `npm audit` flagged CVE-2023-54404 on zod < 4.6.6. The described
vector does not reach this code (every array carries `.max()`), but shipping a known-open
advisory is not a defensible default. `npm audit --omit=dev` reports 0 vulnerabilities.

## Architecture Pattern (as built)

```
Rail ─┬─ Editor  → Pipeline → PromptRow → Preview ──┬─ Inspector (free edits)
      ├─ Skema   → SchemaView                       └─ Toasts
      └─ none    → EmptyState  (zero projects)
                          │
                    useBuilder (Zustand)
                   projects · view · run states
                          │
                    lib/api.ts  (HTTP)
                          │
        orchestrator → createApp()  ← one app, two entries
              ├─ worker.ts  (Cloudflare Workers, deployed)
              └─ server.ts  (Node, dev)
                          │
        routes → services/generation → llm client → LLM-Kita
                          │
                  repositories/projects → D1
```

The seam is `apps/editor/src/lib/api.ts`. State lives in one Zustand store; there is no
separate service layer in the editor.

## Two Entry Points, One App

`worker.ts` and `server.ts` both build `createApp()` and contain no routing or business
logic. Configuration arrives as an explicit `Env` object, never `process.env`, which is what
lets one codebase run on both runtimes without a `nodejs_compat` polyfill.

**Gotcha that bit once:** `server.ts` called `serve({ fetch: app.fetch })`. `@hono/node-server`
supplies no `env`, so `c.env` was `undefined` and the token gate never ran on the Node path —
while every test stayed green, because tests pass their own `env`. Fixed by
`createNodeHandler(env)`, guarded by `node-handler.test.ts`.

## Access Control

Not authentication. Two layers, both documented in `CLAUDE.md`:

- `FEATURE_GENERATE_ENABLED` — `/generate` and `/revise` return 503 `FEATURE_DISABLED`
  unless exactly `"true"`. **Off by default**, including when unset. Lives in Worker
  environment; unreadable by clients. This is the layer that holds.
- `RAKIT_SHARED_TOKEN` — required as `X-Rakit-Token` on everything except `/health` and the
  CORS preflight. Containment only: Vite inlines the editor's copy into the browser bundle.

`CORS_ALLOWED_ORIGINS` is a browser rule, not access control — `curl` ignores it. It also
**fails closed**: an unset or empty value allows *no* origin, so a forgotten variable cannot
silently open the API. Matching is exact, or a `*.sub.example.com` wildcard with a required
leading dot (so `evilrakit-editor.pages.dev` cannot match `*.rakit-editor.pages.dev`).
`Allow-Credentials` is deliberately absent — nothing is cookie-authenticated — which is why the
allowed-headers list must be exact rather than `*`.

`/health` is registered *before* the token middleware on purpose: it reports only
`{ status: 'ok', llmConfigured: bool }`, spends no tokens, and stays reachable so an operator can
tell "server is down" from "my token is wrong" without holding the token.

## Development Commands

From the root:

| Command | Meaning |
|---------|---------|
| `npm run dev:all` | Editor + orchestrator together |
| `npm test` | Vitest across all workspaces |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm run fake-llm` | Stub LLM provider, no API key |
| `npm run smoke` / `smoke:refusal` | End-to-end against the fake provider |
| `npm run check:branches` | ID-preservation invariants |

From `apps/orchestrator/`: `npm run dev` (:5181), `npm run dev:worker` (:8787),
`npm run db:migrate:local`, `npm run db:migrate:remote`, `npm run deploy`.

Verification harness, from `apps/editor/`: `node .shots/verify.mjs` (overflow + console
errors at 1440/1280/1024px), `node .shots/flow.mjs` (free-inspector and publish paths).

## Billing (deferred)

Target, unchanged from the PRD: `coin_ledger(id, user_id, delta, reason, ref_id,
balance_after, created_at)`, balance derived or cached, atomic conditional
`UPDATE ... WHERE balance >= cost`, Midtrans webhook idempotent on `order_id`.

**No part of this exists.** The in-memory ledger type and `balanceOf` helper were deleted
along with the ledger view. When the phase starts, the discipline to preserve is: no mutable
stored balance, deduction before the LLM call, `refId`-keyed idempotent refund, and the
check-then-act race closed server-side before any coin is worth real money.
