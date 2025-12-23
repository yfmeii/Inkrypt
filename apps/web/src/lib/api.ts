export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function maybeDispatchDeviceRevoked(status: number, payload: unknown): void {
  if (!isBrowser()) return
  if (status !== 401) return
  const code = typeof (payload as any)?.error === 'string' ? String((payload as any).error) : null
  if (code !== 'DEVICE_REVOKED') return
  try {
    window.dispatchEvent(new CustomEvent('inkrypt:device-revoked'))
  } catch {
    // ignore
  }
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  return await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    credentials: 'include',
  })
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    maybeDispatchDeviceRevoked(res.status, payload)
    throw new ApiError(`POST ${path} failed`, res.status, payload)
  }
  return payload as T
}

export async function getJSON<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: 'GET' })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    maybeDispatchDeviceRevoked(res.status, payload)
    throw new ApiError(`GET ${path} failed`, res.status, payload)
  }
  return payload as T
}

export async function deleteJSON<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: 'DELETE' })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    maybeDispatchDeviceRevoked(res.status, payload)
    throw new ApiError(`DELETE ${path} failed`, res.status, payload)
  }
  return payload as T
}
