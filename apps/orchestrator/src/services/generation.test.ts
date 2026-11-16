import { describe, expect, it, vi } from 'vitest'
import { ContractError, projectSchema } from '@rakit/schema'
import { checkPrompt, generateProject, parseEnvelope, reviseProject } from './generation'
import { ApiErrorException } from '../errors'
import { clientReturning, validLlmProject, validProjectJson, clientProject } from '../testing/fixtures'

const SIGNAL = new AbortController().signal
const PROMPT = 'sistem kasir untuk klinik'

describe('checkPrompt', () => {
  it('accepts a normal prompt', () => {
    expect(checkPrompt(PROMPT, 'prompt')).toBe(PROMPT)
  })

  /** Property 5, lower bound: trimming first, so padding cannot smuggle a short prompt in. */
  it('rejects a prompt that is only whitespace as too short', () => {
    expect(() => checkPrompt('        ', 'prompt')).toThrow(ApiErrorException)

    try {
      checkPrompt('        ', 'prompt')
    } catch (error) {
      expect((error as ApiErrorException).apiError.code).toBe('PROMPT_TOO_SHORT')
      expect((error as ApiErrorException).httpStatus).toBe(400)
    }
  })

  it('accepts a prompt that becomes valid only after trimming', () => {
    const padded = `   ${PROMPT}   `

    expect(checkPrompt(padded, 'prompt')).toBe(PROMPT)
  })

  /** Property 5, upper bound: a wall of whitespace is measured as empty, not as over-length. */
  it('reports whitespace-only 5000 chars as too short, not too long', () => {
    try {
      checkPrompt(' '.repeat(5_000), 'prompt')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as ApiErrorException).apiError.code).toBe('PROMPT_TOO_SHORT')
    }
  })

  it('rejects a prompt over the limit after trimming', () => {
    try {
      checkPrompt(`  ${'a'.repeat(4_001)}  `, 'prompt')
      expect.unreachable('should have thrown')
    } catch (error) {
      const api = error as ApiErrorException
      expect(api.apiError.code).toBe('PROMPT_TOO_LONG')
      expect(api.apiError.details).toMatchObject({ actualLength: 4_001 })
    }
  })
})

describe('parseEnvelope', () => {
  it('accepts a fenced project', () => {
    const envelope = parseEnvelope(`\`\`\`json\n${validProjectJson()}\n\`\`\``, 'stop')

    expect(envelope).toHaveProperty('name')
  })

  it('accepts a refusal', () => {
    const envelope = parseEnvelope('{"refusal":{"reason":"Tidak dapat dipenuhi."}}', 'stop')

    expect(envelope).toHaveProperty('refusal')
  })

  it('rejects a non-whitelisted kind, naming the path and the offending value', () => {
    const bad = validLlmProject({
      screens: [
        {
          id: 's-1',
          name: 'Layar',
          blocks: [{ id: 'b-1', kind: 'iframe', title: 'X', body: 'Y' }],
        },
      ],
    })

    try {
      parseEnvelope(JSON.stringify(bad), 'stop')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ContractError)
      const issues = (error as ContractError).issues
      expect(issues.length).toBeGreaterThan(0)
      expect(issues.some((i) => i.path.includes('kind'))).toBe(true)
      // The rejected value is named, which is what makes the message actionable.
      expect(issues.some((i) => i.message.includes('iframe'))).toBe(true)
    }
  })

  it('rejects prose with no JSON, as a contract error rather than a SyntaxError', () => {
    expect(() => parseEnvelope('Tentu! Berikut skemanya.', 'stop')).toThrow(ContractError)
  })

  it('prefixes a truncation detail when finish_reason is length', () => {
    try {
      parseEnvelope('{"name": "Kasir", "screens": [', 'length')
      expect.unreachable('should have thrown')
    } catch (error) {
      const issues = (error as ContractError).issues
      expect(issues[0]?.message).toContain('terpotong')
    }
  })

  it('warns rather than errors when output is not JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => parseEnvelope('bukan json', 'stop')).toThrow()
    expect(warn).toHaveBeenCalled()
    // Expected during tuning, so it must not be logged as an incident.
    expect(error).not.toHaveBeenCalled()

    warn.mockRestore()
    error.mockRestore()
  })
})

