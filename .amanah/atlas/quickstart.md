# AI-First App Builder for Indonesia — Quick Start Recipes

> **Regenerated from code on 2026-07-15.** Recipes marked **✔ works today** are verified
> against the current editor. The rest target code that does not exist yet.

## Running What Exists

```bash
cd apps/editor
npm run dev            # Vite on port 5180, strictPort
```

Then open **http://localhost:5180**. Navigate via the left rail: Editor / Skema /
Riwayat koin. There is no router — the URL never changes.

> If it says "Port 5180 is already in use", an instance is already running. Either use it
> or stop it; `strictPort: true` means Vite will not pick another port.

### Verify before claiming anything works ✔

```bash
cd apps/editor
npx tsc --noEmit          # must print nothing
npm run build             # must succeed
node .shots/verify.mjs    # expects: ERRORS: none, no overflow lines
node .shots/flow.mjs      # expects: BALANCE_AFTER_REFUND: 128
```

`verify.mjs` reports an overflow for `LABEL.sr-only` lines, which is the visually-hidden
label technique and is expected, not a defect.

## Common Tasks — Copy-Paste Ready

### Change coin prices ✔ works today

1. Edit `COIN_COST` in `apps/editor/src/lib/types.ts` — the single source of truth.
2. Never hardcode a price at a call site; `useBuilder.ts` reads `COIN_COST.generate` etc.
3. If you add a priced action, add a matching `outcome` row in `seed.ts` so the demo
   ledger still reconciles to 128 — `STARTER_BALANCE_BASE` adjusts automatically, but the
   `flow.mjs` assertion will catch it if you break the pairing.
4. Run `node .shots/flow.mjs`; confirm `BALANCE_AFTER_REFUND: 128`.

### Add a new block kind (and actually render it) ✔ pattern works today

The bug to avoid: `BlockKind` in `types.ts` already declares `form`, `card`, and `chart`,
but **no renderer exists** for them — they are dead type surface. Follow all four steps:

1. Add the kind to `BlockKind` in `apps/editor/src/lib/types.ts`.
2. Write the renderer in `apps/editor/src/components/preview/Preview.tsx` following
   `TableBlock`, which is the most complete example:
   ```tsx
   function CardBlock({ block, inspectOpen, selected, onSelect }) {
     return (
       <div onClick={() => inspectOpen && onSelect(block.id)} className={ring(inspectOpen, selected)}>
         <div className="rounded-lg border border-rule bg-ground p-4">
           <h3 className="text-body font-semibold">{block.title}</h3>
           <p className="mt-1 text-meta text-ink-meta">{block.body}</p>
         </div>
       </div>
     )
   }
   ```
3. Branch on it inside `ScreenView`. Note `ScreenView` partitions blocks into `nav`,
   `stats`, and `rest` — a new kind must land in `rest` or be given its own partition.
4. Add seed data using the new kind in `apps/editor/src/lib/seed.ts`, at least two
   instances. An unrendered kind is indistinguishable from a bug; seed data is what proves
   it works.
5. Re-run `verify.mjs` at all three widths.

### Add a renderer that the inspector can edit ✔ works today

For the inspector to reach a block, the block must pass `onSelect` and use the `ring()`
helper, which draws the dashed selection outline:

```tsx
const ring = (inspectOpen: boolean, selected: boolean) =>
  inspectOpen
    ? `cursor-pointer rounded-[3px] outline-dashed outline-1 outline-offset-2 transition-[outline-color] ${
        selected ? 'outline-action' : 'outline-transparent hover:outline-rule-strong'
      }`
    : ''
```

Only `title`, `body`, and `accent` are editable — the inspector's contract. If a new
renderer needs another editable field, extend `UIBlock` and `updateBlock`'s patch type
together, and keep `updateBlock` away from `ledger`.

### Add a new shell component ✔ works today

1. Create `apps/editor/src/components/shell/MyThing.tsx`, exporting a named PascalCase
   function (the codebase uses named exports for components, default export only in
   `App.tsx`).
2. Use design tokens, not raw Tailwind colours: `text-ink-meta`, `border-rule`,
   `bg-ground-panel`, `text-title`/`text-body`/`text-meta`/`text-micro`.
3. For any number that changes, add `font-mono tnum` so it does not jitter.
4. Compose it in `App.tsx`.

### Add a new view ✔ works today

1. Add the id to the `View` union in `apps/editor/src/store/useBuilder.ts`.
2. Add it to `NAV` in `apps/editor/src/components/shell/Rail.tsx` with a label and icon.
3. Create `apps/editor/src/components/views/MyView.tsx`.
4. Add a branch in `App.tsx`: `{view === 'myview' && <MyView />}`.

### Add a design token ✔ works today

