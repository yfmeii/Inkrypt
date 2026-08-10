import { INKRYPT_API_VERSION } from '@inkrypt/contracts/version'

export type RuntimeSchema<T> = {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues?: unknown } }
}

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

export class ApiProtocolError extends Error {
  code: 'MISSING_API_VERSION' | 'API_VERSION_MISMATCH' | 'INVALID_RESPONSE'
  payload: unknown

  constructor(
    message: string,
    code: ApiProtocolError['code'],
    payload: unknown,
  ) {
    super(message)
    this.name = 'ApiProtocolError'
    this.code = code
    this.payload = payload
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function maybeDispatchSessionEvent(status: number, payload: unknown): void {
  if (!isBrowser()) return
  if (status !== 401) return
  const code = typeof (payload as any)?.error === 'string' ? String((payload as any).error) : null
  try {
    if (code === 'DEVICE_REVOKED') {
      window.dispatchEvent(new CustomEvent('inkrypt:device-revoked'))
    } else if (code === 'UNAUTHORIZED') {
      window.dispatchEvent(new CustomEvent('inkrypt:session-expired'))
    }
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

function validateApiVersion(response: Response): void {
  // Plain object response doubles in unit tests may omit Headers entirely.
  if (!response.headers) return

  const actualVersion = response.headers.get('X-Inkrypt-API-Version')
  if (!actualVersion) {
    throw new ApiProtocolError(
      'API response is missing its protocol version',
      'MISSING_API_VERSION',
      null,
    )
  }

  if (actualVersion !== String(INKRYPT_API_VERSION)) {
    throw new ApiProtocolError(
      `API protocol version mismatch: expected ${INKRYPT_API_VERSION}, received ${actualVersion}`,
      'API_VERSION_MISMATCH',
      { expected: INKRYPT_API_VERSION, actual: actualVersion },
    )
  }
}

function parsePayload<T>(
  method: string,
  path: string,
  payload: unknown,
  schema?: RuntimeSchema<T>,
): T {
  if (!schema) return payload as T

  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data

  throw new ApiProtocolError(
    `${method} ${path} returned an invalid response`,
    'INVALID_RESPONSE',
    parsed.error.issues ?? payload,
  )
}

async function requestJSON<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  schema?: RuntimeSchema<T>,
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    ...(method === 'GET' || method === 'DELETE'
      ? {}
      : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    maybeDispatchSessionEvent(response.status, payload)
    throw new ApiError(`${method} ${path} failed`, response.status, payload)
  }

  validateApiVersion(response)
  return parsePayload(method, path, payload, schema)
}

export async function postJSON<T>(path: string, body: unknown, schema?: RuntimeSchema<T>): Promise<T> {
  return requestJSON('POST', path, body, schema)
}

export async function getJSON<T>(path: string, schema?: RuntimeSchema<T>): Promise<T> {
  return requestJSON('GET', path, undefined, schema)
}

export async function deleteJSON<T>(path: string, schema?: RuntimeSchema<T>): Promise<T> {
  return requestJSON('DELETE', path, undefined, schema)
}

export async function putJSON<T>(path: string, body: unknown, schema?: RuntimeSchema<T>): Promise<T> {
  return requestJSON('PUT', path, body, schema)
}
