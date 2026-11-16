# AI-First App Builder for Indonesia — Conventions & Gotchas

> **Status**: No code exists yet, so these are **binding pre-commitments** derived from
> the PRD. Once code lands, replace inferred rules with rules observed in real files.

## Import Order

TypeScript/React (intended):

1. Node built-ins (`node:crypto`)
2. External packages (`react`, `express`, `zod`)
3. Internal packages (`@app/schema`)
4. Relative imports (`../services/llm`)
5. Types (`import type`)
6. Styles (last)

## Common Gotchas

| Gotcha | Why it bites | Rule |
|--------|--------------|------|
| Labeling LLM output as trusted | Kiro-style prompt injection: the model can be steered to emit HTML/JS | Always `zod.parse()`; reject unknown components |
| Deducting coins *after* the LLM call | If the call fails or the process dies, the call is free | Deduct first, refund explicitly on failure |
| Mutating a `balance` column directly | Double-spend under concurrency | Ledger + atomic conditional update |
| `ALTER TABLE` on D1 | D1 has limited ALTER support | Table rebuild (create new → copy → rename) |
| Assuming `SERIAL` / sequences | SQLite dialect has neither | `INTEGER PRIMARY KEY AUTOINCREMENT` or ULID |
| Sharing one D1 database across projects | Cross-tenant data leak | One D1 DB per project id |
| Re-rendering the canvas from the prompt on every edit | Burns coins for a text change | Fallback Editor edits the JSON tree locally |
| Caching the whole LLM response as the schema | Schema and UI drift apart | Context Manager stores schema separately |
| Trusting the Midtrans redirect page | Users can fake a success page | Credit coins only on verified webhook |
| Deploying without `wrangler` retries | Partial deploy leaves orphan D1 | Record each resource, make publish resumable |

## Naming Conventions (intended)

| Kind | Convention | Example |
|------|-----------|---------|
| Files (components) | PascalCase | `DataTable.tsx` |
| Files (modules) | kebab-case | `coin-ledger.ts` |
| Directories | kebab-case | `src/components/impeccable/` |
| React components | PascalCase | `ImpeccableNavbar` |
| Functions | camelCase | `deductCoins()` |
| Types/interfaces | PascalCase, no `I` prefix | `CoinLedgerEntry` |
| Zod schemas | camelCase + `Schema` suffix | `llmResponseSchema` |
| Constants | UPPER_SNAKE | `COIN_COST_PER_LLM_CALL` |
| DB tables | snake_case, plural | `coin_ledger`, `generated_projects` |
| Feature blueprint dirs | kebab-case | `.amanah/blueprints/coin-billing/` |

## Response Patterns

- Success: `{ data, error: null }` with a 2xx status.
- Failure: `{ data: null, error: { code, message, details } }`.
- `code` is a stable UPPER_SNAKE token clients can branch on (`INSUFFICIENT_COINS`,
  `INVALID_SCHEMA`, `DEPLOY_FAILED`) — never branch on the human message.
- Never leak stack traces, SQL errors, or provider error bodies to the client.

## Do's and Don'ts

**Do**
- Keep the Impeccable Style component whitelist in one file exported as a const array —
  the system prompt and the mapper read the same list.
- Put the LLM JSON contract in `packages/schema/` so frontend and backend cannot drift.
- Give every external call an explicit timeout (LLM ~60s for generation, Cloudflare ~30s).
- Make publish idempotent per project id (re-running publish must not create a second D1 DB).

**Don't**
- `dangerouslySetInnerHTML`, `eval`, or `new Function` anywhere in the mapper.
- Concatenate prompt text into SQL or into Worker source templates.
- Store API keys in the repo, in the blueprint, or in generated Worker code.
- Use `get_event_loop`-style or deprecated Node APIs (`new Buffer()`, callback `fs`).
- Add a component to the library without adding it to the whitelist and the system prompt.

## Security Non-Negotiables

- Authenticate every orchestrator endpoint; coin-spending endpoints must check ownership.
- Rate-limit generation endpoints per user (coin cost alone is not a rate limit).
- Validate and cap prompt length (e.g. 4,000 chars) to control token spend.
- Verify Midtrans webhook signature before crediting coins.
- Sanitize all identifiers used in generated DDL; allowlist column types.
- Redact secrets from logs; log coin deltas with `ref_id` for reconciliation.
