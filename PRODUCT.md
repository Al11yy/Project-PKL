# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Locked in project instructions (`CLAUDE.md`), not re-asked during init:

- Frontend editor: Vite + React + Tailwind CSS + Zustand, hosted on Cloudflare Pages
- Backend core: Express.js (Node.js + TypeScript)
- AI engine: API LLM-Kita, strict JSON output
- User project DB: Cloudflare D1, one database per project
- User project compute: Cloudflare Workers
- Payments: Midtrans (QRIS / Virtual Account), IDR prepaid coins

No source code exists yet. The repository is documentation only.

## Users

Three personas, all treated as equal priority for MVP (confirmed; do not narrow to one without asking):

- **Tech-savvy UMKM** — small business owners (shops, clinics) who need digitalization. Not developers. Deterred by monthly USD subscriptions from foreign platforms.
- **Siswa SMK / mahasiswa IT** — students building coursework or freelance projects. Blocked by blank-canvas paralysis at design time.
- **Freelancer web lokal** — developers taking many small-app orders. Lose time to CSS styling and server/database setup.

The wide spread in technical literacy is the defining constraint on the interface: the editor must serve people who have never configured a database and people who do it weekly.

## Product Purpose

A low-code/no-code platform where a user describes an app in plain language and receives a generated database schema plus a working full-stack application, deployed to Cloudflare. It replaces the traditional drag-and-drop learning curve with a "PRD-to-UI" pipeline.

Success means a user reaches a deployed, working app without writing code or configuring infrastructure.

## Positioning

The differentiator is the combination of three things that neighboring builders do not hold together:

1. **Local payment reality** — prepaid IDR coin balance via QRIS / Virtual Account, no fixed monthly subscription in USD.
2. **Edge latency and infrastructure on Cloudflare** — Pages, Workers, D1 auto-provisioned per project rather than a shared multi-tenant backend.
3. **Constrained generation** — the LLM never emits HTML or JavaScript. It returns JSON, validated by Zod, mapped only to a whitelisted component library. Unknown components are rejected.

Point 3 is the mechanism a competitor could not truthfully copy without rebuilding their generation pipeline.

## Operating Context

The core workflow, in order:

1. **Initiation** — user types a raw app idea as a prompt.
2. **PRD & schema generation** — the Node.js orchestrator sends the prompt to LLM-Kita, which returns a simple PRD structure and a JSON database schema.
3. **UI rendering** — the React frontend reads the JSON and maps it to static components from the approved library.
4. **Iterative refinement** — the user edits the generated result in a visual fallback editor (text, images, base colors).
5. **Instant deployment** — "Publish" compiles the code and deploys to Cloudflare Pages plus D1/Workers.

Users arrive with an app idea, not a design brief. They will not provide wireframes, brand palettes, or component specifications. The platform supplies that structure.

## Capabilities and Constraints

**Confirmed functionality (from PRD):**

- Generative UI engine: strict component library, JSON-to-component mapper, visual fallback editor
- AI orchestrator: context manager holding conversation history and live schema, plus a prompt system that forbids HTML/JS output
- Cloudflare infrastructure: D1 auto-provisioning via DDL at schema approval, generated REST CRUD endpoints deployed as Workers
- Billing: prepaid coin wallet funded through Midtrans, deducted on each LLM call and on D1 free-tier overage

**Non-negotiable rules that constrain interface design:**

1. The LLM never emits HTML or JS. Output is JSON validated by Zod and mapped to whitelisted components only.
2. Coins are deducted before the LLM call and refunded on failure. Ledger-based with atomic conditional updates — never a bare mutable balance column. The UI must surface balance and deduction state honestly.
3. Visual Fallback Editor edits cost zero coins. This must read as clearly free to the user at the point of use.
4. One D1 database per user project. No cross-tenant tables.
5. No secrets in code. Generated Workers receive no platform secrets.
6. All external calls have explicit timeouts.

**Surface scope (confirmed):** two distinct interface families are in scope, and the user chose two separate `DESIGN.md` files rather than one shared system:

- The builder platform itself — editor, dashboard, billing. Operate-mode surface.
- The component library that generated user apps are built from. Must stay generic enough to serve apps across many industries and visual identities.

Neither `DESIGN.md` exists yet. Both are established later, by the new-work flow, not by init.

**Open decisions (not decided — do not invent):**

- **Product name.** The PRD carries a placeholder `[Nama Platform/Codename]`. No brand name, logo, or wordmark exists.
- Pricing: no coin-to-Rupiah rate, no per-operation coin cost, and no free-tier allowance are specified. Do not state or imply numbers in any interface copy.
- Deployment claims: no SLA, uptime figure, scale claim, or customer count is established anywhere.

## Brand Commitments

None confirmed. No name, logo, voice guide, or binding visual reference exists. The PRD's mention of "Impeccable Style" refers to this repository's component convention, not to a purchased identity.

## Evidence on Hand

- `prd_ai_first_app_builder.md` — the requirements source of truth.
- `CLAUDE.md` — locked stack and the six non-negotiable rules.
- `.amanah/atlas/*.md` — PRD-derived context maps (product, tech, structure, conventions, quickstart).

**Absences future work must not fabricate:** no testimonials, no named customers, no case studies, no benchmarks, no press coverage, no usage statistics, no screenshots or mockups, no logo assets.

## Product Principles

1. **The output is constrained by design.** Generation quality comes from a narrow whitelist, not from broader model freedom. Any interface that exposes raw generated markup breaks the product's core guarantee.
2. **Free editing must stay visibly free.** The fallback editor is where users recover from a bad generation. If editing feels metered, users will re-prompt instead and burn coins.
3. **One technical-literacy floor serves all users.** Advanced controls are progressively disclosed, never assumed. A shop owner and a freelancer use the same surface at different depths.
4. **Money moves in legible units.** Prepaid coins, explicit deduction, refund on failure, zero-cost edits. No silent charges, no subscription framing.
5. **The user's app is theirs alone.** Per-project databases and secret-free Workers are visible product promises, not only infrastructure details.

## Accessibility & Inclusion

No product-specific accessibility standard has been confirmed. The audience spans students and small-business owners on varied devices and bandwidth, so low-end Android and constrained mobile connections are a realistic operating condition rather than an edge case. A formal target (WCAG level, minimum device baseline) remains undecided.
