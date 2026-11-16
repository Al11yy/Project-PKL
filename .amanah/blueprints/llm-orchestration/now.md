# LLM Orchestration — Action Plan

> **Status**: Ready to execute
> **Requirements**: `what.md` (rev. 2026-11-16, approved)
> **Design**: `how.md` (rev. 2026-11-16, approved)
> **Predecessor**: `mvp-foundation` @ `730b7c1`

## 1. Overview

Six waves. Wave 1 creates the workspace and moves the contract; it must land entirely before
Wave 2, because the orchestrator cannot import `@rakit/schema` until the package exists.
Waves 2–5 build the orchestrator bottom-up (config → client → prompt → service → routes).
Wave 6 runs every verification gate and updates the atlas.

Each checkpoint is a real gate. Do not proceed past a failing checkpoint by fixing it later —
the whole point of moving the contract first is that the editor's 28 tests prove the move was
clean before any new code depends on it.

## 2. Action Items

### Wave 1 — Workspace and contract extraction

**1.1** Create root `package.json`

- File: `package.json` (new)
- Content: exactly as `how.md` §3.2. Workspaces `["apps/*", "packages/*"]`.

**1.2** Create `packages/schema/package.json`

- File: `packages/schema/package.json` (new)
- Content: exactly as `how.md` §3.2. Dependencies: `zod` only.
- _Ref: M-1_

**1.3** Create `packages/schema/tsconfig.json`

- File: `packages/schema/tsconfig.json` (new)
- Content: exactly as `how.md` §3.2.
- **The `lib` array must be `["ES2020"]` with no `"DOM"`.** This is the mechanical guarantee
  that no browser API enters the shared contract.
- _Ref: M-1, Q-5_

**1.4** Move `contract.ts`

- From: `apps/editor/src/lib/contract.ts`
- To: `packages/schema/src/contract.ts`
- Move verbatim first. Then **append** `llmProjectSchema`, `llmProjectSchemaWithUniqueScreens`,
  `llmEnvelopeSchema`, `isRefusal`, and `type LlmProject` from `how.md` §3.2.
- Then **add** the screen-uniqueness refinement to `projectSchema` (`how.md` §4):
  ```ts
  export const projectSchema = z.object({ /* ...existing... */ })
    .superRefine((project, ctx) => { /* duplicate screen id check */ })
  ```
  Reuse the same loop as `llmProjectSchemaWithUniqueScreens` — extract it into a shared
  `checkUniqueScreenIds(project, ctx)` helper rather than writing it twice.
- _Ref: M-1, M-2_

**1.5** Move `parse.ts`

- From: `apps/editor/src/lib/parse.ts`
- To: `packages/schema/src/parse.ts`
- Move verbatim. Its `import { projectSchema } from './contract'` still resolves.
- _Ref: M-1_

**1.6** Create `packages/schema/src/assemble.ts`

- File: `packages/schema/src/assemble.ts` (new)
- Content: exactly as `how.md` §3.2 (`assembleProject`, `auditAccents`, `AssembleOptions`).
- _Ref: M-2, M-5_

**1.7** Create `packages/schema/src/index.ts`

- File: `packages/schema/src/index.ts` (new)
- Content: three `export *` lines from `how.md` §3.2.
- **Do not** `export *` from a barrel that pulls in `assemble.ts` for the editor — verify the
  editor bundle size afterwards (gate 6.3). `assemble.ts` imports only `contract`/`parse`, so
  tree-shaking should drop it from the editor, but measure rather than assume.

**1.8** Move and update the contract tests

- From: `apps/editor/src/lib/contract.test.ts`
- To: `packages/schema/src/contract.test.ts`
- Change **only** the two import paths: `'./contract'` and `'./parse'` already resolve from the
  new location, so this may be a pure copy. Verify no other edit was needed — if one is, note it.
- _Ref: M-1_

**1.9** Replace editor files with re-export shims

