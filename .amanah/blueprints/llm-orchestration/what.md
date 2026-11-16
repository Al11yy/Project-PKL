# LLM Orchestration — Requirements

> **Status**: Draft, awaiting review
> **Phase**: PRD Fase 2 — "AI Orchestration (Core Value)"
> **Predecessor**: `mvp-foundation` (contract exists in `apps/editor/src/lib/contract.ts`)
> **Successor**: `coin-billing` (atomic ledger, auth, cost measurement)

## 1. Overview

The product's core promise is that a user describes an app in plain Indonesian and gets a
working schema plus screens. Today that promise is fake: `runGeneration` in
`apps/editor/src/store/useBuilder.ts` advances a five-step `setTimeout` chain and mutates
nothing but a prompt string. **No network call exists anywhere in the repo.**

This blueprint builds the first real one. A Node.js orchestrator at `apps/orchestrator/`
accepts a prompt, calls API LLM-Kita, and returns a payload that is *guaranteed* to satisfy
the block contract already enforced in the editor. The guarantee is the point: the editor
now has a whitelist (`WHITELISTED_KINDS`) and a Zod schema that rejects unknown kinds, but
nothing produces input for it. Until a real model is behind that schema, the safety rule
in `CLAUDE.md` §1 — *the LLM never emits HTML or JS* — is a claim about code that does not
run.

Two structural changes make this safe rather than merely working:

1. **The contract moves to `packages/schema/`.** It currently lives in the editor's `lib/`,
   which means an orchestrator importing it would drag in a React app's module graph.
   `contract.ts` and `parse.ts` are already pure — they import only `zod` — so this is a
   move, not a rewrite.
2. **The schema is split by ownership.** `projectSchema` today mixes fields the model must
   produce (`screens`, `tables`, `name`) with fields only the server may own (`id`,
   `status`, `updatedAt`, `prompt`). Asked to fill the whole shape, a model will invent an
   `id` and a `status`. A separate LLM-facing schema makes that impossible rather than
   merely detected.

## 2. Glossary

**Orchestrator**: The Express app at `apps/orchestrator/`. Owns LLM calls, validation, and
(later) coins. Node.js, not a Cloudflare Worker — the one justified exception per
`product.md` §6.

**LLM-Kita**: The external AI provider. Contract shape is **assumed OpenAI-compatible**
(`POST {base}/chat/completions`, `messages[]`, Bearer auth) — see Open Decisions. Isolated
behind a `LlmClient` interface so a wrong assumption is a one-file change.

**Generation**: First-pass call. Prompt → full project (schema + screens).

**Revision**: Follow-up call. Existing project + an instruction → amended project. Must
preserve what the user already has rather than regenerate from scratch.

**Draft payload**: The model's raw, untrusted response text. Never reaches React state.
Parsed into a `ParsedProject` or rejected with a `ContractError`.

**Ownership split**: The rule that a field belongs to either the model or the server, never
both. Enforced by two schemas over one shape.

**Skema** (Indonesian, "schema"): The database table definitions, shown in `SchemaView`.

**Koin**: Prepaid coin currency. Out of scope here; `coin-billing` owns it.

**System prompt**: The instruction set forcing whitelist-only JSON output. Built from
`WHITELISTED_KINDS`, never hand-written, so it cannot drift from the validator.

**Refusal**: An explicit `{"refusal": {"reason": "..."}}` response for prompts the model
will not answer. Distinct from malformed output — a refusal is success at the transport
layer and must not be charged.

## 3. Must-Haves

### M-1: Extract the contract into a shared package

**Priority**: P0

**User Story**: As the developer maintaining this repo, I want the block contract in
`packages/schema/` so that the orchestrator and the editor validate against one definition
and cannot drift.

**Acceptance Criteria**:

- WHEN `packages/schema/` is created, THEN `WHITELISTED_KINDS`, `LIMITS`, `ACCENT_VALUES`,
  `uiBlockSchema`, `screenSchema`, `tableSchema`, `columnSchema`, `projectSchema`,
  `ContractError`, `parseProject`, and `parseProjects` SHALL be importable from
  `@rakit/schema` and resolve to the same runtime values as before the move.
- WHEN `packages/schema/package.json` is inspected, THEN its `dependencies` SHALL be
  `{"zod": "^4.6.7"}` and nothing else — no React, no Zustand, no Vite.
