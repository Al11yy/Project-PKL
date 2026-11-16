---
version: 1
slug: "editor-builder"
primary_target: "editor-builder"
related_targets: []
---

# Surface — Editor Builder (Rakit.ai)

Mode: **Operate**. Target: `apps/editor`.

## Scope and visitor mode

The full end-to-end builder flow, first run through publish. Three equal priority personas (UMKM owner, SMK/IT student, local freelancer) reach the same screen with a very wide literacy spread. The screen must serve someone who has never configured a database and someone who does it weekly, without splitting into two modes.

In scope: onboarding/empty, prompt entry, generation progress, generated-app preview, the free visual inspector, the five-stage pipeline, coin balance and spend, publish, and every failure state (generation failed + refund, insufficient coins, publish failed, zero balance).

Out of scope: authentication screens, the marketing site, real LLM integration, Cloudflare provisioning, Midtrans checkout. Generation is simulated client-side so every state stays reachable.

## Audience, job, action, proof

They arrive with an app idea and no design brief. Primary task: reach a deployed app without writing code. Success is a working, published app whose schema and screens they trust.

Proof is the product's own mechanism, shown rather than claimed: a generated app rendered in a real frame, a schema they can read, and a coin ledger that matches what they just did. There are no testimonials, customers, benchmarks, or press — the build must never invent commercial claims, and must never state a Rupiah-per-coin rate (undecided).

## Chosen direction

Category standard executed at full craft — no irony, no smuggled quirk. Craft bar set by the products the user named: **Linear/Stripe Dashboard** for table and state precision, **Figma/Webflow** for the canvas + inspector model, **v0/Lovable/Bolt** for the prompt-to-result rhythm.

Signature moment: **cost is visible before the action**. Every control that spends coins carries its price inline (`Jalankan · −5 koin`); every action that is free says so at the point of use. This is the product rule made interface, not decoration. It is the one thing a competitor's screenshot could not be mistaken for.

## Constraints and open decisions

Binding: the six non-negotiable rules in `CLAUDE.md`. Most visible here — the LLM never emits HTML/JS, so the interface never shows raw markup as an editable artifact, and the inspector edits a JSON node tree locally. Edit is free; it must never route through a coin-charging control. One D1 per project, stated as a promise in the publish step.

Coin prices are user-confirmed and exact: full PRD + UI generation **−20**, AI prompt revision **−5**, manual inspector revision **0**, publish/deploy **−50**.

Undecided: Rupiah-per-coin rate (UI shows coin counts only, never an IDR equivalent), free-tier allowance, formal WCAG target.

---

## Direction contract

THESIS: A working instrument, not a canvas. The category ships a prompt box bolted onto a drag-and-drop editor, pricing discovered at checkout. This surface refuses both: the pipeline is legible at all times and every coin leaves the balance in front of you, priced at the button that spends it.

OWN-WORLD: Near-white ground `#FFFFFF` and panel grey `#FAFAFA` separated by 1px `#E5E7EB` hairlines; ink `#111827` with `#4B5563` body and `#6B7280` metadata. One blue `#2563EB` owns every primary action and nothing else. Semantic pairs carry state and never decorate: `#047857`/`#ECFDF5` success, `#B45309`/`#FFFBEB` warning, `#B91C1C`/`#FEF2F2` failure. Inter carries interface text; JetBrains Mono is spent only on measurement — coin counts, IDs, table numerals, timestamps. Emphasis by weight and size, never gradient or shadow.

STORY: Understand in the first second that this builds an app from a sentence and charges in visible coins. Believe the spend is honest because the price sits on the button and the ledger reconciles. Do the next single step, then publish.

FIRST VIEWPORT: A 248px left rail holds the Rakit.ai mark, three nav items, the project list with per-project schema counts, and a balance card pinned to the bottom. To its right a 56px top bar carries the project name with schema/screen metadata on the left and `Lihat skema` / `Pratinjau` / `Terbitkan · −50 koin` on the right. Below it the prompt row: one full-width input with a `Jalankan · −20 koin` primary beside it and a line naming the free alternative. The remaining height is the preview frame — a real browser chrome bar with the project's `.pages.dev` address and a status pill, and inside it the generated app's own navbar, four stat cards, and a data table, at true density.

FORM: Category standard, taken deliberately at the standing exit the round offered rather than at the roll's assignment. seed: none (pinned) — "Oke, gue setuju dengan brief dan keputusan mempertahankan font Inter", against the craft bar the user named: "v0 / Lovable / Bolt, Figma / Webflow Editor, Linear / Stripe Dashboard".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
