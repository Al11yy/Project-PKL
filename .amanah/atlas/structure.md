# AI-First App Builder for Indonesia — Project Structure & Patterns

> **Status**: **No source code exists yet.** The tree below is the *target* layout to
> create, consistent with the Express + Vite decision. Do not cite these paths as if
> they exist — verify with glob before referencing them in a blueprint.

## Directory Layout (target)

```
.
├── prd_ai_first_app_builder.md      The PRD — current source of truth for requirements
├── .amanah/
│   ├── atlas/                       Project context maps (this folder)
│   ├── blueprints/{feature-name}/   Generated what/how/now or fix.md
│   └── commands/, SKILL.md, AGENT.md  Framework install sources
├── .claude/
│   ├── commands/                    Installed slash commands
│   ├── skills/amanah-blueprint/     Skill (to be installed by /setup)
│   ├── skills/amanah-atlas-generator/
│   └── agents/amanah-blueprint-generator.agent.md
├── apps/
│   ├── editor/                      Vite + React + Tailwind + Zustand (Cloudflare Pages)
│   │   └── src/
│   │       ├── components/impeccable/   Strict component library
│   │       ├── mapper/                  JSON → React component tree
│   │       ├── editor/                  Fallback (click-to-edit) editor
│   │       └── store/                   Zustand stores
│   └── orchestrator/                Express.js (auth, coins, LLM-Kita, Cloudflare API)
│       └── src/
│           ├── routes/              Router layer
│           ├── services/            Business logic (llm, coins, cloudflare)
│           ├── db/                  Platform database + migrations
│           └── prompts/             System prompts forcing strict JSON component output
├── packages/
│   ├── schema/                      Shared Zod schemas: LLM JSON contract, PRD shapes
│   └── generator/                   DDL + Worker source generation templates
└── templates/
    └── worker/                      Template deployed per user project
```

## Code Patterns (intended — enforce from day one)

### Component Mapper Pattern
AI output is untrusted data. Validate, then map. Never `eval`, never `dangerouslySetInnerHTML`.

```ts
// intended shape
const parsed = llmResponseSchema.parse(rawJson);   // Zod — throws on hallucinated tags
const tree = parsed.nodes.map(toImpeccableComponent); // whitelist lookup, unknown => reject
```

### Service Pattern
Route handlers stay thin; all decisions live in services so the same logic can later
move into Workers unchanged.

```ts
// routes/generate.ts
router.post('/generate', requireAuth, async (req, res, next) => {
  const result = await llmService.generatePrd(req.user.id, req.body.prompt);
  res.status(201).json(result);
});
```

### DDL Generation Pattern
Build DDL from the validated schema object with an allowlist of column types and
identifier sanitization. **Never** interpolate the user's prompt into SQL.

## API Response Format (intended)

```json
{ "data": { }, "error": null }
{ "data": null, "error": { "code": "INSUFFICIENT_COINS", "message": "...", "details": { "required": 10, "balance": 3 } } }
```

## Critical Rules

1. All LLM output is validated by Zod before it touches React state.
2. Coin deduction completes before the LLM call; failed calls are refunded/not charged.
3. Every Cloudflare resource is namespaced per project id (D1 name, Worker name, Pages project).
4. Generated SQL identifiers are sanitized; no dynamic SQL from prompt text.
5. Secrets live in env / Cloudflare secrets only.

## Key File Locations

| Need to… | Look at |
|----------|---------|
| Change what the product must do | `prd_ai_first_app_builder.md` |
| Change the LLM JSON contract | `packages/schema/` |
| Change available UI components | `apps/editor/src/components/impeccable/` |
| Change coin pricing | `apps/orchestrator/src/services/coins/` (to be created) |
| Change system prompt constraints | `apps/orchestrator/src/prompts/` (to be created) |
| Change D1/Worker deploy logic | `apps/orchestrator/src/services/cloudflare/` (to be created) |
| Read project context | `.amanah/atlas/*.md` |