Edit `theme.extend` in `apps/editor/tailwind.config.js`. Prefer adding to an existing
semantic group (`ink`, `ground`, `rule`, `action`, `ok`, `warn`, `danger`) over inventing a
new name. The palette's discipline — one action colour, status colours reserved for
status — is what makes the UI read as coherent. People copy patterns they can see; a raw
hex in a component spreads faster than any rule prevents.

### Add an orchestrator endpoint (not built — binding recipe)

1. Create `apps/orchestrator/src/routes/<resource>.ts` — thin handler only.
2. Put business logic in `apps/orchestrator/src/services/<resource>/`.
3. Mount in `app.ts`: `app.use('/api/v1/<resource>', requireAuth, router)`.
4. If it calls LLM-Kita or Cloudflare: `deductCoins()` **first**, then call, then
   `refundCoins()` on failure. Explicit timeout (LLM ~60s, Cloudflare ~30s).
5. Validate the body with Zod; cap prompt length.
6. Test: auth required → 401; insufficient coins → 402; provider timeout → 504 with no charge.

### Replace a simulated action with a real call (not built — the actual seam)

The four functions to replace in `apps/editor/src/store/useBuilder.ts` are
`runGeneration`, `runRevision`, `runPublish`, and `topUp`. Each currently:

```
check balance → write ledger row → setTimeout steps → mutate project
```

Convert to: `check balance → POST → on error write refund → on success mutate project`.
Nothing else in the editor knows the backend is fake, so no other file needs to change.

### Generate D1 schema for a user project (not built)

1. Take the schema object from the Context Manager, **not** from raw prompt text.
2. Sanitize every identifier: `^[a-z_][a-z0-9_]{0,62}$`; reject reserved words.
3. Allowlist column types: `TEXT | INTEGER | REAL | BLOB | NUMERIC` (+ `PRIMARY KEY`,
   `NOT NULL`, `DEFAULT`, `REFERENCES`).
4. Emit `CREATE TABLE IF NOT EXISTS`; use `INTEGER PRIMARY KEY AUTOINCREMENT` for ids.
5. Record the D1 database id in `generated_projects` **before** applying DDL so a partial
   failure can be cleaned up.

### Implement an idempotent top-up (not built)

1. Create an `orders` row keyed by `order_id`, status `pending`.
2. On webhook: verify signature → look up order → if already `paid`, return 200 and do
   nothing → else insert the ledger credit and set `paid` **in one transaction**.
3. Never credit from the client-side success redirect. The current `topUp()` credits
   immediately with the detail "QRIS terverifikasi" — that text describes a verification
   that does not happen and must not survive into production.

## Quick Commands

| Task | Command | Works |
|------|---------|-------|
| Dev editor | `cd apps/editor && npm run dev` | ✔ |
| Typecheck | `cd apps/editor && npx tsc --noEmit` | ✔ |
| Build | `cd apps/editor && npm run build` | ✔ |
| Layout + console check | `cd apps/editor && node .shots/verify.mjs` | ✔ |
| Flow check | `cd apps/editor && node .shots/flow.mjs` | ✔ |
| Screenshots | `cd apps/editor && node .shots/shot.mjs` | ✔ |
| Docs → Confluence (dry run) | `node scripts/sync-confluence.mjs` | ✔ needs env vars |
| Docs → Confluence (publish) | `node scripts/sync-confluence.mjs --apply` | ✔ |
| Unit tests | `npm test` | ✗ not configured |
| Lint | `npm run lint` | ✗ not configured |
| Deploy Worker | `npx wrangler deploy` | ✗ no Worker |

## Environment Quick Setup

`.env.example` **does not exist yet**. Create it when the orchestrator is scaffolded:

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

Rules: no secret is committed (`.gitignore` covers `.env` and `.env.*`); generated Workers
receive **no** platform secrets — they are separate trust domains.

## Blueprint Workflow

```
/setup                     one-time init (done)
/atlas                     regenerate these files from code (just ran)
/blueprint <feature-name>  what.md → how.md → now.md (review between each)
/fix <bug-name>            single fix.md
/spec <feature-name>       read a blueprint + show progress
/build <feature-name>      implement, marking tasks done in now.md
```

### Recommended next blueprints, in order

1. **`mvp-foundation`** — the whitelisted Impeccable component library plus the single
   const array that the mapper and the system prompt both read. Everything else depends on
   this contract existing.
2. **`coin-billing`** — atomic server-side ledger, debit-before-call, idempotent refunds.
   The in-memory ledger already encodes the right *discipline*; this makes it enforceable.
3. **`llm-orchestration`** — Express + LLM-Kita + Zod validation + timeouts.

Start with (1). Creating the Zod contract and whitelist before the LLM call exists is what
keeps the safety rule from becoming a retrofit.
