import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { rateLimit } from '../middleware/rateLimit'
import { registerAuthDeviceRoutes } from './auth/devices'
import { registerAuthLoginRoutes } from './auth/login'
import { registerAuthRegistrationRoutes } from './auth/register'

export const authRoutes = new Hono<AppEnv>()

authRoutes.use('/register', rateLimit({ id: 'auth_register', limit: 10, windowMs: 60_000 }))
authRoutes.use('/login', rateLimit({ id: 'auth_login', limit: 30, windowMs: 60_000 }))
authRoutes.use('/device/add', rateLimit({ id: 'auth_device_add', limit: 20, windowMs: 60_000 }))

registerAuthRegistrationRoutes(authRoutes)
registerAuthLoginRoutes(authRoutes)
registerAuthDeviceRoutes(authRoutes)