- WHEN `grep -rE "^import" packages/schema/src/` is run, THEN every matched line SHALL
  reference only `zod` or a relative path.
- WHEN the editor imports `@rakit/schema`, THEN `npm run build` in `apps/editor` SHALL
  produce a bundle no larger than **+1 kB** over the current `276.41 kB`, because the
  contract was already bundled — only its path changed.
- WHEN `apps/editor/src/lib/contract.ts` still exists, THEN it SHALL re-export from
  `@rakit/schema` rather than duplicate definitions, so no import site breaks during the
  move. If the file is deleted instead, every one of its import sites SHALL be updated in
  the same commit and `npx tsc --noEmit` SHALL still print nothing.
- WHEN `npx vitest run` is executed in `packages/schema/`, THEN all 28 existing contract
  tests SHALL pass unchanged except for their import paths.

### M-2: LLM-owned schema rejects server-owned fields

**Priority**: P0

**User Story**: As a platform operator, I want the model unable to set `id`, `status`, or
`updatedAt` so that a hallucinated identifier cannot corrupt the project record.

**Acceptance Criteria**:

- WHEN the model returns `{"id": "hacked", "name": "Kasir", "slug": "kasir", ...}`, THEN
  `llmProjectSchema.safeParse` SHALL succeed AND the parsed output SHALL NOT contain an `id`
  key at all (stripped, not accepted).
- WHEN the model returns output missing `name`, `slug`, `tables`, or `screens`, THEN parsing
  SHALL fail with a `ContractError` naming the missing field, e.g.
  `"name: Required"`.
- WHEN the model returns `{"tables": [], "screens": []}` with valid `name` and `slug`, THEN
  parsing SHALL succeed — an app with no tables and no screens is degenerate but not
  invalid, and the editor already renders it (empty-state added in `mvp-foundation`).
- WHEN any field is absent that the server owns, THEN assembling the final `projectSchema`
  payload SHALL supply it: `id` as a server-generated identifier, `status` as `'draft'`,
  `prompt` as the original user prompt, `updatedAt` as an Indonesian relative timestamp,
  and `tablesCount`/`screensCount` as the actual array lengths — never values the model
  supplied.
- WHEN the model returns `tablesCount: 999` alongside 2 tables, THEN the final payload SHALL
  report `tablesCount: 2`.
- WHEN both schemas are compared, THEN `Object.keys(llmProjectSchema.shape)` SHALL be
  exactly `['name', 'slug', 'tables', 'screens']`.

### M-3: System prompt is generated from the whitelist

**Priority**: P0

**User Story**: As the developer, I want the system prompt built from `WHITELISTED_KINDS`
so that adding a block kind cannot leave the prompt describing a stale set.

**Acceptance Criteria**:

- WHEN `buildSystemPrompt()` is called, THEN the returned string SHALL contain every member
  of `WHITELISTED_KINDS` and no other `kind` literal in its component list.
- WHEN a developer adds `'card'` to `WHITELISTED_KINDS` and re-runs the prompt tests, THEN
  the test asserting "the prompt names every whitelisted kind" SHALL still pass without
  editing the test — proving the prompt derives rather than duplicates.
- WHEN the prompt is built, THEN it SHALL state that `accent` is permitted only on `stat`,
  and SHALL list the permitted accent values from `ACCENT_VALUES`.
- WHEN the prompt is built, THEN it SHALL include the numeric caps from `LIMITS`
  (`maxScreens`, `maxBlocksPerScreen`, `maxTables`, `maxColumnsPerTable`,
  `maxTitleLength`, `maxBodyLength`) so the model is told the same limits the validator
  enforces.
- WHEN the prompt is inspected for the strings `html`, `script`, `<`, or `javascript`, THEN
  it SHALL contain an explicit prohibition naming all four as forbidden in any string
  field.
- WHEN `buildSystemPrompt()` is called twice, THEN it SHALL return a byte-identical string
  (no timestamps, no randomness) so prompt caching stays effective and tests are stable.

### M-4: LLM client behind an interface, with timeouts

**Priority**: P0

**User Story**: As the developer, I want the provider isolated behind an interface so that
correcting the assumed API shape touches one file, not the whole orchestrator.

**Acceptance Criteria**:

- WHEN the orchestrator calls the LLM, THEN it SHALL do so through a `LlmClient` interface
  with exactly one method — `complete(request): Promise<LlmCompletion>` — so a fake
  implementation satisfies the same type as the real one.
