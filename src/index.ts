// Monito — Worker Entry Point (Hono)
// Routes: /health, /api/monitors*, /cron/check

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createMonitor, getMonitor, listMonitors, softDeleteMonitor, getMonitorChecks, getActiveMonitors, recordCheck, updateMonitorAfterAlert, getStatusOverview, getMonitorUptime, getGlobalUptime, addToWaitlist, getWaitlistCount } from './db'
import { checkAllMonitors } from './checker'
import { sendAlert, determineAlertType } from './alerter'
import { verifyApiKey } from './auth'
import { canCreateMonitor } from './user'
import type { Env, Variables, CreateMonitorRequest, UptimeWindow } from './types'
import { PRODUCT_PAGE_HTML } from './product-page'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

// ─── CORS ────────────────────────────────────────────────────────────────
app.use('/api/*', cors())

// ─── Root → Product Page ────────────────────────────────────────────────
app.get('/', (c) => c.html(PRODUCT_PAGE_HTML))

app.get('/health', async (c) => {
  const lastRun = await c.env.MONITO_STATE.get('last_cron_run')
  const lastRunTime = lastRun ? parseInt(lastRun, 10) : 0
  const secondsSinceLastRun = lastRunTime ? Math.round((Date.now() - lastRunTime) / 1000) : -1

  const overview = await getStatusOverview(c.env.DB)

  return c.json({
    status: secondsSinceLastRun >= 0 && secondsSinceLastRun < 120 ? 'ok' : (secondsSinceLastRun >= 0 ? 'warning' : 'starting'),
    last_cron_run: lastRunTime ? new Date(lastRunTime).toISOString() : null,
    seconds_since_last_run: secondsSinceLastRun,
    up_monitors: overview.up,
    down_monitors: overview.down,
    total_monitors: overview.total,
    version: '0.1.0',
  })
})

// ─── API Key Auth Middleware ─────────────────────────────────────────────
async function requireAuth(c: any, next: () => Promise<void>) {
  const authHeader = c.req.header('Authorization') || ''
  const xApiKey = c.req.header('x-api-key') || ''

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : xApiKey

  if (!token) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  // Try DB authentication (verifyApiKey joins api_keys + users)
  const user = await verifyApiKey(c.env.DB, token)
  if (user) {
    c.set('userId', user.id)
    c.set('user', user)
    return next()
  }

  // Fallback: MONITO_API_KEY env var for admin backward compatibility
  const apiKey = c.env.MONITO_API_KEY
  if (apiKey && token === apiKey) {
    return next()
  }

  return c.json({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401)
}

// ─── Monitors API ────────────────────────────────────────────────────────

/** POST /api/monitors — Create a new monitor */
app.post('/api/monitors', requireAuth, async (c) => {
  const body = await c.req.json<CreateMonitorRequest>()
  const userId = c.get('userId')
  const user = c.get('user')

  if (!body.url || typeof body.url !== 'string') {
    return c.json({ error: 'url is required', code: 'INVALID_INPUT' }, 400)
  }

  try {
    new URL(body.url)
  } catch {
    return c.json({ error: 'Invalid URL format', code: 'INVALID_URL' }, 400)
  }

  // Free tier limits (skip for admin fallback — no user object)
  if (user) {
    const limitCheck = await canCreateMonitor(c.env.DB, userId!, user.plan)
    if (!limitCheck.allowed) {
      return c.json({
        error: `Plan limit reached (${limitCheck.max} monitors). Upgrade to Pro for more.`,
        code: 'LIMIT_REACHED',
        current: limitCheck.current,
        max: limitCheck.max,
      }, 403)
    }

    // Clamp check_interval to plan minimums
    const minInterval: Record<string, number> = { free: 300, pro: 60, team: 30 }
    const min = minInterval[user.plan] || 300
    if (body.check_interval !== undefined && body.check_interval < min) {
      body.check_interval = min
    }
  }

  const monitor = await createMonitor(c.env.DB, body, userId)
  return c.json(monitor, 201)
})

/** GET /api/monitors — List all monitors (scoped to user) */
app.get('/api/monitors', requireAuth, async (c) => {
  const userId = c.get('userId')
  const monitors = await listMonitors(c.env.DB, userId)
  return c.json(monitors)
})

/** GET /api/monitors/:id — Get a single monitor (scoped to user) */
app.get('/api/monitors/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const monitor = await getMonitor(c.env.DB, c.req.param('id'), userId)
  if (!monitor) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
  return c.json(monitor)
})

