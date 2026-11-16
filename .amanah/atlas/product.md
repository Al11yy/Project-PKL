# AI-First App Builder for Indonesia — Product Overview

> **Source of truth**: `prd_ai_first_app_builder.md` (Draft v1.0) for requirements, and
> `apps/editor/` for what is actually built. **Regenerated from code on 2026-07-15.**
> Where this file and the code disagree, the code wins — then fix this file.

## What Is This?

A low-code/no-code platform where users describe an app in plain language ("saya butuh
sistem kasir untuk klinik") and AI generates the database schema plus a working
full-stack app. It removes the drag-and-drop learning curve with a **"PRD-to-App"
pipeline**: raw prompt → PRD + JSON schema → React UI → REST endpoints → deploy.

Built specifically for the Indonesian market: Rupiah prepaid coins via QRIS, local
latency (Cloudflare Edge), and no fixed monthly subscription (unlike USD-priced foreign
platforms). The product name in the built UI is **Rakit.ai** — the PRD still calls it
`[Nama Platform/Codename]`.

## Current Build State (important)

The previous version of this atlas claimed "no source code exists yet." That is no longer
true. As of commit `e68c189`:

| Layer | State |
|-------|-------|
| Frontend editor | **Built** — `apps/editor/`, ~2,000 LOC, runs on Vite |
| Component library | **Partial** — block renderers live inline in `Preview.tsx`, not a whitelisted library |
| JSON-to-component mapper | **Partial** — a `kind → component` switch, with no Zod validation |
| Coin ledger (UI) | **Built in memory** — derived balance, seed data only |
| Coin ledger (backend) | **Does not exist** — no persistence, no atomicity |
| Express orchestrator | **Does not exist** |
| LLM-Kita integration | **Does not exist** — progress is `setTimeout` |
| Cloudflare D1 / Workers / Pages | **Does not exist** — publish is simulated |
| Midtrans | **Does not exist** |
| Auth | **Does not exist** |
| `packages/` workspace | **Does not exist** |

Everything network-shaped in the editor is simulated with `setTimeout` and seed data.
The product is a working, clickable interface — not a working product.

## Core Concepts

- **PRD-to-App Pipeline**: The 5-stage flow — initiation (raw prompt) → PRD & schema
  generation → UI rendering → iterative refinement → instant deployment. Implemented in
  the UI as `PIPELINE` in `apps/editor/src/lib/types.ts`.
- **Impeccable Style**: The proprietary component/design language. In code today it is a
  set of Tailwind design tokens (`apps/editor/tailwind.config.js`) plus conventions
  documented in `KNOWLEDGE_BASE.md` §3 — **not** a `components/impeccable/` library, and
  there is no whitelist file yet.
- **JSON-to-Component Mapper**: Frontend logic translating AI JSON into a React tree. In
  code today this is `ScreenView` in `Preview.tsx`, which branches on `block.kind`. It
  renders only `navbar`, `stat`, and `table`.
- **Visual Fallback Editor**: Click-to-edit UI for text, accent colour, and copy — costs
  **zero AI coins**. Built as `components/inspector/Inspector.tsx`. It edits the local
  JSON block tree and provably never touches the ledger.
- **Context Manager**: Backend store holding conversation history + the temporary DB
  schema for the active session. **Does not exist.** The nearest thing is the `Project`
  object in the Zustand store, which holds schema and screens together — the exact drift
  risk the PRD's Context Manager was meant to prevent.
- **Koin**: Internal prepaid wallet currency. Funded via Midtrans (QRIS/VA). Implemented
  as an in-memory ledger with a derived balance.
- **D1 Auto-Provisioning**: Executing DDL against Cloudflare D1 to create the *end
  user's* project tables. **Does not exist.**
- **Usage-Based Pricing**: Coins deducted on two triggers — (1) every LLM-Kita API call,
  (2) whenever a user's D1 database exceeds the free tier. Only (1) is modelled, as a
  client-side constant.

## Key User Roles

| Role | Description | Notes |
|------|-------------|-------|
| **Tech-Savvy UMKM** | Business owners (shops, clinics) wanting digitalization | Price-sensitive; rejects monthly USD fees |
| **Siswa SMK / Mahasiswa IT** | Students doing final projects / freelance work | Suffers *blank canvas paralysis* |
| **Freelancer Web Lokal** | Developers taking on simple app orders | Time lost to CSS styling and server/DB setup |

All three are **end users of the platform**. There is still no admin/operator role — one
is needed for coin reconciliation and abuse handling.

The spread in technical literacy is the defining constraint on the interface: it must
serve people who have never configured a database and people who do it weekly.

## Business Model

Usage-based prepaid coins (Rupiah). No fixed monthly fee. Revenue accrues per AI call and
per D1 storage overage. Top-up via Midtrans QRIS / Virtual Account.

Current prices are client-side constants in `apps/editor/src/lib/types.ts`:

```ts
COIN_COST = { generate: 20, revise: 5, manualEdit: 0, publish: 50 }
```

These are **unvalidated guesses**, not costed against real LLM token spend. Treat any
pricing discussion as open until the orchestrator can measure actual provider cost.

## What AI Should Know When Working Here

1. **AI never emits HTML.** The LLM must return strict JSON mapping only to whitelisted
   components. The whitelist does not exist yet — creating it in one shared file is the
   highest-value next step, because the mapper and the system prompt must read the same
   list or they will drift.
2. **Coins are deducted *before* the LLM call**, never after. The UI already writes the
   debit before work starts and refunds on failure — but only in memory. There is no
   atomicity and no double-spend protection.
3. **Visual edits are free.** `updateBlock` in `useBuilder.ts` touches only the project
   tree, never the ledger. Preserve this: it is a product promise, not an optimisation.
4. **Rupiah, not USD.** All user-facing prices are IDR. Coins have an IDR denomination.
5. **User projects are isolated tenants.** One D1 database per published project, never a
   shared table.
6. **Cloudflare is the deployment target.** Anything that cannot run on Pages/Workers/D1
   needs explicit justification (the Node.js orchestrator is the known exception).
7. **Copy is written in Indonesian.** UI strings, toasts, and ledger details are
   Indonesian. Code identifiers and comments are English.
