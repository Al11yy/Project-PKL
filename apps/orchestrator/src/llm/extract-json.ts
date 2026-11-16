/**
 * Locate the JSON object in a model's reply.
 *
 * Models add markdown fences and conversational padding even when told not to. Rejecting
 * that is a self-inflicted failure: the payload is correct and only the wrapper is
 * cosmetic. Three shapes are handled, in order of likelihood:
 *
 *   1. bare JSON            {"name": ...}
 *   2. fenced JSON          ```json\n{...}\n```
 *   3. JSON inside prose    "Tentu! Berikut: {...} Semoga membantu!"
 *
 * Returned as a result rather than thrown, because "no JSON here" is an expected outcome
 * that the caller turns into a 422 with a specific message. An exception would make that
 * expected case indistinguishable from a bug at the call site.
 */
export type ExtractResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'no-json' | 'unbalanced' | 'invalid-json' }

export function extractJsonObject(text: string): ExtractResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'no-json' }

  // Bare object: cheapest path, and the one the prompt asks for.
  const bare = tryParse(trimmed)
  if (bare.ok) return bare

  // Fenced block. Non-greedy so the first complete fence wins.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced?.[1] !== undefined) {
    const inner = tryParse(fenced[1].trim())
    if (inner.ok) return inner
  }

  // Any balanced brace span in the text.
  const span = firstBalancedObject(trimmed)
  if (span === undefined) {
    return { ok: false, reason: trimmed.includes('{') ? 'unbalanced' : 'no-json' }
  }

  const parsed = tryParse(span)
  return parsed.ok ? parsed : { ok: false, reason: 'invalid-json' }
}

function tryParse(text: string): ExtractResult {
  if (!text.startsWith('{')) return { ok: false, reason: 'no-json' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
}

/**
 * First balanced `{...}` span, brace-depth aware.
 *
 * A regex cannot do this job. `/\\{.*\\}/` cannot tell a brace inside a string from a
 * structural one, so `{"body": "pakai {kurung}"}` either truncates early or runs past the
 * end of the object. Tracking string state and escapes is the only correct way to scan it.
 */
export function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start === -1) return undefined

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      // Only inside a string can a backslash escape the next character.
      if (inString) escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return undefined
}