/** DELETE /api/monitors/:id — Soft-delete a monitor */
app.delete('/api/monitors/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const deleted = await softDeleteMonitor(c.env.DB, c.req.param('id'), userId)
  if (!deleted) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
  return c.json({ success: true })
})

/** GET /api/monitors/:id/checks — Check history for a monitor */
app.get('/api/monitors/:id/checks', requireAuth, async (c) => {
  const userId = c.get('userId')
  const limit = parseInt(c.req.query('limit') || '20', 10)
  const checks = await getMonitorChecks(c.env.DB, c.req.param('id'), Math.min(limit, 100), userId)
  return c.json(checks)
})

/** GET /api/status — Public status overview (no auth) */
app.get('/api/status', async (c) => {
  const overview = await getStatusOverview(c.env.DB)
  return c.json(overview)
})

/** GET /api/monitors/:id/uptime — Uptime statistics (scoped to user) */
app.get('/api/monitors/:id/uptime', requireAuth, async (c) => {
  const userId = c.get('userId')
  const monitor = await getMonitor(c.env.DB, c.req.param('id'), userId)
  if (!monitor) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)

  const window = (c.req.query('window') || '24h') as UptimeWindow
  const validWindows: UptimeWindow[] = ['1h', '24h', '7d', '30d']
  if (!validWindows.includes(window)) {
    return c.json({ error: 'Invalid window. Use: 1h, 24h, 7d, 30d', code: 'INVALID_WINDOW' }, 400)
  }

  const stats = await getMonitorUptime(c.env.DB, c.req.param('id'), window)
  return c.json(stats)
})

// ─── Waitlist API ──────────────────────────────────────────────────────