- WHEN `complete()` is called, THEN it SHALL abort via `AbortController` after
  `LLM_TIMEOUT_MS` (default **60 000**) and throw a `LlmTimeoutError`.
- WHEN the provider returns HTTP 429, THEN the client SHALL retry once after the
  `Retry-After` header value (or 2 000 ms if absent) and SHALL throw `LlmRateLimitError` if
  the retry also fails.
- WHEN the provider returns HTTP 5xx, THEN the client SHALL retry **once** with 500 ms
  backoff, then throw `LlmProviderError` carrying the status code.
- WHEN the provider returns HTTP 401 or 403, THEN the client SHALL NOT retry and SHALL throw
  `LlmAuthError` — retrying a bad key burns time and can lock an account.
- WHEN the response body is not valid JSON, THEN the client SHALL throw
  `LlmMalformedError` rather than returning a partial result.
- WHEN `LLM_KITA_API_KEY` is unset at startup, THEN the process SHALL exit with a message
  naming the variable, rather than failing on the first request.
- WHEN any `LlmError` is constructed, THEN its message SHALL contain the provider's HTTP
  status but SHALL NOT contain the API key, the request body, or the raw provider response
  body — verified by a test asserting the key does not appear in `error.message`.

### M-5: Model output is validated before it leaves the orchestrator

**Priority**: P0

**User Story**: As a user, I want malformed model output rejected with a clear message so
that I am not charged for a broken result and not shown a half-rendered app.

**Acceptance Criteria**:

- WHEN the model returns valid JSON with `kind: "iframe"`, THEN the endpoint SHALL respond
  HTTP **422** with `error.code = "INVALID_SCHEMA"` and `error.details` SHALL include
  `{"path": "screens.0.blocks.2.kind", "message": "kind tidak dikenal: iframe"}`.
- WHEN the model returns prose instead of JSON (e.g. `"Tentu! Berikut skemanya..."`), THEN
  the endpoint SHALL respond HTTP **422** with `error.code = "INVALID_SCHEMA"` and the
  detail SHALL state that no JSON object was found — not a raw `SyntaxError`.
- WHEN the model returns a JSON object wrapped in a markdown code fence, THEN the parser
  SHALL extract and validate the fenced JSON object successfully — models add fences even
  when told not to, and rejecting that is a self-inflicted failure.
- WHEN the model returns a JSON object with `kind: "form"`, THEN the response SHALL be
  HTTP **422**, never 200 with the block silently dropped. Dropping hides model
  misbehaviour during tuning, which is exactly when it must be visible.
- WHEN a refusal is returned (`{"refusal": {"reason": "..."}}`), THEN the endpoint SHALL
  respond HTTP **200** with `data.refusal` populated and SHALL NOT report an error — a
  refusal is a valid answer, and the UI renders it as a distinct state from failure.
- WHEN validation fails, THEN the raw model output SHALL be logged at `warn` with the
  prompt hash and the issue paths, and SHALL NOT be logged at `error` (it is expected
  during tuning, not an incident).

### M-6: Generation and revision endpoints

**Priority**: P0

**User Story**: As the editor, I want `POST /api/v1/generate` and `POST /api/v1/revise` so
that I can replace two `setTimeout` chains with real calls.

**Acceptance Criteria**:

- WHEN `POST /api/v1/generate` receives `{"prompt": "sistem kasir untuk klinik"}`, THEN it
  SHALL respond HTTP 200 with `{ data: { project, usage }, error: null }` where `project`
  passes `projectSchema` and `usage` reports `{ inputTokens, outputTokens, durationMs }`.
- WHEN `POST /api/v1/revise` receives `{"project": {...}, "instruction": "tambah kolom alergi"}`,
  THEN it SHALL send the existing project plus the instruction and respond with a project
  that still passes `projectSchema`.
- WHEN `prompt` is shorter than 12 characters, THEN the endpoint SHALL respond HTTP **400**
  with `error.code = "PROMPT_TOO_SHORT"` **without calling the provider**.
- WHEN `prompt` exceeds **4 000** characters, THEN the endpoint SHALL respond HTTP **400**
  with `error.code = "PROMPT_TOO_LONG"` without calling the provider.
- WHEN `instruction` exceeds **4 000** characters on revise, THEN the same
  `PROMPT_TOO_LONG` response SHALL apply.
