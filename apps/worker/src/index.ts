import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { AppEnv } from './env'
import { authRoutes } from './routes/auth'
import { handshakeRoutes } from './routes/handshake'
import { notesRoutes } from './routes/notes'
import { csrfProtect } from './middleware/csrf'
import { validateEnv } from './middleware/validateEnv'
export { RateLimiterDO } from './durable/RateLimiterDO'

const app = new Hono<AppEnv>()

app.use('*', logger())
app.use('*', validateEnv)
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const configured = (c.env.CORS_ORIGIN ?? '').trim()
      if (!configured) return null

      const allowed = configured
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)

      return allowed.includes(origin) ? origin : null
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
)
app.use('*', csrfProtect)

app.get('/healthz', (c) => c.json({ ok: true }))

app.route('/auth', authRoutes)
app.route('/api', notesRoutes)
app.route('/api/handshake', handshakeRoutes)

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'INTERNAL_ERROR' }, 500)
})

export default app
