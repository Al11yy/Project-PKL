# AI-First App Builder for Indonesia — Quick Start Recipes

> **Status**: No code exists yet. These are the recipes to follow when scaffolding, so the
> first files created already match the atlas. Verify paths before citing them.

## Common Tasks — Copy-Paste Ready

### Add a New Whitelisted UI Component

1. Create `apps/editor/src/components/impeccable/MyComponent.tsx` — PascalCase, Tailwind
   only, no inline styles, accept `data` + `onChange` props.
2. Register it in the **single** whitelist: `apps/editor/src/components/impeccable/index.ts`
   ```ts
   export const IMPECCABLE_COMPONENTS = ['Navbar', 'Hero', 'DataTable', 'Form', 'Card', 'MyComponent'] as const;
   ```
3. Add its prop schema to `packages/schema/src/components.ts` (Zod) so invalid AI output
   is rejected before render.
4. Append its description to the system prompt in `apps/orchestrator/src/prompts/`.
5. Write a mapper test: unknown component name → throws; valid name → renders.

### Add a New Orchestrator Endpoint

1. Create `apps/orchestrator/src/routes/<resource>.ts` — thin handler only.
2. Add business logic in `apps/orchestrator/src/services/<resource>/`.
3. Mount in `apps/orchestrator/src/app.ts`: `app.use('/api/v1/<resource>', requireAuth, router)`.
4. If it calls LLM-Kita or Cloudflare: use `deductCoins()` **first**, then call, then
   `refundCoins()` on failure. Set an explicit timeout.
5. Validate the body with Zod (`parse` or `safeParse`), cap length.
6. Test: auth required, insufficient coins → 402, provider timeout → 504 + no charge.

### Add a Coin-Costing Action

1. Add the action + cost to the cost map (single source of truth), e.g.
   `COIN_COSTS = { llm_generate: 10, publish_app: 25, ... }`.
2. Call `await coinService.checkAndDeduct(userId, action)` before doing the work.
3. Pass `ref_id` (request id) so the ledger entry can be reconciled/refunded.
4. Never hardcode a cost at a call site — read it from the map.

### Generate D1 Schema for a User Project

1. Take the schema object from the Context Manager (not from raw prompt text).
2. Sanitize every identifier: `^[a-z_][a-z0-9_]{0,62}$`; reject reserved words.
3. Allowlist column types: `TEXT | INTEGER | REAL | BLOB | NUMERIC` (+ `PRIMARY KEY`,
   `NOT NULL`, `DEFAULT`, `REFERENCES`).
4. Emit `CREATE TABLE IF NOT EXISTS` statements; use `INTEGER PRIMARY KEY AUTOINCREMENT`
   for surrogate ids.
5. Record the D1 database id in `generated_projects` **before** applying DDL, so a
   partial failure can be cleaned up.

### Implement an Idempotent Top-up

1. Create an `orders` row keyed by `order_id` with status `pending`.
2. On webhook: verify signature → look up order → if already `paid`, return 200 and do
   nothing → else insert ledger credit and set `paid` **in one transaction**.
3. Never credit from the client-side success redirect.

## Quick Commands

| Task | Command |
|------|---------|
| Install | `npm install` |
| Dev (editor + orchestrator) | `npm run dev` |
| Build editor for Pages | `npm run build` |
| Test | `npm test` |
| Lint | `npm run lint` |
| D1 local migrate | `npx wrangler d1 migrations apply <DB>` |
| Deploy Worker | `npx wrangler deploy` |
| Deploy editor | Cloudflare Pages git integration (or `npx wrangler pages deploy dist`) |

## Environment Quick Setup

Required environment variables (intended `.env.example`):

```
LLM_KITA_API_KEY=
LLM_KITA_BASE_URL=
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_IS_PRODUCTION=false
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
PLATFORM_DATABASE_URL=
JWT_SECRET=
SESSION_SECRET=
```

Rules: no secret is ever committed; generated Workers receive **no** platform secrets
(they are separate trust domains).

## Blueprint Workflow

```
/setup                     one-time init (done)
/blueprint <feature-name>  what.md → how.md → now.md (review between each)
/fix <bug-name>            single fix.md
/spec <feature-name>       read a blueprint + show progress
/build <feature-name>      implement, marking tasks done in now.md
/atlas                     regenerate these files once code exists
```

Recommendation for this repo: start with `/blueprint mvp-foundation` (Phase 1 of the PRD)
rather than jumping straight to AI orchestration — the component whitelist and coin
ledger are the load-bearing pieces.
