#!/usr/bin/env node
/**
 * sync-confluence.mjs — publish repository documentation to Atlassian Confluence.
 *
 * Usage:
 *   node scripts/sync-confluence.mjs                 # dry run, prints planned actions
 *   node scripts/sync-confluence.mjs --apply         # create/update pages
 *   node scripts/sync-confluence.mjs --apply --file KNOWLEDGE_BASE.md
 *
 * Required environment variables:
 *   CONFLUENCE_BASE_URL   e.g. https://your-tenant.atlassian.net/wiki
 *   CONFLUENCE_EMAIL      the Atlassian account email that owns the API token
 *   CONFLUENCE_API_TOKEN  create at https://id.atlassian.com/manage-profile/security/api-tokens
 *   CONFLUENCE_SPACE_KEY  e.g. "RAKIT"
 * Optional:
 *   CONFLUENCE_PARENT_ID  parent page id; omit to create pages at space root
 *
 * Design notes:
 *  - No dependencies. Node 18+ has global fetch, so this runs with no install step.
 *  - Dry run is the default. Publishing is an outward-facing action, so it has to be
 *    asked for explicitly rather than being what happens when you forget a flag.
 *  - Pages are matched by title, never by id, so renaming a local heading does not
 *    create a duplicate page on every run.
 *  - Uses the v2 REST API for page lookup and the v1 API for the body/storage format,
 *    because v2 does not yet convert Markdown reliably for all tenants.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DOCS = [
  { file: 'KNOWLEDGE_BASE.md', title: 'Rakit.ai — Knowledge Base' },
  { file: 'TODO.md', title: 'Rakit.ai — Roadmap & TODO' },
]

const APPLY = process.argv.includes('--apply')
const ONLY = (() => {
  const i = process.argv.indexOf('--file')
  return i !== -1 ? process.argv[i + 1] : null
})()

const {
  CONFLUENCE_BASE_URL,
  CONFLUENCE_EMAIL,
  CONFLUENCE_API_TOKEN,
  CONFLUENCE_SPACE_KEY,
  CONFLUENCE_PARENT_ID,
} = process.env

/** Fail loudly before touching the network if config is missing. */
function requireEnv() {
  const missing = Object.entries({
    CONFLUENCE_BASE_URL,
    CONFLUENCE_EMAIL,
    CONFLUENCE_API_TOKEN,
    CONFLUENCE_SPACE_KEY,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`)
    console.error('See the header of scripts/sync-confluence.mjs for what each one is.')
    process.exit(1)
  }
}

const authHeader = () =>
  'Basic ' + Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}`).toString('base64')

/**
 * A single request helper with an explicit timeout. The project rules require
 * every external call to have one; a docs sync hanging forever is still a hang.
 */
async function api(url, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
    const text = await res.text()
    const body = text ? JSON.parse(text) : null
    if (!res.ok) {
      const detail = body?.message ?? text.slice(0, 300)
      throw new Error(`${res.status} ${res.statusText} — ${detail}`)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Minimal Markdown → Confluence storage (XHTML) converter.
 *
 * Deliberately small: it covers the constructs these two documents actually use
 * (headings, paragraphs, lists, tables, code fences, inline code, bold, links,
 * blockquotes). It is not a general Markdown engine, and it does not pretend to
 * be — anything unrecognised is passed through as escaped text rather than
 * silently dropped.
 */
export function markdownToStorage(md) {
  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')

  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (/^```/.test(line)) {
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++ // consume closing fence
      out.push(
        '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">text</ac:parameter>' +
          `<ac:plain-text-body><![CDATA[${buf.join('\n')}]]></ac:plain-text-body></ac:structured-macro>`
      )
      continue
    }

    // Table
    if (/^\|/.test(line) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (row) =>
        row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]))
      out.push(
        '<table><tbody>' +
          `<tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>` +
          rows
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('') +
          '</tbody></table>'
      )
      continue
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      out.push('<hr/>')
      i++
      continue
    }

    // Blockquote — collected as one paragraph to avoid empty blockquote noise
    if (/^>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`)
      continue
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items = []
      let depth = 0
      while (i < lines.length && /^(\s*)[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.*)$/)
        const indent = Math.floor(m[1].length / 2)
        if (indent > 0) depth = Math.max(depth, indent)
        items.push(inline(m[2]))
        i++
      }
      // Flat list is fine for these docs; nested indentation is preserved as text.
      out.push(`<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`)
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(inline(lines[i++].replace(/^\d+\.\s+/, '')))
      }
      out.push(`<ol>${items.map((t) => `<li>${t}</li>`).join('')}</ol>`)
      continue
    }

    // Blank line
    if (!line.trim()) {
      i++
      continue
    }

    // Paragraph — consume until a blank line or a block construct starts
    const buf = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|\||>|[-*]\s|\d+\.\s|---+\s*$)/.test(lines[i])
    ) {
      buf.push(lines[i++])
    }
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`)
  }

  return out.join('\n')
}

/** Look up an existing page by exact title within the space. */
async function findPageByTitle(title) {
  const url =
    `${CONFLUENCE_BASE_URL}/api/v2/pages?title=${encodeURIComponent(title)}` +
    `&space-key=${encodeURIComponent(CONFLUENCE_SPACE_KEY)}&status=current&limit=1`
  const data = await api(url)
  return data?.results?.[0] ?? null
}

async function createPage(title, bodyStorage) {
  // v1 is used for writes because it accepts a space *key* and an optional parent
  // id directly; v2 would require resolving the numeric spaceId first.
  return api(`${CONFLUENCE_BASE_URL}/rest/api/content`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'page',
      title,
      space: { key: CONFLUENCE_SPACE_KEY },
      ...(CONFLUENCE_PARENT_ID ? { ancestors: [{ id: CONFLUENCE_PARENT_ID }] } : {}),
      body: { storage: { value: bodyStorage, representation: 'storage' } },
    }),
  })
}

async function updatePage(pageId, title, bodyStorage) {
  // v1 requires the current version number so updates do not clobber each other.
  const current = await api(`${CONFLUENCE_BASE_URL}/rest/api/content/${pageId}?expand=version`)
  const nextVersion = (current?.version?.number ?? 1) + 1

  return api(`${CONFLUENCE_BASE_URL}/rest/api/content/${pageId}`, {
    method: 'PUT',
    body: JSON.stringify({
      id: pageId,
      type: 'page',
      title,
      version: { number: nextVersion },
      body: { storage: { value: bodyStorage, representation: 'storage' } },
    }),
  })
}

async function main() {
  requireEnv()

  const targets = ONLY ? DOCS.filter((d) => d.file === ONLY) : DOCS
  if (!targets.length) {
    console.error(`No matching doc for --file ${ONLY}. Known: ${DOCS.map((d) => d.file).join(', ')}`)
    process.exit(1)
  }

  console.log(APPLY ? 'Mode: APPLY — pages will be written.' : 'Mode: DRY RUN — nothing will be written.')
  console.log(`Space: ${CONFLUENCE_SPACE_KEY}  ·  ${targets.length} document(s)\n`)

  for (const doc of targets) {
    const abs = path.resolve(process.cwd(), doc.file)
    if (!existsSync(abs)) {
      console.warn(`skip ${doc.file} — not found at ${abs}`)
      continue
    }

    const md = await readFile(abs, 'utf8')
    const storage = markdownToStorage(md)
    const existing = await findPageByTitle(doc.title)

    console.log(
      `${doc.file}\n  title: ${doc.title}\n  exists: ${existing ? `yes (id ${existing.id})` : 'no'}` +
        `\n  storage bytes: ${storage.length}`
    )

    if (!APPLY) {
      console.log(`  → would ${existing ? 'UPDATE' : 'CREATE'}\n`)
      continue
    }

    if (existing) {
      await updatePage(existing.id, doc.title, storage)
      console.log('  → updated\n')
    } else {
      await createPage(doc.title, storage)
      console.log('  → created\n')
    }
  }

  if (!APPLY) console.log('Re-run with --apply to publish.')
}

/**
 * Only run when invoked directly, so the converter can be imported by a test.
 * Compares file URLs built by pathToFileURL — hand-rolling `file://${path}` breaks
 * on Windows, where the drive letter needs three slashes.
 */
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((err) => {
    console.error('\nSync failed:', err.message)
    process.exit(1)
  })
}
