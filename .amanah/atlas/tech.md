# AI-First App Builder for Indonesia — Technology Stack

> **Regenerated from code on 2026-07-15.** The previous version described a target
> architecture with no code. The editor now exists; the backend still does not. Both are
> stated below and marked accordingly.

## Stack As Built

| Layer | Choice | State | Evidence |
|-------|--------|-------|----------|
| Language | TypeScript | Built | `apps/editor/tsconfig.json` |
| Frontend editor | React 18 + Vite 5 + Tailwind 3 | **Built** | `apps/editor/package.json` |
| State | Zustand 4 | **Built** | `apps/editor/src/store/useBuilder.ts` |
| Routing | none — state-driven | **Built** | `App.tsx` switches on `view` |
| E2E harness | Playwright | **Built** | `apps/editor/.shots/{verify,flow,shot}.mjs` |
| Backend core | Express.js | **Not built** | — |
| AI engine | API LLM-Kita | **Not built** | — |
| Database | Cloudflare D1 | **Not built** | — |
| Compute | Cloudflare Workers | **Not built** | — |
| Payments | Midtrans | **Not built** | — |

Exact frontend versions from `package.json`: React `^18.3.1`, Zustand `^4.5.5`,
Vite `^5.4.8`, Tailwind `^3.4.13`, TypeScript `^7.0.2`, Playwright `^1.65.1`.

Dev server runs on **port 5180 with `--strictPort`** (`vite.config.ts`). Two instances
cannot coexist; a second `npm run dev` exits with "Port 5180 is already in use".

## Databases

Nothing is persisted. There is no database, local or remote.

- **D1 (SQLite dialect)**: intended for the *end user's* generated app data, one database
  per published project. Not provisioned.
- **Platform database** (users, coin ledger, session context, project metadata):
  **still not chosen.** Assume D1 or Postgres-on-Hyperdrive; do not assume SQLite-only
  syntax without confirming.
- D1 constraints that will bite when DDL generation is written: no `SERIAL`, no sequences,
  limited `ALTER TABLE`. Use `INTEGER PRIMARY KEY AUTOINCREMENT` or ULID/TEXT ids, and
  rebuild tables rather than `ALTER COLUMN`.

The in-memory ledger shape in `apps/editor/src/lib/types.ts` is the closest thing to a
schema contract today, and it should inform the eventual table:

```ts
interface LedgerEntry {
  id: string
  at: string
  label: string
  detail: string
  coins: number      // negative = out, positive = in/refund
  outcome: 'spent' | 'free' | 'refunded' | 'failed'
  refId: string      // binds a debit to its refund
}
```

## External Services

| Service | Purpose | Failure Mode | State |
|---------|---------|--------------|-------|
| API LLM-Kita | Prompt → PRD + JSON schema + component tree | No response → no coins burned, return retry prompt | Not integrated |
| Midtrans | QRIS / VA top-ups | Webhook is the only source of truth for crediting coins | Not integrated |
| Cloudflare API | Create D1 databases, deploy Pages/Workers | Partial deploy (D1 created, Worker failed) must be recoverable | Not integrated |

Every simulated operation in the editor is a `setTimeout` chain in
`store/useBuilder.ts`: generation is 5 steps × 700 ms, revision 1,600 ms, publish
3 steps × 900 ms. These durations are invented and carry no meaning.

## Key Libraries

**Installed:** `react`, `react-dom`, `zustand`, `tailwindcss`, `vite`, `typescript`,
`playwright`, `autoprefixer`, `postcss`, `@vitejs/plugin-react`, `@types/react`,
`@types/react-dom`.

**Intended but not installed:**

- `zod` — validate LLM JSON before it reaches the mapper. **Absent today**, so LLM output
  is currently trusted. This is the single most important untaken safety step.
- `express`, `midtrans-client`, `wrangler`, `@cloudflare/workers-types`, `vitest`.

There is no unit-test runner. Verification is Playwright-driven and screenshot-based.

## Architecture Pattern (as built)

```
Rail ─┬─ Editor  → Pipeline → PromptRow → Preview ──┬─ Inspector (free edits)
      ├─ Skema   → SchemaView                       │
      └─ Riwayat → LedgerView                       └─ Toasts
                          │
                    useBuilder (Zustand)
              projects · ledger · view · run states
                          │
                  setTimeout simulation  ← the seam where the
                                            orchestrator will attach
```

All state lives in one Zustand store. There is no service layer, no data layer, and no
network layer — so there is no seam to swap except `useBuilder`'s action functions
(`runGeneration`, `runRevision`, `runPublish`, `topUp`). Those four functions are where
the backend will connect.

## Auth Flow

- Platform users authenticate to the Express orchestrator. **Mechanism still not
  specified**; JWT with refresh was the intended default. Not implemented.
- Published user apps need their own auth story. Not defined, and there is nothing to
  protect yet.
- Secrets must come from env vars / Cloudflare secrets. `.gitignore` already excludes
  `.env` and `.env.*`. There is still no `.env.example`, so required variables are
  undocumented outside `quickstart.md`.

## Development Commands

Only the editor has scripts today (`apps/editor/package.json`):

| Command | Meaning | Exists |
|---------|---------|--------|
| `npm run dev` | Vite dev server on port 5180 | Yes |
| `npm run build` | Production build to `dist/` (gitignored) | Yes |
| `npm run preview` | Serve the production build | Yes |
| `npm test` | Vitest | **No** — not configured |
| `npm run lint` | ESLint + Prettier | **No** — not configured |

Verification harness (run from `apps/editor/`):

```bash
node .shots/verify.mjs   # overflow + console errors at 1440/1280/1024px
node .shots/flow.mjs     # free-inspector, fail+refund, publish paths
```

`flow.mjs` prints `BALANCE_AFTER_REFUND`, which must stay **128**.

## Billing Mechanics (technical)

**Target** (unchanged from the PRD): `coin_ledger(id, user_id, delta, reason, ref_id,
balance_after, created_at)`. Balance derived or cached. Deduction is a check-then-act
needing an atomic conditional `UPDATE ... WHERE balance >= cost`. Midtrans webhook
idempotent on `order_id` / `transaction_id`.

**What actually exists** (`apps/editor/src/store/useBuilder.ts`): an in-memory array with
a derived balance.

```ts
const balanceOf = (ledger) => ledger.reduce((sum, e) => sum + e.coins, STARTER_BALANCE_BASE)
```

This correctly implements the *discipline* — balance is never a mutable stored number —
but not the *guarantees*. There is no atomicity, so two concurrent runs in two tabs would
both pass the `balance < cost` check and both spend. That check-then-act race is real and
must be closed server-side before any coin is worth real money.