describe('generateProject', () => {
  it('returns a project that passes projectSchema', async () => {
    const outcome = await generateProject(clientReturning(validProjectJson()), PROMPT, SIGNAL)

    expect(outcome.kind).toBe('project')
    if (outcome.kind !== 'project') return

    // Property 2, at the service boundary.
    expect(projectSchema.safeParse(outcome.project).success).toBe(true)
  })

  it('computes counts from array length, ignoring any the model claims', async () => {
    const outcome = await generateProject(
      clientReturning(validProjectJson({ tablesCount: 999, screensCount: 999 })),
      PROMPT,
      SIGNAL,
    )

    if (outcome.kind !== 'project') throw new Error('expected a project')
    expect(outcome.project.tablesCount).toBe(1)
    expect(outcome.project.screensCount).toBe(1)
  })

  it('sets id, status, and prompt from the server, not the model', async () => {
    const outcome = await generateProject(
      clientReturning(validProjectJson({ id: 'hacked', status: 'live' })),
      PROMPT,
      SIGNAL,
    )

    if (outcome.kind !== 'project') throw new Error('expected a project')
    expect(outcome.project.id).not.toBe('hacked')
    expect(outcome.project.id).toMatch(/^p-/)
    expect(outcome.project.status).toBe('draft')
    expect(outcome.project.prompt).toBe(PROMPT)
  })

  it('returns a refusal without throwing, and does not assemble a project', async () => {
    const outcome = await generateProject(
      clientReturning('{"refusal":{"reason":"Permintaan terlalu luas."}}'),
      PROMPT,
      SIGNAL,
    )

    expect(outcome.kind).toBe('refusal')
    if (outcome.kind !== 'refusal') return
    expect(outcome.reason).toBe('Permintaan terlalu luas.')
  })

  it('reports usage from the completion', async () => {
    const outcome = await generateProject(
      clientReturning(validProjectJson(), { inputTokens: 42, outputTokens: 84 }),
      PROMPT,
      SIGNAL,
    )

    expect(outcome.usage).toMatchObject({ inputTokens: 42, outputTokens: 84 })
    expect(outcome.usage.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('rejects a too-short prompt before calling the provider', async () => {
    const client = clientReturning(validProjectJson())

    await expect(generateProject(client, 'kl', SIGNAL)).rejects.toBeInstanceOf(ApiErrorException)
    // Property 5: no provider call means nothing to charge for.
    expect(client.calls).toHaveLength(0)
  })
})

describe('reviseProject', () => {
  it('echoes the current project into the provider request', async () => {
    const client = clientReturning(validProjectJson())

    await reviseProject(client, clientProject(), 'tambah kolom alergi', SIGNAL)

    const sent = client.calls[0]?.messages[0]?.content ?? ''
    expect(sent).toContain('p-existing-123')
    expect(sent).toContain('tambah kolom alergi')
  })

  it('warns when the model drops a screen the user had', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const before = clientProject({
      screens: [
        { id: 's-kasir', name: 'Kasir', blocks: [{ id: 'b-1', kind: 'navbar', title: 'A', body: 'B' }] },
        { id: 's-laporan', name: 'Laporan', blocks: [{ id: 'b-2', kind: 'navbar', title: 'C', body: 'D' }] },
      ],
    })

    const outcome = await reviseProject(
      clientReturning(validProjectJson()),
      before,
      'ubah judul kasir',
      SIGNAL,
    )

    // The revision still succeeds — a dropped screen is a signal, not a hard failure.
    expect(outcome.kind).toBe('project')
    const events = warn.mock.calls.map((c) => String(c[0]))
    expect(events.some((e) => e.includes('dropped-screens'))).toBe(true)

    warn.mockRestore()
  })
})