- Files: `apps/editor/src/lib/contract.ts`, `apps/editor/src/lib/parse.ts`
- Content: `export * from '@rakit/schema'` (with the explanatory comment from `how.md` §3.2).
- The five import sites (`Inspector.tsx`, `types.ts`, `useBuilder.ts`, two in the moved test)
  stay unchanged.
- _Ref: M-1_

**1.10** Add `@rakit/schema` to the editor's dependencies

- File: `apps/editor/package.json`
- Add `"@rakit/schema": "*"` to `dependencies`. Keep `"zod"` — the shim re-exports types that
  reference it and the test imports `z` directly.

**1.11** Reinstall and delete the editor's nested lockfile

- Run `npm install` from the repo root. npm will create `package-lock.json` at root and hoist
  `node_modules`.
- Delete `apps/editor/package-lock.json` **after** the root lockfile exists and `npm install`
  has succeeded, then re-run `npm install` from root so the lockfile is authoritative.
- Verify `apps/editor/node_modules` is either gone or contains only unhoistable packages.

#### Checkpoint 1 — the move is clean

```bash
npm install
npm run typecheck --workspaces     # must print nothing
npm test --workspaces              # 28 tests, all passing
cd apps/editor && npm run build    # must succeed
```

**Gate 1.1**: `packages/schema/src/` imports only `zod` or relative paths:
`grep -rE "^import" packages/schema/src/ | grep -v "from 'zod'" | grep -v "from '\./"` → no output.

**Gate 1.2**: `packages/schema/package.json` dependencies are exactly `{"zod": "^4.6.7"}`.

**Gate 1.3**: A bare Node script importing the package with no React present succeeds — this is
Q-5. Verify with `npx tsx -e "import('@rakit/schema').then(m => console.log(m.WHITELISTED_KINDS))"`.

**Gate 1.4**: Editor bundle no larger than **277.4 kB** (277.41 baseline − 276.41 = +1 kB).

**Gate 1.5**: `cd apps/editor && node .shots/verify.mjs` → `ERRORS: none`.

### Wave 2 — Orchestrator scaffold, config, logger

**2.1** Create `apps/orchestrator/package.json`

- File: `apps/orchestrator/package.json` (new)
- Content: `how.md` §3.3. Add `fast-check` and `supertest` to devDependencies (approved).

**2.2** Create `apps/orchestrator/tsconfig.json`

- File: `apps/orchestrator/tsconfig.json` (new)
- Content: `how.md` §3.3. `lib: ["ES2022"]`, `types: ["node"]`.

**2.3** Create `apps/orchestrator/.env.example`

- File: `apps/orchestrator/.env.example` (new)
- Content: `how.md` §3.3. Names and defaults only, no values.

**2.4** Create `apps/orchestrator/src/config.ts`

- File: `apps/orchestrator/src/config.ts` (new)
- Content: `how.md` §3.3 (`LlmConfig`, `ConfigError`, `loadLlmConfig`, `loadServerConfig`,
  `PROMPT_MIN_LENGTH`, `PROMPT_MAX_LENGTH`).
- Port default **5 181**.
- _Ref: M-4, M-6_

**2.5** Create `apps/orchestrator/src/logger.ts`

- File: `apps/orchestrator/src/logger.ts` (new)
- Content: `how.md` §3.3. The `redact` function is the Q-3 guarantee — `prompt` and `content`
  become `[N chars]`, secret-named keys become `[redacted]`.
- _Ref: Q-3_

**2.6** Create `apps/orchestrator/src/ids.ts`

- File: `apps/orchestrator/src/ids.ts` (new)
- Content: `how.md` §3.3. `projectId` prefix `p-` + UUID; must pass `projectSchema`'s `idSchema`.

#### Checkpoint 2

```bash
cd apps/orchestrator && npx tsc --noEmit
```

**Gate 2.1**: `npx tsx -e "import('./src/ids.ts').then(m => console.log(m.projectId()))"` prints a
`p-<uuid>` that matches `^[A-Za-z0-9_.:-]+$`.

