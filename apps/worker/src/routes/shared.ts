import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env'

export function jsonError(
  c: Context<AppEnv>,
  error: string,
  status: 400 | 401 | 403 | 404 | 409,
): Response {
  return c.json({ error }, status)
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  c: Context<AppEnv>,
  schema: TSchema,
): Promise<z.infer<TSchema> | Response> {
  const body = schema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return jsonError(c, 'INVALID_BODY', 400)
  return body.data
}

export function requireUserId(c: Context<AppEnv>): string | Response {
  const userId = c.get('userId')
  if (!userId) return jsonError(c, 'UNAUTHORIZED', 401)
  return userId
}

export function nowMs(): number {
  return Date.now()
}
