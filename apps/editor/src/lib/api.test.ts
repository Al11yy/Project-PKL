import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, deleteProject } from './api'

/**
 * Only `deleteProject` is exercised here, and only because its success path is the unusual one:
 * every other call in this module answers with a JSON envelope, so `request`'s parsing is
 * covered implicitly by the store tests. A delete answers `204 No Content`, and reading a body
 * that is not there is exactly the kind of thing that passes review and fails in production —
 * so the contract is pinned here against a stubbed `fetch` rather than a real server.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('deleteProject', () => {
  it('resolves on 204 without trying to read a body', async () => {
    // A real 204 has no content at all; `new Response(null, { status: 204 })` reproduces that,
    // and it is the case `response.json()` throws on.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(deleteProject('p-klinik')).resolves.toBeUndefined()
  })

  it('sends DELETE to the project\'s own URL, with the id escaped', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await deleteProject('p/a b')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url.endsWith('/api/v1/projects/p%2Fa%20b')).toBe(true)
    expect(init.method).toBe('DELETE')
    // A bodyless DELETE must not claim a JSON body — the orchestrator checks that pairing.
    expect(init.body).toBeUndefined()
  })

  it('raises the server\'s own code and message when the delete is rejected', async () => {
    // A body can only be read once, so each call needs its own `Response`; `mockResolvedValue`
    // with one instance would hand the second read a consumed body.
    fetchMock.mockImplementation(async () =>
      jsonResponse(401, {
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Token tidak valid.', details: undefined },
      }),
    )

    await expect(deleteProject('p-klinik')).rejects.toBeInstanceOf(ApiError)
    await expect(deleteProject('p-klinik')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Token tidak valid.',
      status: 401,
    })
  })

  it('describes an unreachable server as a network failure, not a rejected delete', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(deleteProject('p-klinik')).rejects.toBeInstanceOf(NetworkError)
  })
})
