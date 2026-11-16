# AI-First App Builder for Indonesia — Conventions & Gotchas

> **Regenerated from code on 2026-07-15.** Rules below are split into **Observed** (already
> true in `apps/editor/`, enforce them) and **Binding** (pre-commitments for code not yet
> written). Once the backend exists, promote its rules from Binding to Observed.

## Import Order (observed)

TypeScript/React, as used throughout `apps/editor/src/`:

1. External packages (`react`, `zustand`)
2. Internal absolute-ish modules (`../store/useBuilder`, `../../lib/types`)
3. UI primitives (`../ui/Button`)
4. Types (`import type { Screen }`)

Example from `LedgerView.tsx`:

```ts
import { useBuilder } from '../../store/useBuilder'
import { ActionButton } from '../ui/Button'
import { IconCoins } from '../ui/Icons'
```

When the orchestrator lands, extend to: Node built-ins → external → internal packages
(`@app/schema`) → relative → types → styles.

## Common Gotchas

### Observed (will bite you today)

| Gotcha | Why it bites | Rule |
|--------|--------------|------|
| Storing balance as a number | Double-spend under concurrency, and drift from history | Balance is derived by `balanceOf(ledger)`; never add a stored `balance` field |
| Making the inspector touch the ledger | Destroys the "visual edits are free" promise that the UI advertises | `updateBlock` maps over `projects` only, never `ledger` |
| Lowering the `TopBar` meta breakpoint | Truncates the project name at 1280px — visually worse than hiding the meta | Keep `min-[1400px]:inline` unless you re-measure all three widths |
| Assuming every `BlockKind` renders | `form`, `card`, `chart` are declared but no renderer exists | Check `Preview.tsx` before claiming a block kind works |
| Adding a `setTimeout` step without a reason | Simulation durations are invented; they look like real latency | Keep simulations confined to the four run actions in `useBuilder.ts` |
| Writing slash-containing `gitignore` patterns without `**/` | Anchors to the `.gitignore` directory and silently misses `apps/editor/.shots/` | Test with `git status` after staging |
| Starting a second dev server | `strictPort: true` on 5180 means hard failure, not a fallback port | Check for a running instance before `npm run dev` |
| Editing seed entries | `STARTER_BALANCE_BASE` auto-adjusts so the total still reconciles to 128 | Re-run `flow.mjs` and confirm `BALANCE_AFTER_REFUND: 128` |
| Writing a `refunded` row with no matching debit | The ledger cannot reconcile; this exact bug shipped once | Every refund shares a `refId` with a debit of equal magnitude |

### Binding (for code not yet written)

| Gotcha | Why it bites | Rule |
|--------|--------------|------|
| Labeling LLM output as trusted | Prompt injection can emit HTML/JS | Always `zod.parse()`; reject unknown components |
| Deducting coins *after* the LLM call | A crash or timeout makes the call free | Deduct first, refund explicitly on failure |
| `ALTER TABLE` on D1 | D1 has limited ALTER support | Table rebuild (create new → copy → rename) |
| Assuming `SERIAL` / sequences | SQLite dialect has neither | `INTEGER PRIMARY KEY AUTOINCREMENT` or ULID |
| Sharing one D1 database across projects | Cross-tenant data leak | One D1 DB per project id |
| Caching the whole LLM response as the schema | Schema and UI drift apart | Store schema separately from the UI tree |
| Trusting the Midtrans redirect page | Users can fake a success page | Credit coins only on a verified webhook |
| Deploying without retries | Partial deploy leaves an orphan D1 | Record each resource; make publish resumable |

## Naming Conventions

| Kind | Convention | Example (observed where marked) |
|------|-----------|-------------------------------|
| Files (components) | PascalCase | `LedgerView.tsx`, `TopBar.tsx` ✔ |
| Files (modules) | kebab-case | `sync-confluence.mjs` ✔ |
| Directories | kebab-case | `components/shell/`, `skills/impeccable/` ✔ |
| React components | PascalCase | `PromptRow`, `StatBlock` ✔ |
| Functions | camelCase | `runGeneration`, `balanceOf` ✔ |
| Types/interfaces | PascalCase, no `I` prefix | `Project`, `LedgerEntry` ✔ |
| Constants | UPPER_SNAKE | `COIN_COST`, `STARTER_BALANCE_BASE` ✔ |
| Store actions | verb-first camelCase | `setView`, `toggleInspect`, `dismissToast` ✔ |
| Zod schemas | camelCase + `Schema` suffix | `llmResponseSchema` (planned) |
| DB tables | snake_case, plural | `coin_ledger`, `generated_projects` (planned) |
| Feature blueprint dirs | kebab-case | `.amanah/blueprints/coin-billing/` (planned) |

## Response Patterns (binding — no API exists yet)

- Success: `{ data, error: null }` with a 2xx status.
- Failure: `{ data: null, error: { code, message, details } }`.
- `code` is a stable UPPER_SNAKE token clients branch on (`INSUFFICIENT_COINS`,
  `INVALID_SCHEMA`, `DEPLOY_FAILED`) — never branch on the human message.
- Never leak stack traces, SQL errors, or provider error bodies to the client.

The editor's toast tones (`'ok' | 'warn' | 'danger'`) are the UI-side mirror of this and
already distinguish user-facing failure from success.

## Do's and Don'ts

**Do**
- Keep the Impeccable Style component whitelist in **one** file exported as a const array,
  read by both the system prompt and the mapper. It does not exist yet — creating it is the
  highest-value next step, because the two readers will drift the moment they disagree.
- Put the LLM JSON contract in `packages/schema/` so frontend and backend cannot drift.
- Give every external call an explicit timeout. `sync-confluence.mjs` does this at 20s via
  `AbortController`; copy that pattern.
- Make publish idempotent per project id.
- Write user-facing copy in Indonesian, code comments and identifiers in English.
- Verify with screenshots at 1440 / 1280 / 1024 before claiming a layout is fine.

**Don't**
- `dangerouslySetInnerHTML`, `eval`, or `new Function` anywhere in the mapper.
- Concatenate prompt text into SQL or Worker source templates.
- Store API keys in the repo, in a blueprint, or in generated Worker code.
- Add a component to the library without adding it to the whitelist and the system prompt.
- Commit `.env`, `dist/`, `node_modules/`, or `.shots/*.png`.

## Security Non-Negotiables

- Authenticate every orchestrator endpoint; coin-spending endpoints must check ownership.
- Rate-limit generation endpoints per user — coin cost alone is not a rate limit.
- Validate and cap prompt length (e.g. 4,000 chars) to control token spend. Note the UI
  already rejects prompts under 12 characters, but that is a demo affordance, not a
  security control.
- Verify the Midtrans webhook signature before crediting coins.
- Sanitize all identifiers used in generated DDL; allowlist column types.
- Redact secrets from logs; log coin deltas with `ref_id` for reconciliation.
- Treat an API token like a password: it carries the full permissions of the account that
  issued it. If one is ever pasted into a chat or a log, revoke and reissue it.
