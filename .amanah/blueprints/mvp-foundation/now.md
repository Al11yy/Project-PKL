# Blueprint: mvp-foundation — Action Items

**Status:** Ready · **Date:** 2026-11-16 · **Implements:** `how.md` (rev. 2026-11-16)

---

## 1. Overview

Build the component contract (whitelist array → Zod schema → parse boundary), delete the
three dead block kinds, make `Preview.tsx` an exhaustive switch, and add Vitest. Ten action
items in four waves. Verification comes from `vitest` for the contract and the existing
Playwright harness for regressions.

---

## 2. Action Items

### Wave 1 — Foundation

**1. Install dependencies and add the test script**
`apps/editor/package.json`
- Add `"zod": "^3.23.8"` to `dependencies`; `"vitest": "^2.1.8"` to `devDependencies`.
- Change `"build"` to `"tsc --noEmit && vite build"` (enables AC-1.2).
- Add `"test": "vitest run"` and `"test:watch": "vitest"`.
- Run `npm install` inside `apps/editor`.
_Ref: M-6.1, AC-1.2, Q-2_

**2. Create `apps/editor/src/lib/contract.ts`**
- `WHITELISTED_KINDS = ['navbar','stat','table'] as const`
- `ACCENT_VALUES = ['warn','action','ok'] as const`
- `LIMITS = { maxScreens: 40, maxBlocksPerScreen: 200, maxTitleLength: 120, maxBodyLength: 2000, maxIdLength: 64 }`
- `idSchema` — 1–64 chars, `/^[A-Za-z0-9_.:-]+$/`
- `optionalText(max)` — `.nullish().transform(v => v ?? undefined)`
- `blockSchema` — `.superRefine` rejecting `accent` on any kind outside `ACCENT_KINDS`
- `screenSchema` — duplicate-`id` detection across `blocks`
- `tableSchema`, `columnSchema`, `projectSchema`
- Export inferred types: `ParsedUIBlock`, `ParsedScreen`, `ParsedProject`
_Ref: M-1, M-2, AC-1.1, AC-2.1–AC-2.5, O-4_

**3. Create `apps/editor/src/lib/parse.ts`**
- `class ContractError extends Error` with `code = 'INVALID_SCHEMA'` and `issues[]`
- `quote()` helper truncating quoted values to 40 chars
- `parseProject`, `parseProjects`, `parseProjectsOrThrowAtStartup`
- Never mutates state on failure; throws before any caller can set
_Ref: M-3, AC-3.1_

### Wave 2 — Wire the boundary

**4. Narrow `apps/editor/src/lib/types.ts`**
- Import `BlockKind` and the parsed types from `./contract`; re-export `BlockKind`.
- Replace `UIBlock`, `Screen`, `Project`, `Table`, `Column` interfaces with aliases to the
  inferred types. Remove `'form' | 'card' | 'chart'` from the union (now derived).
- **Leave `COIN_COST`, `PIPELINE`, `PipelineStage`, `StageState`, `LedgerEntry` untouched.**
_Ref: M-4, AC-4.1, O-1_

**5. Parse seed at the store boundary — `apps/editor/src/store/useBuilder.ts`**
- Add `const INITIAL_PROJECTS = parseProjectsOrThrowAtStartup(SEED_PROJECTS)` at module scope.
- Initialise `projects: INITIAL_PROJECTS`.
- Narrow the `updateBlock` patch type: `accent?: 'warn' | 'action' | 'ok' | undefined`.
- **Do not add a parse call inside `updateBlock`** — that is the free path and must stay
  instant.
_Ref: M-3, AC-3.1, Q-3_

**6. Add the invalid-output toast path**
- In `runGeneration`, wrap the final project mutation in `try/catch` for `ContractError`,
  emitting a `danger` toast: `Output tidak valid — {message}`.
- This is the only place a parse failure can surface today; the LLM is not connected.
_Ref: M-3, error handling table_

### Wave 3 — Renderer

**7. Make `Preview.tsx` an exhaustive switch — `apps/editor/src/components/preview/Preview.tsx`**
- Add `renderBlock(block, inspectOpen, selected, onSelect)` with a `switch (block.kind)`
  whose `default` assigns to `never` and throws.