### Wave 3 — LLM client

**3.1** Create `apps/orchestrator/src/llm/errors.ts`

- File: `apps/orchestrator/src/llm/errors.ts` (new)
- Content: `how.md` §3.3. Five subclasses, each with a fixed `code` and `httpStatus`.
- **No message may interpolate the request or the response body.** Provider status only.
- _Ref: M-4, Q-3_

**3.2** Create `apps/orchestrator/src/llm/client.ts`

- File: `apps/orchestrator/src/llm/client.ts` (new)
- Content: `how.md` §3.3. Exactly one method on `LlmClient`.
- _Ref: M-4, D-4_

**3.3** Create `apps/orchestrator/src/llm/openai-compatible-client.ts`

- File: `apps/orchestrator/src/llm/openai-compatible-client.ts` (new)
- Content: `how.md` §3.3. Retry policy: 429/5xx once, 401/403 never.
- **`AbortSignal.any` requires Node 20+**; the floor in `what.md` §10 allows it.
- _Ref: M-4, Q-2_

**3.4** Write `apps/orchestrator/src/llm/openai-compatible-client.test.ts`

- File: `apps/orchestrator/src/llm/openai-compatible-client.test.ts` (new)
- 11 tests from `how.md` §7. Use `vi.stubGlobal('fetch', ...)` — no network.
- Must include: **401 records exactly one fetch call** (Property 9), and **the configured API
  key never appears in any thrown error's message** (Property 7).
- _Ref: M-4, Q-2, Q-3_

#### Checkpoint 3

```bash
cd apps/orchestrator && npx tsc --noEmit && npx vitest run src/llm
```

All client tests pass with no network access.

### Wave 4 — System prompt and JSON extraction

**4.1** Create `apps/orchestrator/src/prompt/system-prompt.ts`

- File: `apps/orchestrator/src/prompt/system-prompt.ts` (new)
- Content: `how.md` §3.3 (`EXAMPLE_RESPONSE`, `buildSystemPrompt`, `buildGenerateMessage`,
  `buildReviseMessage`, `PROMPT_BOUNDS`).
- Every list interpolated from `@rakit/schema` — no kind or accent literal typed by hand.
- _Ref: M-3, D-3_

**4.2** Write `apps/orchestrator/src/prompt/system-prompt.test.ts`

- File: `apps/orchestrator/src/prompt/system-prompt.test.ts` (new)
- 8 tests from `how.md` §7. The kind test must iterate `WHITELISTED_KINDS`, not list literals.
- Must include: **the example response's kinds are all whitelisted** — parse `EXAMPLE_RESPONSE`
  and assert every `kind` is in the whitelist, so the example cannot teach a rejected kind.
- _Ref: M-3, Property 6_

**4.3** Create `apps/orchestrator/src/llm/extract-json.ts`

- File: `apps/orchestrator/src/llm/extract-json.ts` (new)
- Content: `how.md` §3.3. The balanced-brace scanner must track string state and escapes.
- _Ref: M-5, D-4_

**4.4** Write `apps/orchestrator/src/llm/extract-json.test.ts`

- File: `apps/orchestrator/src/llm/extract-json.test.ts` (new)
- 12 named cases plus a `fast-check` property: **for all** valid project JSON and all three
  wrappers, extraction returns a deep-equal value (Property 3).
- Must include the brace-inside-string case: `{"body": "pakai {kurung}"}` extracts whole.
- _Ref: M-5, Property 3_

#### Checkpoint 4

```bash
cd apps/orchestrator && npx vitest run src/prompt src/llm/extract-json.test.ts
```

### Wave 5 — Service, routes, app, server

**5.1** Create `apps/orchestrator/src/errors.ts`

- File: `apps/orchestrator/src/errors.ts` (new)
- Content: `how.md` §3.3 (`ApiError`, `ApiErrorException`, constructors, `toApiError`).
- `toApiError` maps three shapes and returns a generic 500 for everything else — never echo an
  unknown error's message.
