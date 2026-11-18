# AI-First App Builder for Indonesia — Conventions & Gotchas

> **Regenerated from code on 2026-11-18.** Replaces a version whose gotchas were about a coin
> ledger, a `BALANCE_AFTER_REFUND` invariant, and Midtrans. None of those exist. Billing is
> deferred; its rules are quarantined in their own section at the bottom and must not be
> applied while building the MVP.

## Import Order (observed)

TypeScript/React, as used throughout `apps/editor/src/`:

1. External packages (`react`, `zustand`)
2. Internal modules (`../store/useBuilder`, `../../lib/types`)
3. UI primitives (`../ui/Button`)
4. Types (`import type { Screen }`)

In the orchestrator: Node built-ins → external (`hono`) → package (`@rakit/schema`) →
relative → types.

## Common Gotchas

### Observed (will bite you today)

| Gotcha | Why it bites | Rule |
|--------|--------------|------|
| Comparing `c.req.path` to a bare route | It is the **full** path, so `=== '/generate'` never matches and the middleware silently does nothing | Match by suffix, or read the route pattern |
| Passing `app.fetch` straight to `@hono/node-server` | No `env` is supplied, so `c.env` is `undefined` and every env-dependent guard silently passes | Build the handler with `createNodeHandler(env)` |
| Trusting a green test suite for env behaviour | Tests supply their own `env`, so they cannot catch a missing one on the real path | Add a test against the entry point, not only the app |
| Redeclaring a test double's field | `CountingClient` shadowing `calls` made every "provider was never reached" assertion vacuous | Assert on the array the parent actually pushes to |
| Lowering the `TopBar` meta breakpoint | Truncates the project name at 1280px — worse than hiding the meta | Keep `min-[1400px]:inline` unless you re-measure all three widths |
| Assuming a declared type renders | The whitelist is the source of truth and it holds exactly `navbar`, `stat`, `table` | Check `WHITELISTED_KINDS`, not a stale comment |
| Treating `VITE_*` as secret | Vite inlines it into the browser bundle; DevTools shows it | The shared token is containment, not a credential |
| Replacing `CORS_ALLOWED_ORIGINS` with `*` | Lets any page drive the Worker and bill the LLM quota | Keep the allowlist; CORS is a browser rule, not access control |
| Writing slash-containing `gitignore` patterns without `**/` | Anchors to the `.gitignore` directory and misses `apps/editor/.shots/` | Test with `git status` after staging |
| Starting a second dev server | `strictPort: true` on 5180 and 5181 means hard failure, not a fallback port | Check for a running instance first |

### Binding (for code not yet written)

| Gotcha | Why it bites | Rule |
|--------|--------------|------|
| Labeling LLM output as trusted | Prompt injection can emit HTML/JS | Always parse through `@rakit/schema`; reject unknown components by name |
| `ALTER TABLE` on D1 | D1 has limited ALTER support | Table rebuild (create new → copy → rename) |
| Assuming `SERIAL` / sequences | SQLite dialect has neither | `INTEGER PRIMARY KEY AUTOINCREMENT` or TEXT ids |
| Sharing one D1 database across projects | Cross-tenant data leak | One D1 DB per project id; `rakit-db` holds metadata only |
| Caching the whole LLM response as the schema | Schema and UI drift apart | Store schema separately from the UI tree |
| Deploying without retries | Partial deploy leaves an orphan D1 | Record each resource; make publish resumable |
| Exposing the API before auth exists | `owner_id` is a placeholder, so every caller sees the same rows | Do not publicise the Worker until auth ships |

## Naming Conventions