- WHEN the request body is not an object, THEN the endpoint SHALL respond HTTP **400** with
  `error.code = "INVALID_REQUEST"`.
- WHEN the provider times out, THEN the endpoint SHALL respond HTTP **504** with
  `error.code = "LLM_TIMEOUT"` and `error.details.charged = false`.
- WHEN the provider rejects the key, THEN the endpoint SHALL respond HTTP **502** with
  `error.code = "LLM_UNAVAILABLE"` — the client's 401 is not the user's 401.
- WHEN `GET /api/v1/health` is called, THEN it SHALL respond HTTP 200 with
  `{ data: { status: "ok", llmConfigured: true|false }, error: null }` without calling the
  provider.

### M-7: Revision preserves what the user already edited

**Priority**: P1

**User Story**: As a user who edited a block's title by hand, I want a revision not to
discard my edit so that revising does not silently undo free work.

**Acceptance Criteria**:

- WHEN a revision is requested, THEN the request payload SHALL include the current project
  tree, and the system prompt SHALL instruct the model to change only what the instruction
  requires.
- WHEN the model returns a project whose `screens` array omits a `screen.id` that existed in
  the input, THEN the orchestrator SHALL log a `warn` naming the dropped id — silent
  truncation during revision is the failure mode this criterion exists to expose.
- WHEN the model returns a `screen.id` identical to an input screen id, THEN the returned
  block ids within that screen SHALL be preserved where the model kept them, so React keys
  and the inspector's `selectedBlockId` do not break mid-session.
- WHEN a revision fails validation, THEN the endpoint SHALL respond with the error and the
  client SHALL keep the pre-revision project in state — a failed revision must never leave
  the user with nothing.

### M-8: Prompt and response shapes are validated at the edge

**Priority**: P1

**User Story**: As a platform operator, I want request bodies validated so that malformed
input is rejected before it reaches a paid API call.

**Acceptance Criteria**:

- WHEN a request body contains an unexpected top-level key (e.g. `{"prompt": "x", "model": "gpt-4"}`),
  THEN the key SHALL be stripped and the request SHALL proceed using the server's configured
  model — clients must not select the model.
- WHEN `Content-Type` is not `application/json`, THEN the endpoint SHALL respond HTTP **415**
  with `error.code = "UNSUPPORTED_MEDIA_TYPE"`.
- WHEN the body exceeds **32 kB**, THEN Express SHALL respond HTTP **413** without reading
  the full payload into memory.
- WHEN any validation failure occurs, THEN the response SHALL match
  `{ data: null, error: { code, message, details } }` with `code` in `UPPER_SNAKE`, never a
  bare string or a stack trace.

## 4. Quality Targets

- **Q-1: Zero invalid payloads reach a client.** Across the full test suite, every response
  body that carries a `project` SHALL pass `projectSchema` before being sent. Measured by a
  test that fuzzes the LLM client with 20 malformed outputs and asserts no 200 response
  contains a project failing validation.
- **Q-2: Every external call is bounded.** No code path SHALL await the provider without an
  active `AbortController` timeout. Measured by a test using a deliberately hanging fake
  client: the request resolves in under `LLM_TIMEOUT_MS + 1 000` ms with HTTP 504.
- **Q-3: No secret in any log or error.** With the API key set to a sentinel string, no test
  log line, response body, or thrown `Error.message` SHALL contain that sentinel. Measured
  by capturing stdout and asserting absence.
- **Q-4: Rejection is explained.** Every HTTP 4xx/5xx response SHALL include a non-empty
  `error.code` and `error.message` in Indonesian. Measured by a test iterating every error
  branch and asserting both fields are populated.
- **Q-5: The package boundary holds.** `packages/schema` SHALL have zero runtime
  dependencies other than `zod`, and importing it from a bare Node script with no React
  installed SHALL work.

## 5. Security Considerations

**Threat surface.** One unauthenticated endpoint that spends money on every call. Until
`coin-billing` adds auth, this is a cost-exposure risk, not a data-breach risk — there is no
user data to leak yet. Stated plainly because "no auth yet" is a real gap, not a detail.

**Prompt injection.** The prompt is untrusted user text that reaches a model whose output is
parsed. The defence is that validation happens on the *response*, not the request: an
injected instruction to "output `<script>`" produces a `kind` or a string that either fails
the schema or lands as inert text. Two rules follow:

