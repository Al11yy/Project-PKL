import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { extractJsonObject } from './extract-json'

const PROJECT = {
  name: 'Kasir Klinik Sehat',
  slug: 'kasir-klinik-sehat',
  tables: [{ name: 'pasien', columns: [{ name: 'id', type: 'INTEGER', primary: true }], rows: 3 }],
  screens: [
    {
      id: 's-kasir',
      name: 'Kasir',
      blocks: [{ id: 'b-nav', kind: 'navbar', title: 'Kasir', body: 'Kasir · Pasien' }],
    },
  ],
}

const json = JSON.stringify(PROJECT)

describe('extractJsonObject', () => {
  it('parses bare JSON', () => {
    const result = extractJsonObject(json)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(PROJECT)
  })

  it('parses JSON inside a ```json fence', () => {
    const result = extractJsonObject(`\`\`\`json\n${json}\n\`\`\``)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(PROJECT)
  })

  it('parses JSON inside an unlabelled fence', () => {
    const result = extractJsonObject(`\`\`\`\n${json}\n\`\`\``)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(PROJECT)
  })

  it('parses JSON embedded in a prose prefix', () => {
    const result = extractJsonObject(`Tentu! Berikut skemanya:\n${json}`)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(PROJECT)
  })

  it('parses JSON embedded in prose on both sides', () => {
    const result = extractJsonObject(`Berikut hasilnya:\n${json}\nSemoga membantu!`)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(PROJECT)
  })

  it('handles nested objects without truncating early', () => {
    const nested = { a: { b: { c: { d: 1 } } }, e: 2 }
    const result = extractJsonObject(`prose ${JSON.stringify(nested)} trailing`)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(nested)
  })

  /**
   * The case a regex cannot get right: a structural brace and a brace inside a string look
   * identical to `.*`, so `/\\{.*\\}/` either stops at the inner brace or overshoots.
   */
  it('does not mistake a brace inside a string for structure', () => {
    const tricky = { body: 'pakai {kurung} di sini', nested: { ok: true } }
    const result = extractJsonObject(JSON.stringify(tricky))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(tricky)
  })

  it('handles an escaped quote before a closing brace', () => {
    const tricky = { body: 'kata "penting" lalu }', n: 1 }
    const result = extractJsonObject(`prefix ${JSON.stringify(tricky)}`)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(tricky)
  })

  it('returns the first object when the model emits two', () => {
    const result = extractJsonObject(`${JSON.stringify({ first: 1 })} dan ${JSON.stringify({ second: 2 })}`)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ first: 1 })
  })

  it('reports no-json for empty input', () => {
    expect(extractJsonObject('')).toEqual({ ok: false, reason: 'no-json' })
    expect(extractJsonObject('   ')).toEqual({ ok: false, reason: 'no-json' })
  })

  it('reports no-json for prose with no braces', () => {
    const result = extractJsonObject('Maaf, saya tidak bisa membantu permintaan itu.')

    expect(result).toEqual({ ok: false, reason: 'no-json' })
  })

  it('reports unbalanced when a brace opens and never closes', () => {
    const result = extractJsonObject('{"name": "Kasir", "screens": [')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unbalanced')
  })

  it('reports invalid-json for a balanced span that is not valid JSON', () => {
    const result = extractJsonObject('{name: Kasir, tanpa kutip}')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-json')
  })

  it('extracts a refusal envelope', () => {
    const refusal = { refusal: { reason: 'Permintaan ini tidak dapat dipenuhi.' } }
    const result = extractJsonObject(`\`\`\`json\n${JSON.stringify(refusal)}\n\`\`\``)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(refusal)
  })

  /**
   * Property 3: extraction is wrapper-insensitive.
   *
   * The three wrappers are exactly the shapes observed from models. Generating the payload
   * rather than listing fixtures is what covers brace-in-string and escape cases that a
   * hand-written table would miss.
   */
  it('Property 3: survives any wrapper for any valid project', () => {
    type Wrapper = 'bare' | 'fence' | 'prose'

    const wrap = (payload: unknown, kind: Wrapper): string => {
      const body = JSON.stringify(payload)
      if (kind === 'bare') return body
      if (kind === 'fence') return `\`\`\`json\n${body}\n\`\`\``
      return `Tentu! Berikut hasilnya:\n${body}\nSemoga membantu!`
    }

    const arbitraryString = fc.string({ maxLength: 40 })

    fc.assert(
      fc.property(
        fc.constantFrom<Wrapper>('bare', 'fence', 'prose'),
        fc.record({
          name: arbitraryString,
          nested: fc.record({ body: arbitraryString, n: fc.integer() }),
          items: fc.array(fc.record({ id: arbitraryString, deep: fc.record({ v: fc.boolean() }) })),
        }),
        (kind, payload) => {
          const result = extractJsonObject(wrap(payload, kind))

          expect(result.ok).toBe(true)
          if (result.ok) expect(result.value).toEqual(payload)
        },
      ),
      { numRuns: 200 },
    )
  })
})