- `ScreenView` partitions into nav/stats/rest as today and calls `renderBlock` for `rest`.
- Add the explicit empty state: `Layar ini belum memiliki blok.`
_Ref: M-4, AC-3.2, AC-4.2_

**8. Extend `StatBlock` accents**
- Replace `const warn = block.accent === 'warn'` with
  `const ACCENT_CLASS = { warn: 'text-warn-ink', action: 'text-action', ok: 'text-ok-ink' }`
  and `const accentClass = block.accent ? ACCENT_CLASS[block.accent] : 'text-ink'`.
- Confirm `Inspector.tsx` still compiles with the narrowed accent union (it does — its
  `ACCENTS` ids are the same three plus `default`).
_Ref: M-5, AC-5.1–AC-5.3_

### Wave 4 — Tests and verification

**9. Write `apps/editor/src/lib/contract.test.ts`**
Cover: every whitelisted kind accepted; unknown kind rejected and named; navbar with
title; markup treated as literal; unknown accent rejected; missing/empty id rejected;
`null` title normalised to `undefined`; accent allowed on `stat` and rejected on `navbar`;
unknown keys stripped; over-cap text rejected; non-object throws `ContractError`; duplicate
block ids rejected; block count cap enforced.
_Ref: M-6, AC-6.1, Property 1–7_

**10. Add Vitest config to `apps/editor/vite.config.ts`**
- Add `/// <reference types="vitest" />` and a `test: { environment: 'node', include: ['src/**/*.test.ts'] }` block.
- Keep `server: { port: 5180, strictPort: true }` unchanged.
_Ref: Q-2, AC-6.1_

**11. Append the banned-API check to `apps/editor/.shots/verify.mjs`**
- After the existing loop, run a `grep` for `dangerouslySetInnerHTML|new Function|eval(`
  across `src/` and report a failure if any match is found.
_Ref: AC-3.3, Q-4_

---

## 3. Checkpoints

**Checkpoint A — after Wave 1 (items 1–3).**
`npx tsc --noEmit` passes with the new files present but nothing importing them yet. No
runtime behaviour has changed. Confirm `npm install` added zod and vitest to
`package-lock.json`.

**Checkpoint B — after Wave 2 (items 4–6).**
`npx tsc --noEmit` passes. `npm run dev` still renders all three seed projects. If the seed
violates the new schema, the app throws at module load with a message naming the failing
path — that is the intended loud failure, and means the seed needs fixing, not the schema.

**Checkpoint C — after Wave 3 (items 7–8).**
Visually identical to before except accent behaviour on `stat`. `node .shots/flow.mjs`
still prints `BALANCE_AFTER_REFUND: 128`.

**Checkpoint D — after Wave 4 (items 9–11).**
`npm test` green. `node .shots/verify.mjs` reports `ERRORS: none` at 1440/1280/1024 with no
overflow regression. `npm run build` succeeds and the gzip size delta is recorded.

---

## 4. Notes

- **Ordering matters.** `contract.ts` must exist before `types.ts` imports from it. Wave 2
  will not typecheck until Wave 1 is complete; do not reorder.
- **`lib/` must not import from `components/`.** The accent list is therefore duplicated as
  a literal in `contract.ts`. A comment marks this; if it ever drifts, the
  `superRefine` test catches it.
- **Do not re-parse in `updateBlock`.** It is the free-editor path; a parse per keystroke
  costs latency for no safety (the values come from bounded `<input maxLength>`).
- **`BlockKind` is now derived.** Any `'form' | 'card' | 'chart'` branch anywhere would fail
  to compile. There are none (`grep` confirmed before writing `how.md`), so removal is safe.
- **`Table` and `Column`** are re-exported as inferred aliases so `SchemaView.tsx` and
  `seed.ts` compile unchanged.
- **Bundle cost is accepted** (user decision). Measure before/after, do not optimise.
- **`accent` narrowing is schema-only.** `UIBlock` is a single inferred type, so TypeScript
  cannot narrow `accent` by `kind` without a discriminated union. Runtime is safe; a
  discriminated union is a future improvement, deliberately out of scope.
- **Existing screenshots** in `.shots/*.png` are gitignored and will be stale after this
  change. Re-run `shot.mjs` if they are needed for review.

