export type Bindings = {
  DB: D1Database
  RATE_LIMITER: DurableObjectNamespace
  RP_NAME: string
  RP_ID: string
  ORIGIN: string
  CORS_ORIGIN: string
  COOKIE_SAMESITE: string
  SESSION_SECRET: string
  RATE_LIMIT_DISABLED?: string
}

export type Variables = {
  userId?: string
  credentialId?: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: Variables
}
