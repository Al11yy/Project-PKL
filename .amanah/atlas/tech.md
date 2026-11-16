# AI-First App Builder for Indonesia — Technology Stack

> **Status**: Target architecture from `prd_ai_first_app_builder.md`, with two open PRD
> choices resolved: **Express.js** (not NestJS) for the backend, **Vite + React SPA**
> (not Next.js) for the frontend editor. No dependency files exist yet — versions below
> are the intended baseline and must be pinned when the repo is scaffolded.

## Core Stack

| Layer | Choice | Role |
|-------|--------|------|
| Language | Node.js (LTS, TypeScript) | Orchestrator, API, billing |
| Frontend editor | React 18 + **Vite** + Tailwind CSS | Prompt UI, canvas, Fallback Editor |
| State | Zustand | JSON→component mapping, editor state |
| Backend core | **Express.js** | Auth, coin ledger, LLM orchestration |
| AI engine | **API LLM-Kita** | Prompts optimized for strict JSON output |
| Frontend hosting | Cloudflare Pages | Static build of the editor (and published apps) |
| Backend compute | Cloudflare Workers | Generated per-project REST CRUD APIs |
| Database | Cloudflare D1 (serverless SQLite) | Per-project generated schemas |
| Payments | Midtrans (QRIS, Virtual Account) | Coin top-ups in IDR |

## Databases

- **D1 (SQLite dialect)**: the *end user's* generated app data, one database per
  published project. DDL is executed at schema-approval time.
- **Platform database** (for platform users, coin ledger, session context, generated
  project metadata): **not specified in the PRD** — see Open Decisions. Assume
  D1 or Postgres-on-Hyperdrive; do not assume SQLite-only syntax without confirming.
- Note: D1 has **no `SERIAL`**, no sequences, and limited `ALTER TABLE` support. Any
  generated DDL must use `INTEGER PRIMARY KEY AUTOINCREMENT` or ULID/TEXT ids, and
  schema changes need a table-rebuild strategy rather than `ALTER COLUMN`.

## External Services

| Service | Purpose | Failure Mode |
|---------|---------|--------------|
| API LLM-Kita | Prompt → PRD + JSON schema + component tree | No response → no coins burned, return retry prompt |
| Midtrans | QRIS / VA top-ups | Webhook is the only source of truth for crediting coins |
| Cloudflare API | Create D1 databases, deploy Pages/Workers | Partial deploy (D1 created, Worker failed) must be recoverable |

## Key Libraries

- `zod` — validate LLM JSON output before it reaches the mapper (LLM output is untrusted).
- `zustand` — editor state.
- `tailwindcss` — Impeccable Style implementation.
- `@cloudflare/workers-types`, `wrangler` — Workers/D1 deploys.
- `midtrans-client` — payment snap/VA integration.
- `react-hook-form` — generated forms can be Formik-free; keep it simple.

## Architecture Pattern

```
React (Vite) editor  ──POST──>  Express orchestrator  ──>  LLM-Kita
        │                              │
   JSON→Component Mapper           Context Manager (session schema)
        │                              │
   Impeccable components          Coin ledger (pre-deduct)
        │                              │
        └──── Publish ────────────────> Cloudflare API ──> D1 + Workers + Pages
```

Request path is **Router → Service → Data**, mirroring the eventual Workers layout so
that generated projects look like the platform itself.

## Auth Flow

- Platform users authenticate to the Express orchestrator (mechanism **not specified** in
  the PRD — JWT with refresh is the intended default).
- Published user apps need their *own* auth story (end users of the generated app). The
  PRD does not define it; do not invent one without an Open Decision being resolved.
- LLM-Kita keys, Midtrans server keys, and Cloudflare API tokens must come from
  environment variables / Cloudflare secrets — never committed.

## Development Commands

> None exist yet. These are the intended scripts to create in `package.json`.

| Command | Meaning |
|---------|---------|
| `npm run dev` | Vite editor + Express orchestrator (concurrently) |
| `npm run build` | Build the editor for Cloudflare Pages |
| `npm test` | Vitest (unit + integration) |
| `npm run lint` | ESLint + Prettier |
| `npx wrangler d1 migrations apply` | Apply D1 migrations locally/remotely |
| `npx wrangler deploy` | Deploy the generated Worker |

## Billing Mechanics (technical)

- Coin balance is a **ledger**, not a mutable column: `coin_ledger(id, user_id, delta,
  reason, ref_id, balance_after, created_at)`. Balance is derived or cached.
- Deduction is a check-then-act on balance → requires a row lock / atomic conditional
  `UPDATE ... WHERE balance >= cost` / D1 `RETURNING` in a single statement.
- Midtrans webhook must be idempotent keyed on `order_id` / `transaction_id`.