- _Ref: Q-4, M-8_

**5.2** Create `apps/orchestrator/src/services/generation.ts`

- File: `apps/orchestrator/src/services/generation.ts` (new)
- Content: `how.md` §3.3 (`GenerationOutcome`, `checkPrompt`, `parseEnvelope`,
  `generateProject`, `reviseProject`, `droppedScreenIds`).
- `checkPrompt` trims **then** checks both bounds — the decision approved in `what.md` §8.
- _Ref: M-5, M-6, M-7, Property 5_

**5.3** Create `apps/orchestrator/src/routes/index.ts`

- File: `apps/orchestrator/src/routes/index.ts` (new)
- Content: `how.md` §3.3. Three routes; `res.on('close')` aborts the provider call when the
  client disconnects.
- Health must **not** call the provider.
- _Ref: M-6_

**5.4** Create `apps/orchestrator/src/app.ts`

- File: `apps/orchestrator/src/app.ts` (new)
- Content: `how.md` §3.3. Body limit `32kb`; one error handler for the whole app.
- The error handler must keep four parameters so Express identifies it as an error handler.
- _Ref: M-8_

**5.5** Create `apps/orchestrator/src/server.ts`

- File: `apps/orchestrator/src/server.ts` (new)
- Content: `how.md` §3.3. Config validated before the app is built; graceful shutdown.
- _Ref: M-4_

**5.6** Write `apps/orchestrator/src/services/generation.test.ts`

- File: new. 9 tests from `how.md` §7, against `ScriptedLlmClient`.
- Must include: refusal returns `kind: 'refusal'` (no throw), and a dropped-screen revision
  logs a warn without failing.
- _Ref: M-5, M-7_

**5.7** Write `apps/orchestrator/src/app.test.ts`

- File: new. `supertest(createApp(fakeClient))`, no listening socket.
- 10 route tests from `how.md` §7, plus: **no 200 response contains a project failing
  `projectSchema`** (Property 2), and **every 4xx/5xx has non-empty `error.code` and
  `error.message`** (Q-4).
- _Ref: M-5, M-6, M-8, Q-1, Q-4_

**5.8** Write `apps/orchestrator/src/errors.test.ts`

- File: new. Property 7: with a sentinel API key, no log line or error message contains it.

#### Checkpoint 5

```bash
cd apps/orchestrator && npx tsc --noEmit && npx vitest run
```

### Wave 6 — Verification and atlas

**6.1** Run every gate in §4 below.

**6.2** Start the orchestrator and smoke-test it by hand

```bash
cd apps/orchestrator && npm run dev
curl -s localhost:5181/api/v1/health | jq
curl -s -X POST localhost:5181/api/v1/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"sistem kasir untuk klinik"}' | jq
```

Expected without credentials: health returns `llmConfigured: false`; generate returns a 502
`LLM_UNAVAILABLE` or `LLM_AUTH_FAILED`, **not** a 200. Record the actual result.

**6.3** Update `.amanah/atlas/structure.md` — `packages/schema/` and `apps/orchestrator/` move
from "Planned" to "actual"; add the new files.

**6.4** Update `.amanah/atlas/tech.md` — `zod`, `express`, `vitest` move from "intended" to
"installed"; record ports 5 180/5 181; record that the editor's lockfile moved to root.

**6.5** Update `.amanah/atlas/quickstart.md` — the env block now names `LLM_KITA_MODEL`;
`npm test` works; add the orchestrator dev command.

**6.6** Update `.amanah/atlas/conventions.md` — promote the orchestrator rules from "Binding" to
"Observed"; add `@rakit/schema` to the import-order example.

**6.7** Update `TODO.md` — replace `apps/api/` with `apps/orchestrator/` (the naming conflict
resolved in `what.md`); tick the LLM-Kita and Zod items.

**6.8** Update `.amanah/blueprints/mvp-foundation/now.md` — its execution notes cite
`apps/editor/src/lib/contract.ts`, which no longer holds the definition. Add a pointer.

