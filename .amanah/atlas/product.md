# AI-First App Builder for Indonesia — Product Overview

> **Source of truth**: `prd_ai_first_app_builder.md` (Draft v1.0). This project has **no
> code yet** — this atlas documents the *intended* product so blueprints match the PRD.
> Update this file the moment real code contradicts it.

## What Is This?

A low-code/no-code platform where users describe an app in plain language ("saya butuh
sistem kasir untuk klinik") and AI generates the database schema plus a working
full-stack app. It removes the drag-and-drop learning curve with a **"PRD-to-App"
pipeline**: raw prompt → PRD + JSON schema → React UI → REST endpoints → deploy.

Built specifically for the Indonesian market: Rupiah prepaid coins via QRIS, local
latency (Cloudflare Edge), and no fixed monthly subscription (unlike USD-priced foreign
platforms). The product codename is **not yet chosen** — see Open Decisions.

## Core Concepts

- **PRD-to-App Pipeline**: The 5-stage flow — initiation (raw prompt) → PRD & schema
  generation → UI rendering → iterative refinement → instant deployment.
- **Impeccable Style**: The proprietary component/design library (Navbar, Hero, Data
  Table, Form, Card). AI is *constrained* to only these components — no free-form HTML.
- **JSON-to-Component Mapper**: Frontend logic that translates the AI's JSON output into
  a valid React component tree.
- **Context Manager**: Backend store holding conversation history + the temporary DB
  schema for the active session, so UI revisions stay in sync with the generated schema.
- **Visual Fallback Editor**: Click-to-edit UI for text, brand color, and margin
  tweaks — costs **zero AI coins**, the deliberate escape hatch from prompting.
- **Koin**: Internal prepaid wallet currency. Funded via Midtrans (QRIS/VA).
- **D1 Auto-Provisioning**: Executing DDL against Cloudflare D1 to create the *end
  user's* project tables.
- **Usage-Based Pricing**: Coins are deducted on two triggers — (1) every LLM-Kita API
  call, (2) whenever a user's D1 database exceeds the free tier.

## Key User Roles

| Role | Description | Notes |
|------|-------------|-------|
| **Tech-Savvy UMKM** | Business owners (shops, clinics) wanting digitalization | Price-sensitive; rejects monthly USD fees |
| **Siswa SMK / Mahasiswa IT** | Students doing final projects / freelance work | Suffers *blank canvas paralysis* |
| **Freelancer Web Lokal** | Developers taking on simple app orders | Time lost to CSS styling and server/DB setup |

All three are **end users of the platform**. There is no admin/operator role defined in
the PRD yet — an admin role is needed for coin reconciliation and abuse handling.

## Business Model

Usage-based prepaid coins (Rupiah). No fixed monthly fee. Revenue accrues per AI call
and per D1 storage overage. Top-up via Midtrans QRIS / Virtual Account.

## What AI Should Know When Working Here

1. **AI never emits HTML.** The LLM must return strict JSON that maps only to
   whitelisted Impeccable Style components. Reject anything else — this is the core
   product constraint, not a preference.
2. **Coins are deducted *before* the LLM call**, never after. A failed call must not
   silently burn balance; a successful one must never be free. This is a check-then-act
   pattern and needs concurrency protection.
3. **Visual edits are free.** Any change a user can make in the Fallback Editor must not
   touch the LLM or the coin ledger.
4. **Rupiah, not USD.** All user-facing prices are IDR. Coins have an IDR denomination.
5. **User projects are isolated tenants.** Each generated app has its own D1 database and
   Workers — never share a table across users' projects.
6. **Cloudflare is the deployment target.** Anything that cannot run on Pages/Workers/D1
   needs an explicit justification (e.g. the Node.js orchestrator).