/** POST /api/waitlist — Sign up for early access */
app.post('/api/waitlist', async (c) => {
  try {
    const body = await c.req.json<{ email: string; source?: string }>()

    if (!body.email || typeof body.email !== 'string') {
      return c.json({ error: 'Email is required', code: 'INVALID_INPUT' }, 400)
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.email.trim())) {
      return c.json({ error: 'Invalid email format', code: 'INVALID_EMAIL' }, 400)
    }

    const result = await addToWaitlist(c.env.DB, {
      email: body.email.trim(),
      source: body.source || 'product-page',
    })

    if (result.exists) {
      return c.json({ success: true, message: 'You\'re already on the waitlist!', id: result.id })
    }

    return c.json({ success: true, message: 'Welcome to the waitlist!', id: result.id }, 201)
  } catch (err) {
    console.error('Waitlist error:', err)
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

/** GET /api/waitlist/count — Waitlist signup count */
app.get('/api/waitlist/count', async (c) => {
  const count = await getWaitlistCount(c.env.DB)
  return c.json({ count })
})

/** GET /api/uptime — Global uptime across all monitors */
app.get('/api/uptime', async (c) => {
  const window = (c.req.query('window') || '24h') as UptimeWindow
  const validWindows: UptimeWindow[] = ['1h', '24h', '7d', '30d']
  if (!validWindows.includes(window)) {
    return c.json({ error: 'Invalid window. Use: 1h, 24h, 7d, 30d', code: 'INVALID_WINDOW' }, 400)
  }

  const stats = await getGlobalUptime(c.env.DB, window)
  return c.json(stats)
})

// ─── Cron Handler ────────────────────────────────────────────────────────

async function determineAlert(
  env: Env,
  monitorId: string,
  previousStatus: string,
  newStatus: string,
  consecutiveFailures: number
): Promise<'down' | 'recovery' | null> {
  const minFailures = parseInt(env.MIN_FAILURES_FOR_ALERT || '3', 10)
  const cooldownMinutes = parseInt(env.ALERT_COOLDOWN_MINUTES || '30', 10)

  const cooldownKey = `alert_cooldown:${monitorId}`
  const cooldownStr = await env.MONITO_STATE.get(cooldownKey)
  if (cooldownStr) {
    const cooldownTime = parseInt(cooldownStr, 10)
    if (Date.now() < cooldownTime) {
      return null
    }
  }

  if (previousStatus !== 'down' && newStatus === 'down' && consecutiveFailures >= minFailures) {
    await env.MONITO_STATE.put(cooldownKey, String(Date.now() + cooldownMinutes * 60 * 1000), {
      expirationTtl: cooldownMinutes * 60 + 60,
    })
    return 'down'
  }

  if (previousStatus === 'down' && newStatus === 'up') {
    return 'recovery'
  }

  return null
}

app.post('/cron/check', async (c) => {
  const env = c.env
  const concurrency = parseInt(env.CHECK_CONCURRENCY || '5', 10)

  await env.MONITO_STATE.put('last_cron_run', String(Date.now()))

  const monitors = await getActiveMonitors(c.env.DB)

  if (monitors.length === 0) {
    return c.json({ checked: 0, message: 'No monitors configured' })
  }

  const checkResults = await checkAllMonitors(monitors, concurrency)

  const summary = { up: 0, down: 0, alerts: 0 }
  const alertPromises: Promise<void>[] = []

  for (const { monitorId, result } of checkResults) {
    const monitor = monitors.find(m => m.id === monitorId)
    if (!monitor) continue

    const previousStatus = monitor.status

    await recordCheck(c.env.DB, monitorId, result)

    const updatedMonitor = await getMonitor(c.env.DB, monitorId)
    if (!updatedMonitor) continue

    if (result.success) summary.up++
    else summary.down++

    const alertType = await determineAlert(
      env,
      monitorId,
      previousStatus,
      result.success ? 'up' : 'down',
      updatedMonitor.consecutive_failures
    )

    if (alertType && env.RESEND_API_KEY && updatedMonitor.alert_email) {
      alertPromises.push(
        (async () => {
          const sent = await sendAlert(env.RESEND_API_KEY!, updatedMonitor, alertType, env.DEFAULT_ALERT_FROM, env.ALERT_EMAIL)
          if (sent) {
            await updateMonitorAfterAlert(c.env.DB, monitorId, previousStatus, result.success ? 'up' : 'down')
            summary.alerts++
          }
        })()
      )
    }
  }

  if (alertPromises.length > 0) {
    c.executionCtx.waitUntil(Promise.all(alertPromises))
  }

  return c.json({
    checked: checkResults.length,
    up: summary.up,
    down: summary.down,
    alerts_sent: summary.alerts,
    alerts_pending: alertPromises.length,
  })
})

// ─── Cron Trigger (wrangler cron) ────────────────────────────────────────

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const concurrency = parseInt(env.CHECK_CONCURRENCY || '5', 10)

    await env.MONITO_STATE.put('last_cron_run', String(Date.now()))

    const monitors = await getActiveMonitors(env.DB)

    if (monitors.length === 0) return

    const checkResults = await checkAllMonitors(monitors, concurrency)

    const alertPromises: Promise<void>[] = []

    for (const { monitorId, result } of checkResults) {
      const monitor = monitors.find(m => m.id === monitorId)
      if (!monitor) continue

      const previousStatus = monitor.status
      await recordCheck(env.DB, monitorId, result)

      const updatedMonitor = await getMonitor(env.DB, monitorId)
      if (!updatedMonitor) continue

      const alertType = await determineAlert(
        env,
        monitorId,
        previousStatus,
        result.success ? 'up' : 'down',
        updatedMonitor.consecutive_failures
      )

      if (alertType && env.RESEND_API_KEY && updatedMonitor.alert_email) {
        alertPromises.push(
          (async () => {
            const sent = await sendAlert(env.RESEND_API_KEY!, updatedMonitor, alertType, env.DEFAULT_ALERT_FROM, env.ALERT_EMAIL)
            if (sent) {
              await updateMonitorAfterAlert(env.DB, monitorId, previousStatus, result.success ? 'up' : 'down')
            }
          })()
        )
      }
    }

    if (alertPromises.length > 0) {
      ctx.waitUntil(Promise.all(alertPromises))
    }
  },
}