- Model output is never concatenated into SQL, Worker source, or shell.
- String fields are capped by `LIMITS` and rendered as text nodes only. The
  `mvp-foundation` test already asserts markup is treated literally.

**Token-cost abuse.** Prompt length is capped at 4 000 characters and output by the provider's
`max_tokens`. Coin cost alone is not a rate limit — `coin-billing` must add per-user
throttling. No auth here means anyone who can reach the port can spend.

**Secret handling.** `LLM_KITA_API_KEY` comes from env only, is never logged, never returned,
and never enters a prompt. `.env` is already gitignored; `.env.example` will be created with
names and no values. Error messages carry the HTTP status, never the key or the provider's
raw body.

**Data sensitivity.** The user's prompt may describe a real business — clinic patient
workflows, shop pricing. It is sent to a third-party provider, which is inherent to the
product and belongs in the privacy copy, not in a mitigation here. It is logged in hashed
form only.

## 6. Performance & Scalability

**Expected load.** A prototype: single-digit concurrent users. The constraint that matters is
provider latency (**5–60 s** per call), not throughput.

**Timeouts.** LLM **60 s** via `AbortController`; provider connection **10 s**. Express
`requestTimeout` set above the LLM timeout so the framework does not cut a call short before
the client's own abort fires.

**No streaming in this blueprint.** The editor shows a step-by-step progress UI; a streamed
response would require restructuring it. Deferred — recorded in Not Doing.

**N+1 risks.** None. Each request makes exactly one provider call. Revision sends the whole
project in one message rather than one call per screen — the latter would multiply cost by
screen count.

**Token budgets.** `max_tokens` **8 000** for generate, **12 000** for revise (it echoes the
existing tree). A 40-screen project at the `LIMITS` caps would exceed any single response;
the caps in the prompt exist so the model self-limits rather than getting truncated
mid-JSON.

**Cold start.** The orchestrator is a long-running Node process, not a Worker, so there is no
cold start. This is why the Node exception in `product.md` §6 exists.

## 7. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Assumed API shape is wrong | High — client unusable | High | `LlmClient` interface; one adapter file to rewrite; prompt and validation unaffected |
| Model ignores the schema and emits HTML anyway | High | Medium | Zod rejects; 422 with issue paths; test suite includes 20 malformed outputs |
| Prompt injection produces a valid-looking but malicious payload | High | Low | Output mapped to whitelist only; no HTML sink; markup rendered as text (tested) |
| Revision drops user edits | Medium | Medium | M-7 requires echoing the tree and warning on dropped ids |
| Unauthenticated endpoint burns tokens | High | High until `coin-billing` | Prompt cap, `max_tokens`, health endpoint does not call provider; documented as a known gap, not mitigated |
| Moving the contract breaks the editor | Medium | Medium | Re-export shim; `tsc` and the 28 existing tests must pass unchanged |
| Provider cost exceeds the 20/5/50 coin guess | Medium | High | `usage` returned per call so cost becomes measurable; pricing stays open until then |
| Provider truncates a long response mid-JSON | Medium | Medium | Caps in prompt; parse failure is a clean 422, not a corrupt project |

## 8. Edge Cases