## 3. Checkpoints

| # | After | Gate |
|---|-------|------|
| 1 | Wave 1 | 28 tests pass; `packages/schema` imports only zod; editor bundle ≤ 277.4 kB; `verify.mjs` clean |
| 2 | Wave 2 | `tsc` clean; `projectId()` matches `idSchema` |
| 3 | Wave 3 | All client tests pass offline; 401 makes exactly one call |
| 4 | Wave 4 | Prompt tests pass incl. example-kind check; extraction property holds |
| 5 | Wave 5 | Full orchestrator suite green; `tsc` clean |
| 6 | Wave 6 | All §4 gates; atlas and TODO updated |

## 4. Verification Gates

```bash
# From repo root
npm run typecheck --workspaces
npm test --workspaces

# Package boundary
grep -rE "^import" packages/schema/src/ | grep -v "from 'zod'" | grep -v "from '\./"   # empty
node -e "console.log(Object.keys(require('./packages/schema/package.json').dependencies))"  # ["zod"]

# Editor unaffected
cd apps/editor
npm run build                       # summarise bundle: must be ≤ 277.4 kB
node .shots/verify.mjs              # ERRORS: none
node .shots/flow.mjs                # BALANCE_AFTER_REFUND: 128

# Orchestrator
cd ../orchestrator
npx tsc --noEmit
npx vitest run
```

## 5. Notes

**Ordering is load-bearing.** Wave 1 must complete before Wave 2; nothing else is strictly
ordered, but the orchestrator builds bottom-up (config → client → prompt → service → routes) so
each layer can be typechecked before the next exists.

**Do not wire the editor to the orchestrator.** `what.md` §11 excludes it: the endpoint has no
auth and no ledger, so connecting a paid call would spend real money with no record. The
editor keeps its `setTimeout`.

**`zod` stays a direct dependency of `apps/editor`** even after the move — the shim re-exports
types that reference it, and `contract.test.ts` imports `z` directly.

**Lockfile.** After Wave 1 the root `package-lock.json` is authoritative and
`apps/editor/package-lock.json` is deleted. Confirm `git status` shows the deletion, and that
the editor's `.gitignore` needs no change (`node_modules/` is already covered).

**Node floor.** `AbortSignal.any` and `fetch` are Node 18+/20+ APIs. The repo runs Node 26;
`what.md` §10 sets Node 20 LTS as the floor.

**`fast-check` and `supertest`** are devDependencies in `apps/orchestrator` only. Nothing
runtime depends on them.

**If the assumed LLM-Kita shape is wrong**, only
`openai-compatible-client.ts` changes. The prompt, extraction, validation, routes, and app are
unaffected — that is what `LlmClient` is for.

## 6. Dependency Graph

```json
{
  "waves": [
    {
      "id": "wave-1",
      "name": "Workspace and contract extraction",
      "items": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "1.11"],
      "dependsOn": []
    },
    {
      "id": "wave-2",
      "name": "Orchestrator scaffold, config, logger",
      "items": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6"],
      "dependsOn": ["wave-1"]
    },
    {
      "id": "wave-3",
      "name": "LLM client",
      "items": ["3.1", "3.2", "3.3", "3.4"],
      "dependsOn": ["wave-2"]
    },
    {
      "id": "wave-4",
      "name": "System prompt and JSON extraction",
      "items": ["4.1", "4.2", "4.3", "4.4"],
      "dependsOn": ["wave-2"]
    },
    {
      "id": "wave-5",
      "name": "Service, routes, app, server",
      "items": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8"],
      "dependsOn": ["wave-3", "wave-4"]
    },
    {
      "id": "wave-6",
      "name": "Verification and atlas",
      "items": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8"],
      "dependsOn": ["wave-5"]
    }
  ]
}
```

## 7. Revision Log

| Date | Revision | Author |
|------|----------|--------|
| 2026-11-16 | Initial action plan from `how.md` rev. 2026-11-16 | Blueprint agent |
