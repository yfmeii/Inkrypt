import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { AppEnv } from './env'
import { authRoutes } from './routes/auth'
import { handshakeRoutes } from './routes/handshake'
import { notesRoutes } from './routes/notes'
import { csrfProtect } from './middleware/csrf'
import { validateEnv } from './middleware/validateEnv'
import { INKRYPT_API_VERSION } from '@inkrypt/contracts/version'
import { deepHealthResponse, livenessResponse } from './routes/health'
export { RateLimiterDO } from './durable/RateLimiterDO'

const app = new Hono<AppEnv>()

app.use('*', logger())
app.get('/healthz', (c) => c.json(livenessResponse(), 200, { 'Cache-Control': 'no-store' }))
app.use('*', validateEnv)
app.use('*', async (c, next) => {
  await next()
  c.header('X-Inkrypt-API-Version', String(INKRYPT_API_VERSION))
  c.header('Cache-Control', 'no-store')
})
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const configured = (c.env.CORS_ORIGIN ?? '').trim()
      if (!configured) return null

      return configured === origin ? origin : null
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
)
app.use('*', csrfProtect)

app.get('/healthz/deep', deepHealthResponse)

app.route('/auth', authRoutes)
app.route('/api', notesRoutes)
app.route('/api/handshake', handshakeRoutes)

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'INTERNAL_ERROR' }, 500)
})

export default app