---

## 5. Dependency Graph

```json
{
  "waves": [
    {
      "id": 1,
      "name": "Foundation",
      "items": [1, 2, 3],
      "blocks": [2, 3, 4]
    },
    {
      "id": 2,
      "name": "Wire the boundary",
      "items": [4, 5, 6],
      "dependsOn": [1],
      "blocks": [4, 5]
    },
    {
      "id": 3,
      "name": "Renderer",
      "items": [7, 8],
      "dependsOn": [2],
      "blocks": [4]
    },
    {
      "id": 4,
      "name": "Tests and verification",
      "items": [9, 10, 11],
      "dependsOn": [3]
    }
  ],
  "criticalPath": [1, 2, 4, 5, 7, 9],
  "parallelizable": [
    [9, 10, 11]
  ]
}
```

---

## 6. Revision Log

| Date | Revision | Author |
|------|----------|--------|
| 2026-11-16 | Initial action plan from `how.md` rev. 2026-11-16 | Blueprint agent |
| 2026-11-16 | Execution complete. Deviations from plan, all deliberate — see below | Blueprint agent |

---

## 7. Execution Notes — Deviations from `how.md`

**7.1 Zod 4.6.7, not 3.23.** `npm audit` flagged CVE-2023-54404 (high) on zod < 4.6.6 —
memory exhaustion while validating oversized constrained collections. `how.md` specified
`^3.23`, which left the advisory open. The described vector does not reach this code (every
array carries `.max()`), but shipping a known-open advisory is not a defensible default, so
the major bump was taken. User decision, 2026-11-16. `npm audit --omit=dev` now reports
**0 vulnerabilities**.

**7.2 `.optional()` re-applied after `.transform()`.** Zod 4 makes a transformed key
required-with-type-`T | undefined`. Without the trailing `.optional()`, every seed literal
would have to spell `title: undefined`, `accent: undefined`, `note: undefined` — noise that
makes hand-written data look like it is doing something. Found by `tsc`, fixed in the schema
rather than patched at 24 call sites in `seed.ts`.

**7.3 `kind` is a `refine` over the whitelist, not `z.enum`.** Zod's enum message lists the
allowed values but not the rejected one, so AC-2.1 ("reject with an error naming the
offending value") could not be met by the enum alone. `kind` is now
`z.string().refine(isWhitelistedKind)`, and `parse.ts` names the received value from the raw
payload by key. The accepted set is still derived from `WHITELISTED_KINDS`.

**7.4 The AC-2.1 test moved to the parse boundary.** The first version asserted against raw
Zod issues, which is not where a user reads the error. Asserting `toThrow(/iframe/)` on
`parseProject` tests the path that actually produces the message.

**7.5 `ACCENTS` in `Inspector.tsx` is now typed against the contract.** Its `id` was inferred
as `string`; it is now `'default' | Accent`, so adding a swatch without adding it to
`ACCENT_VALUES` is a compile error rather than a control that does nothing.

**7.6 `action` uses `text-action`, not `text-action-ink`.** The palette defines
`action.DEFAULT` (`#2563EB`) but no `ink` shade, unlike `ok` and `warn`. The rendered colour
matches the inspector swatch, which is what matters.

**7.7 Bundle delta is larger than estimated.** Measured, not guessed:
`184.06 kB / 57.25 kB gzip` before → `276.41 kB / 83.94 kB gzip` after. Delta
**+92.35 kB raw, +26.69 kB gzip** — roughly double `how.md`'s +13 kB estimate. Still
accepted (user decision), but the figure in `how.md` was wrong and is corrected here.

**7.8 `sr-only` overflow is pre-existing.** `verify.mjs` reports a
`LABEL.sr-only` overflow at all three widths. Reproduced on a stashed working tree, so it is
not a regression from this blueprint — it is the expected geometry of a visually-hidden
element. Left alone; noted so it is not mistaken for new breakage.

**7.9 Not verified.** The invalid-output refund path in `runGeneration` (item 6) is reachable
only by a prompt over 2,000 characters, and no test exercises it end to end. The guard is in
place for the orchestrator to hit; its UI behaviour is unproven. Stated rather than implied.