| Scenario | Expected Behavior | Why It's Tricky |
|----------|-------------------|-----------------|
| Model wraps JSON in ```` ```json ```` fences | Extract the fenced object and validate it | Common even when explicitly forbidden; rejecting it fails users for a harmless formatting habit |
| Model returns JSON plus prose ("Berikut hasilnya: {...} Semoga membantu!") | Locate the first balanced `{...}` span and validate that | Naive `JSON.parse` on the whole body fails; naive regex on `{.*}` breaks on nested braces |
| Model returns a refusal object instead of a project | HTTP 200, `data.refusal` populated, no charge | Must not be treated as malformed; the model behaved correctly |
| Model returns two JSON objects | Use the first valid one, log a `warn` with the count | Ambiguous output is a tuning signal worth seeing |
| `tables` present but `screens` absent | 422 naming `screens` | A model may partially fulfil; silence here would ship a table-less UI |
| Duplicate `screen.id` values | 422 — `screens` has no in-array uniqueness check yet, unlike `blocks` | The blocks check exists and screens does not; this blueprint adds it |
| `kind: "stat"` with `accent` plus an unknown key `html` | `html` stripped, accent kept, 200 | Two different rules on one object; the strip must not also drop valid fields |
| API key valid but provider returns an HTML error page (502 from a proxy) | `LlmMalformedError`, HTTP 502, no charge | Body is not JSON; a naive `res.json()` throws an unhelpful `SyntaxError` |
| Prompt is 4 001 characters of whitespace | HTTP 400 `PROMPT_TOO_LONG` before trim, or trimmed-then-checked — pick trim-then-check | Trimming first means a 5 000-char whitespace prompt passes; not trimming means honest input is rejected for invisible characters. **Decision: trim, then check both the ≥12 and ≤4 000 bounds.** |
| Same prompt submitted twice concurrently | Two independent provider calls | No caching or dedupe in this blueprint; both cost tokens. Accepted for now, noted for `coin-billing` |
| Provider returns `finish_reason: "length"` | 422 `INVALID_SCHEMA` with a detail saying output was truncated | Truncation looks identical to model error otherwise; the distinct detail is what tells the operator to raise `max_tokens` |

## 9. Open Decisions

- [ ] **LLM-Kita endpoint shape.** Assuming OpenAI-compatible. If wrong, the adapter changes
      and nothing else does. Confirm base URL, model name, and auth scheme.
- [ ] **Model name.** Not specified anywhere in the repo. Will be env-driven
      (`LLM_KITA_MODEL`) with no hardcoded default, so a wrong name is a config error, not a
      code change.
- [ ] **Whether to add a `screens` uniqueness check** at the contract level or only in the
      orchestrator. Leaning contract-level, since `blocks` already has one there.
- [ ] **Structured output support.** If LLM-Kita supports `response_format: json_schema`,
      use it and keep Zod as the second line of defence. If not, Zod is the only line.
- [ ] **Rate limiting** before `coin-billing` lands. Currently unmitigated.

## 10. Boundaries

**Technical**

- Node.js 20+ (repo runs Node 26; do not use APIs newer than Node 20 LTS).
- TypeScript strict, matching `apps/editor/tsconfig.json` rigour.
- No new runtime dependency beyond `zod` (already installed) and `express` plus its types.
- Must not require a database. `coin-billing` adds persistence; this blueprint is stateless.
- Must run without Cloudflare credentials.

**Business**

- Copy in Indonesian, identifiers and comments in English (`conventions.md`).
- No pricing decision made here. `COIN_COST` stays untouched.
- The Node exception is justified: provider latency and the need for a long-lived process.

## 11. Not Doing

- **Authentication.** `coin-billing` owns it. This blueprint's endpoint is unauthenticated
  and must not be exposed publicly until that lands.
- **Coin deduction and refunds.** The editor's in-memory ledger is untouched. The response
  reports `usage` so cost is measurable, but no coins move.
- **Streaming responses.** The progress UI is step-based; streaming is a separate redesign.
- **Context Manager persistence.** Revision sends the project in-request. Long-term
  conversation history is a later blueprint.
- **Cloudflare D1 provisioning and publishing.** Still simulated in the editor.
- **Midtrans.** Untouched.
- **The editor→orchestrator wiring.** This blueprint delivers the server and its tests. The
  editor keeps its `setTimeout` until `coin-billing` can debit against a real call, because
  wiring a paid call to an unauthenticated, unmetered endpoint would spend real money with
  no ledger to record it.
- **Adding new block kinds.** `form`, `card`, `chart` stay removed. The prompt describes the
  three that render.
- **Database schema and migrations.** No persistence in this blueprint.

## 12. Depends On

**Internal**

- `apps/editor/src/lib/contract.ts` (moves to `packages/schema/`) — `WHITELISTED_KINDS`,
  `LIMITS`, the schema set, `ContractError`, `toIssues`.
- `apps/editor/src/lib/parse.ts` (moves) — `parseProject`, `parseProjects`.
- `apps/editor/src/lib/contract.test.ts` (moves) — 28 tests that must keep passing.
- Root npm workspace — must be created; no root `package.json` exists today.
- `apps/editor/src/store/useBuilder.ts` — read only, to mirror the refund discipline later.

**External**

- API LLM-Kita — endpoint shape assumed, unconfirmed (Open Decisions).
- Node.js 20+ runtime; Express 4.
- No Cloudflare, Midtrans, or database dependency.

## 13. Revision Log

| Date | Revision | Author |
|------|----------|--------|
| 2026-11-16 | Initial requirements from PRD Fase 2, atlas, and code inspection | Blueprint agent |