| Kind | Convention | Example (observed where marked) |
|------|-----------|-------------------------------|
| Files (components) | PascalCase | `SchemaView.tsx`, `TopBar.tsx` ✔ |
| Files (modules) | kebab-case | `openai-compatible-client.ts`, `sync-confluence.mjs` ✔ |
| Directories | kebab-case | `components/shell/`, `skills/impeccable/` ✔ |
| React components | PascalCase | `PromptRow`, `StatBlock` ✔ |
| Functions | camelCase | `runGeneration`, `createNodeHandler` ✔ |
| Types/interfaces | PascalCase, no `I` prefix | `Project`, `Env` ✔ |
| Constants | UPPER_SNAKE | `WHITELISTED_KINDS`, `LLM_TIMEOUT_MS` ✔ |
| Store actions | verb-first camelCase | `setView`, `toggleInspect`, `dismissToast` ✔ |
| Zod schemas | camelCase + `Schema` suffix | `projectSchema`, `llmEnvelopeSchema` ✔ |
| DB tables | snake_case, plural | `projects`, `project_revisions` ✔ |
| Feature blueprint dirs | kebab-case | `.amanah/blueprints/mvp-foundation/` ✔ |

## Response Patterns (observed)

- Success: `{ data, error: null }` with a 2xx status.
- Failure: `{ data: null, error: { code, message, details } }`.
- `code` is a stable UPPER_SNAKE token clients branch on — never branch on the human message.

Codes that exist in `apps/orchestrator/src/errors.ts`:

`UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`, `NOT_FOUND`,
`UNAUTHORIZED`, `DATABASE_UNAVAILABLE`, `FEATURE_DISABLED`, `CONTRACT_VIOLATION`,
`INVALID_SCHEMA`, `REVISION_DROPPED_DATA`.

Never leak stack traces, SQL errors, or provider error bodies to the client.

The editor's toast tones (`'ok' | 'warn' | 'danger'`) mirror this and distinguish user-facing
failure from success.

## Do's and Don'ts

**Do**
- Keep the component whitelist in **one** place: `WHITELISTED_KINDS` in
  `packages/schema/src/contract.ts`, read by the system prompt and the mapper alike.
- Reach for `@rakit/schema` from both apps; never re-declare a contract locally.
- Give every external call an explicit timeout. `sync-confluence.mjs` uses `AbortController`
  at 20s; the LLM client uses `LLM_TIMEOUT_MS`. Copy that pattern.
- Make publish idempotent per project id.
- Write user-facing copy in Indonesian, code comments and identifiers in English.
- Verify with screenshots at 1440 / 1280 / 1024 before claiming a layout is fine.

**Don't**
- `dangerouslySetInnerHTML`, `eval`, or `new Function` anywhere in the mapper.
- Concatenate prompt text into SQL or Worker source templates.
- Store API keys in the repo, in a blueprint, or in generated Worker code.
- Add a component to the library without adding it to the whitelist and the system prompt.
- Show a balance, a coin count, a price, or a "top up" affordance. Nothing bills.
- Commit `.env`, `dist/`, `node_modules/`, or `.shots/*.png`.

## Security Non-Negotiables

- Require `X-Rakit-Token` on every route except `/health` and the CORS preflight. It is
  **containment, not authentication** — do not describe it as auth, and do not let it survive
  the arrival of real auth.
- Keep `FEATURE_GENERATE_ENABLED` off until auth exists. It is the only guard a client cannot
  read or forge.
- Rate-limit generation endpoints per user once auth lands.
- Validate and cap prompt length to control token spend. The UI rejects prompts under 12
  characters, but that is a demo affordance, not a security control.
- Sanitize all identifiers used in generated DDL; allowlist column types.
- Redact secrets from logs. `wrangler.toml` is a committed file — never put a secret value in it.
- Treat an API token like a password: it carries the full permissions of the account that
  issued it. If one is ever pasted into a chat or a log, revoke and reissue it.

## Billing Rules — deferred, do not apply yet

These belong to a later phase. They are kept so the design is not lost, and they are
**not** in force: any code following them today would be building something the product does
not have.

| Rule | Why it will matter |
|------|--------------------|
| Balance derived from an append-only ledger, never a mutable column | A stored balance drifts from history and double-spends under concurrency |
| Deduct before the LLM call, refund explicitly on failure | Otherwise a crash or timeout makes the call free |
| Every refund shares a `refId` with a debit of equal magnitude | The exact reconciliation bug that shipped once before |
| Credit only on a verified payment webhook, never a redirect page | A user can fake a success page |
| Visual edits stay free and must read as free | It is the recovery path when generation disappoints |
