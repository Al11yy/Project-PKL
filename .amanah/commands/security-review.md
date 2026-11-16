---
description: "Security review — full codebase scan across 12 domains (OWASP, UU PDP, ISO 27001). Generates a blueprint in .amanah/blueprints/security-review-{date}/. Modes: full, module, api, data, ai, infra, deps."
---

# Security Review: $ARGUMENTS

## IMPORTANT: This is a FULL CODEBASE security scan, NOT a git diff review

Do NOT run `git diff` or look at branch changes. This command scans the ENTIRE codebase for security vulnerabilities using grep patterns defined in domain files.

## What This Command Does

1. **Read domain files** from `.amanah/security-review/domains/` to get grep patterns
2. **Spawn parallel subagents** — each reads 1 domain file, runs its greps, reports findings
3. **Generate a blueprint** (what.md, how.md, now.md) in `.amanah/blueprints/security-review-{date}/`

## Mode Detection from $ARGUMENTS

- `full` or empty → Scan ALL 12 domains → full blueprint
- `module <path>` → Scan only that path → fix.md
- `api` → Domains 01+05+06 → fix.md
- `data` → Domains 03+04 → fix.md
- `ai` → Domain 08 → fix.md
- `infra` → Domain 07 → fix.md
- `deps` → Domain 10 → fix.md

## Step 1: Spawn Scan Subagents

For `full` mode, spawn these subagents in 4 waves. Each subagent:

**MUST read the domain file first, then run the grep patterns from it.**

```
Wave 1 (spawn in parallel):
  Subagent A: Read .amanah/security-review/domains/01-auth.md → run its grep patterns → report findings
  Subagent B: Read .amanah/security-review/domains/02-injection.md → run its grep patterns → report findings
  Subagent C: Read .amanah/security-review/domains/05-input-validation.md → run its grep patterns → report findings

Wave 2 (after wave 1 completes):
  Subagent D: Read .amanah/security-review/domains/04-tenant-isolation.md → run its grep patterns → report findings
  Subagent E: Read .amanah/security-review/domains/03-data-protection.md → run its grep patterns → report findings

Wave 3 (after wave 2 completes):
  Subagent F: Read .amanah/security-review/domains/06-api-security.md → run its grep patterns → report findings
  Subagent G: Read .amanah/security-review/domains/07-infrastructure.md → run its grep patterns → report findings
  Subagent H: Read .amanah/security-review/domains/10-dependencies.md → run its grep patterns → report findings

Wave 4 (after wave 3 completes):
  Subagent I: Read .amanah/security-review/domains/08-ai-llm.md → run its grep patterns → report findings
  Subagent J: Read .amanah/security-review/domains/11-business-logic.md → run its grep patterns → report findings
  Subagent K: Read .amanah/security-review/domains/12-logging-monitoring.md → run its grep patterns → report findings
```

### Subagent Instructions (give each subagent this prompt):

```
You are scanning the codebase for {DOMAIN_NAME} security vulnerabilities.

STEP 1: Read the domain definition file at .amanah/security-review/domains/{NN}-{name}.md

STEP 2: Run EACH grep pattern listed in that file. Use grep tool, NOT bash grep.

STEP 3: For any grep matches, read the specific file around the matching line (use offset/limit, max 50 lines) to confirm it's a real issue.

STEP 4: Output your findings in this exact format:

If issues found:
  SEVERITY | file:line | issue description | fix recommendation

If no issues found:
  CLEAR — no {domain} issues found

RULES:
- Run ALL grep patterns from the domain file, not just some
- Only count REAL vulnerabilities, not test files or false positives
- Severity: Critical / High / Medium / Low / Info
- Max 5 file reads, 50 lines each
- Do NOT read the entire codebase — only read files where grep found matches
```

## Step 2: Collect All Findings

After all waves complete, collect findings from every subagent. Count by severity.

## Step 3: Generate what.md

Create `.amanah/blueprints/security-review-{YYYY-MM-DD}/what.md` with:

- **Overview**: Total findings, severity breakdown
- **Must-Haves** (M-1, M-2...): One per Critical/High finding
- **Findings Summary Table**: # | Severity | Domain | File | Issue
- **Compliance Status**: OWASP Top 10, UU PDP, ISO 27001
- **Risks & Mitigations**

Then **STOP** and ask: "what.md is ready with {N} findings. Continue to how.md?"

## Step 4: Generate how.md

For each finding in what.md, write fix code (old → new). Then **STOP** and ask user to confirm.

## Step 5: Generate now.md

Prioritized action items: Wave 0 (Critical), Wave 1 (High), Wave 2 (Medium), Wave 3 (Tests). Then **STOP** and ask user to confirm.

## Step 6: Ready for /build

Blueprint is in `.amanah/blueprints/security-review-{date}/`. User can run `/build security-review-{date}`.

## Context Rules

- Do NOT run git diff — this is a codebase scan, not a branch review
- grep before read — search first, only read files where grep finds matches
- Each subagent loads only 1 domain file (~60-80 lines)
- One output file at a time, STOP for user confirmation between each
- Use the Agent tool to spawn parallel subagents
