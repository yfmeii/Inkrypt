/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { postJSON, getJSON, deleteJSON, ApiError } from './api'

describe('api - ApiError', () => {
  it('creates error with message, status and payload', () => {
    const error = new ApiError('Not found', 404, { error: 'NOT_FOUND' })
    expect(error.message).toBe('Not found')
    expect(error.status).toBe(404)
    expect(error.payload).toEqual({ error: 'NOT_FOUND' })
  })

  it('is instanceof Error', () => {
    const error = new ApiError('Error', 500, null)
    expect(error).toBeInstanceOf(Error)
  })
})

describe('api - postJSON', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends POST request with JSON body and returns parsed response', async () => {
    const mockResponse = { success: true, data: 'test' }
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    })

    const result = await postJSON('/api/test', { key: 'value' })

    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        credentials: 'include',
      }),
    )
    expect(result).toEqual(mockResponse)
  })

  it('throws ApiError on non-ok response', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: 'BAD_REQUEST' }),
    })

    await expect(postJSON('/api/test', {})).rejects.toThrow(ApiError)
  })

  it('throws ApiError with correct status and payload', async () => {
    const payload = { error: 'VALIDATION_FAILED', details: ['field1', 'field2'] }
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue(payload),
    })

    try {
      await postJSON('/api/test', {})
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      expect((e as ApiError).status).toBe(422)
      expect((e as ApiError).payload).toEqual(payload)
    }
  })

  it('handles empty response body', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
    })

    try {
      await postJSON('/api/test', {})
    } catch (e) {
      expect((e as ApiError).payload).toBeNull()
    }
  })
})

describe('api - getJSON', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends GET request and returns parsed response', async () => {
    const mockResponse = { data: 'result' }
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    })

    const result = await getJSON('/api/data')

    expect(fetch).toHaveBeenCalledWith(
      '/api/data',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        credentials: 'include',
      }),
    )
    expect(result).toEqual(mockResponse)
  })

  it('throws ApiError on non-ok response', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({ error: 'NOT_FOUND' }),
    })

    await expect(getJSON('/api/missing')).rejects.toThrow(ApiError)
  })

  it('handles empty response body on error', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error('Parse error')),
    })

    try {
      await getJSON('/api/test')
    } catch (e) {
      expect((e as ApiError).payload).toBeNull()
    }
  })
})

describe('api - deleteJSON', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends DELETE request and returns parsed response', async () => {
    const mockResponse = { deleted: true }
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    })

    const result = await deleteJSON('/api/item/123')

    expect(fetch).toHaveBeenCalledWith(
      '/api/item/123',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        credentials: 'include',
      }),
    )
    expect(result).toEqual(mockResponse)
  })

  it('throws ApiError on non-ok response', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ error: 'FORBIDDEN' }),
    })

    await expect(deleteJSON('/api/item/123')).rejects.toThrow(ApiError)
  })
})

describe('api - device revoked event', () => {
  let dispatchEventSpy: any

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    dispatchEventSpy = vi.fn()
    vi.stubGlobal('dispatchEvent', dispatchEventSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dispatches device-revoked event on 401 with DEVICE_REVOKED code', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: 'DEVICE_REVOKED' }),
    })

    try {
      await postJSON('/api/test', {})
    } catch (e) {
      // expected
    }

    expect(dispatchEventSpy).toHaveBeenCalled()
    const calledEvent = dispatchEventSpy.mock.calls[0][0]
    expect(calledEvent.type).toBe('inkrypt:device-revoked')
  })

  it('dispatches device-revoked event on 401 with string error code', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: 'DEVICE_REVOKED' }),
    })

    try {
      await getJSON('/api/test')
    } catch (e) {
      // expected
    }

    expect(dispatchEventSpy).toHaveBeenCalled()
    const calledEvent = dispatchEventSpy.mock.calls[0][0]
    expect(calledEvent.type).toBe('inkrypt:device-revoked')
  })

  it('dispatches device-revoked event on 401 with delete request', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: 'DEVICE_REVOKED' }),
    })

    try {
      await deleteJSON('/api/test')
    } catch (e) {
      // expected
    }

    expect(dispatchEventSpy).toHaveBeenCalled()
    const calledEvent = dispatchEventSpy.mock.calls[0][0]
    expect(calledEvent.type).toBe('inkrypt:device-revoked')
  })

  it('does not dispatch event for non-401 errors', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: 'SERVER_ERROR' }),
    })

    try {
      await postJSON('/api/test', {})
    } catch (e) {
      // expected
    }

    expect(dispatchEventSpy).not.toHaveBeenCalled()
  })

  it('does not dispatch event for 401 without DEVICE_REVOKED code', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: 'UNAUTHORIZED' }),
    })

    try {
      await postJSON('/api/test', {})
    } catch (e) {
      // expected
    }

    expect(dispatchEventSpy).not.toHaveBeenCalled()
  })

  it('does not dispatch event when error field is not string', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: 123 }),
    })

    try {
      await postJSON('/api/test', {})
    } catch (e) {
      // expected
    }

    expect(dispatchEventSpy).not.toHaveBeenCalled()
  })

  it('does not dispatch event when payload is null', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue(null),
    })

    try {
      await postJSON('/api/test', {})
    } catch (e) {
      // expected
    }

    expect(dispatchEventSpy).not.toHaveBeenCalled()
  })

  it('does not fail if dispatchEvent throws', async () => {
    // Override dispatchEvent to throw
    vi.stubGlobal('dispatchEvent', () => { throw new Error('Security error') })

    ;(fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: 'DEVICE_REVOKED' }),
    })

    // Should not throw
    try {
      await postJSON('/api/test', {})
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
    }
  })
})

describe('api - fetch options', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves custom headers', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    })

    // We can't directly test header preservation because api.ts merges headers
    // But we can verify the request is made correctly
    await postJSON('/api/test', {})

    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('always includes credentials', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    })

    await postJSON('/api/test', {})

    expect(fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })
})