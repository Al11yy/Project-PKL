/**
 * A stand-in for LLM-Kita, so the browser can be driven end to end without a key.
 *
 * It speaks the OpenAI-compatible shape the real client expects — `choices[0].message.content`
 * holding a JSON string, plus `usage` — because the point of this harness is to exercise the
 * *orchestrator's* real code path: prompt building, envelope parsing, contract validation,
 * assembly, and the M-7 preservation checks. A stub that returned a ready `ParsedProject`
 * would skip everything worth looking at.
 *
 * What it echoes back depends on the instruction, so the interesting branches are reachable
 * from the browser:
 *   - a normal instruction       -> a valid project
 *   - "hapus layar <id>"         -> the named screen is dropped (allowed, M-7)
 *   - "hilangkan layar"          -> a screen vanishes that was not named (refused, M-7)
 *   - "ganti id blok"            -> every block id is renumbered (refused, M-7)
 *   - "tolak"                    -> a refusal envelope
 *   - "lama"                     -> never answers, to reach the timeout path
 */
import { createServer } from 'node:http'

const screen = (id, name, blocks) => ({ id, name, blocks })

const block = (id, kind, title, body) => ({ id, kind, title, body })

const baseBlocks = (screenId) => [
  block(`${screenId}-nav`, 'navbar', 'Rakit', 'Rakit'),
  block(`${screenId}-stat`, 'stat', 'Total hari ini', '0'),
  block(`${screenId}-table`, 'table', 'Daftar', 'Belum ada data'),
]

const kasir = () => screen('s-kasir', 'Kasir', baseBlocks('s-kasir'))
const laporan = () => screen('s-laporan', 'Laporan', baseBlocks('s-laporan'))
const pasien = () => screen('s-pasien', 'Pasien', baseBlocks('s-pasien'))

/** The tree the fake holds before any revision, matching what it hands out on generate. */
let current = [kasir(), laporan(), pasien()]

function projectFor(screens) {
  return {
    name: 'Klinik Sehat',
    slug: 'klinik-sehat',
    tables: [
      {
        name: 'pasien',
        // Column types are the uppercase enum, not the dialect spelling the model might use.
        columns: [
          { name: 'id', type: 'TEXT', primary: true },
          { name: 'nama', type: 'TEXT' },
          { name: 'alergi', type: 'TEXT', nullable: true },
        ],
        rows: 0,
      },
    ],
    screens,
  }
}

const json = (res, body) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const completion = (content) => ({
  choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 120, completion_tokens: 480 },
})

createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}
    // The instruction lives in the user message; the system message is the prompt template.
    const userMessage = body.messages?.at(-1)?.content ?? ''
    const instruction = userMessage.split('INSTRUKSI:').at(-1)?.trim() ?? ''
    const lower = instruction.toLowerCase()

    console.log(`[fake-llm] ${req.method} ${req.url} :: ${lower.slice(0, 60) || '(generate)'}`)

    if (lower.includes('lama')) {
      // Accepts the request and never answers: reaches the AbortController timeout (Q-2).
      console.log('[fake-llm] holding the connection open')
      return
    }

    if (lower.includes('tolak')) {
      return json(res, completion({ refusal: { reason: 'Permintaan ini di luar cakupan produk.' } }))
    }

    if (lower.includes('ganti id blok')) {
      // Renumbers every block: must be refused with REVISION_DROPPED_DATA.
      const renamed = current.map((s) =>
        screen(
          s.id,
          s.name,
          s.blocks.map((b, i) => block(`blk-${s.id}-${i}`, b.kind, b.title, b.body)),
        ),
      )
      return json(res, completion(projectFor(renamed)))
    }

    /**
     * The model behaves the same way whatever the user typed: it "simplifies" by dropping a
     * screen. Whether that is acceptable is the server's call, not the model's — so these
     * two cases exist to prove the *server* refuses a drop that was not requested. The
     * wording differs on purpose: "hilangkan" reads as hide, and "jangan hapus" is a
     * negation. Neither is permission to delete, so both must be refused.
     */
    if (
      lower.includes('hilangkan layar') ||
      lower.includes('buang layar') ||
      lower.includes('jangan hapus') ||
      lower.includes('tidak perlu hapus')
    ) {
      return json(res, completion(projectFor(current.filter((s) => s.id !== 's-laporan'))))
    }

    /**
     * A deletion that is not about a screen. The model still drops a screen here — that is
     * the point: "hapus kolom alergi" must not license losing a whole screen, so the server
     * has to refuse even though a deletion verb appeared.
     */
    if (lower.includes('hapus kolom') || lower.includes('hapus teks')) {
      return json(res, completion(projectFor(current.filter((s) => s.id !== 's-laporan'))))
    }

    const asked = /hapus layar ([a-z-]+)/.exec(lower)
    if (asked) {
      // A removal that was actually requested: allowed, and it becomes the new state.
      current = current.filter((s) => s.id !== asked[1])
      return json(res, completion(projectFor(current)))
    }

    if (lower.includes('tambah layar')) {
      const next = `${'s-baru'}-${current.length}`
      current = [...current, screen(next, `Layar ${current.length + 1}`, baseBlocks(next))]
      return json(res, completion(projectFor(current)))
    }

    // A plain revision keeps the ids, which is what M-7 wants and what a real model
    // usually does. The title change proves the answer was applied.
    const edited = current.map((s) =>
      screen(
        s.id,
        s.name,
        s.blocks.map((b, i) =>
          i === 0 ? block(b.id, b.kind, 'Klinik Sehat', b.body) : b,
        ),
      ),
    )
    current = edited
    return json(res, completion(projectFor(edited)))
  })
}).listen(5197, () => console.log('[fake-llm] listening on 5197'))
