// Monito — D1 Database Layer

import type { Monitor, Check, AlertLog, MonitorSummary, CheckResult, StatusOverview, WaitlistEntry, WaitlistSignupRequest } from './types'

/** Generate a short unique ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ─── Monitors ────────────────────────────────────────────────────────────

export async function createMonitor(db: D1Database, input: {
  url: string
  name?: string
  method?: string
  timeout_ms?: number
  check_interval?: number
  alert_email?: string
}, userId?: string): Promise<Monitor> {
  const id = uid()
  const { url, name, method = 'HEAD', timeout_ms = 10000, check_interval = 60, alert_email } = input

  if (userId) {
    await db.prepare(
      `INSERT INTO monitors (id, url, name, method, timeout_ms, check_interval, alert_email, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, url, name || null, method, timeout_ms, check_interval, alert_email || null, userId).run()
  } else {
    await db.prepare(
      `INSERT INTO monitors (id, url, name, method, timeout_ms, check_interval, alert_email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, url, name || null, method, timeout_ms, check_interval, alert_email || null).run()
  }

  return getMonitor(db, id) as Promise<Monitor>
}

export async function getMonitor(db: D1Database, id: string, userId?: string): Promise<Monitor | null> {
  if (userId) {
    return db.prepare('SELECT * FROM monitors WHERE id = ? AND user_id = ? AND status != ?')
      .bind(id, userId, 'deleted').first<Monitor | null>()
  }
  return db.prepare('SELECT * FROM monitors WHERE id = ? AND status != ?')
    .bind(id, 'deleted').first<Monitor | null>()
}

export async function listMonitors(db: D1Database, userId?: string): Promise<MonitorSummary[]> {
  let query: string
  let bindings: any[]

  if (userId) {
    query = `SELECT id, url, name, status, last_status_code, last_response_time_ms,
                    last_check_at, consecutive_failures
             FROM monitors
             WHERE status != 'deleted' AND user_id = ?
             ORDER BY created_at DESC`
    bindings = [userId]
  } else {
    query = `SELECT id, url, name, status, last_status_code, last_response_time_ms,
                    last_check_at, consecutive_failures
             FROM monitors
             WHERE status != 'deleted'
             ORDER BY created_at DESC`
    bindings = []
  }

  const { results } = await db.prepare(query).bind(...bindings).all<MonitorSummary>()
  return results
}

export async function softDeleteMonitor(db: D1Database, id: string, userId?: string): Promise<boolean> {
  let query: string
  let bindings: any[]

  if (userId) {
    query = "DELETE FROM monitors WHERE id = ? AND user_id = ? AND status != 'deleted'"
    bindings = [id, userId]
  } else {
    query = "DELETE FROM monitors WHERE id = ? AND status != 'deleted'"
    bindings = [id]
  }

  const info = await db.prepare(query).bind(...bindings).run()
  return info.meta.changes > 0
}

export async function getActiveMonitors(db: D1Database): Promise<Monitor[]> {
  const { results } = await db.prepare(
    `SELECT * FROM monitors WHERE status IN ('unknown', 'up', 'down')
       AND (last_check_at IS NULL
         OR datetime(last_check_at, '+' || CAST(check_interval AS TEXT) || ' seconds') <= datetime('now'))`
  ).all<Monitor>()
  return results
}

// ─── Checks ──────────────────────────────────────────────────────────────

export async function recordCheck(
  db: D1Database,
  monitorId: string,
  result: CheckResult
): Promise<Check> {
  const id = uid()
  const { statusCode, responseTime, error } = result
  await db.prepare(
    `INSERT INTO checks (id, monitor_id, status_code, response_time_ms, error_msg)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, monitorId, statusCode, responseTime, error).run()

  // Update monitor status
  const isSuccess = result.success
  const newStatus = isSuccess ? 'up' : 'down'
  const failures = isSuccess ? 0 : (
    (await getMonitor(db, monitorId))?.consecutive_failures ?? 0
  ) + 1

  await db.prepare(
    `UPDATE monitors
     SET status = ?, consecutive_failures = ?,
         last_check_at = datetime('now'),
         last_status_code = ?, last_response_time_ms = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).bind(newStatus, failures, statusCode, Math.round(responseTime), monitorId).run()

  return db.prepare('SELECT * FROM checks WHERE id = ?').bind(id).first<Check>() as Promise<Check>
}

export async function getMonitorChecks(
  db: D1Database,
  monitorId: string,
  limit = 20,
  userId?: string
): Promise<Check[]> {
  if (userId) {
    const { results } = await db.prepare(
      `SELECT c.id, c.monitor_id, c.status_code, c.response_time_ms, c.error_msg, c.checked_at
       FROM checks c
       JOIN monitors m ON m.id = c.monitor_id
       WHERE c.monitor_id = ? AND m.user_id = ? AND m.status != 'deleted'
       ORDER BY c.checked_at DESC LIMIT ?`
    ).bind(monitorId, userId, limit).all<Check>()
    return results
  }

  const { results } = await db.prepare(
    'SELECT id, monitor_id, status_code, response_time_ms, error_msg, checked_at FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?'
  ).bind(monitorId, limit).all<Check>()
  return results
}

export async function updateMonitorAfterAlert(
  db: D1Database,
  monitorId: string,
  fromStatus: string,
  toStatus: string
): Promise<void> {
  const id = uid()
  await db.prepare(
    `INSERT INTO alert_log (id, monitor_id, status_from, status_to)
     VALUES (?, ?, ?, ?)`
  ).bind(id, monitorId, fromStatus, toStatus).run()
}

// ─── Uptime ──────────────────────────────────────────────────────────────

import { UptimeStats, UptimeWindow, WINDOW_OFFSETS, GlobalUptime } from './types'

type UptimeRow = {
  total: number
  successful: number
  failed: number
}

export async function getMonitorUptime(
  db: D1Database,
  monitorId: string,
  window: UptimeWindow = '24h'
): Promise<UptimeStats> {
  const offset = WINDOW_OFFSETS[window] || WINDOW_OFFSETS['24h']
  const row = await db.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status_code IS NOT NULL AND status_code < 500 THEN 1 ELSE 0 END) as successful,
       SUM(CASE WHEN status_code IS NULL OR status_code >= 500 THEN 1 ELSE 0 END) as failed
     FROM checks
     WHERE monitor_id = ? AND checked_at >= datetime('now', ?)`
  ).bind(monitorId, offset).first<UptimeRow>()

  const total = row?.total ?? 0
  const successful = row?.successful ?? 0
  const failed = row?.failed ?? 0

  return {
    monitor_id: monitorId,
    window,
    total_checks: total,
    successful,
    failed,
    uptime_pct: total > 0 ? Math.round((successful / total) * 10000) / 100 : null,
  }
}

/** Global uptime across all monitors */
export async function getGlobalUptime(
  db: D1Database,
  window: UptimeWindow = '24h'
): Promise<GlobalUptime> {
  const offset = WINDOW_OFFSETS[window] || WINDOW_OFFSETS['24h']
  const monitors = await listMonitors(db)

  // Get aggregate across all monitors
  const globalRow = await db.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status_code IS NOT NULL AND status_code < 500 THEN 1 ELSE 0 END) as successful,
       SUM(CASE WHEN status_code IS NULL OR status_code >= 500 THEN 1 ELSE 0 END) as failed
     FROM checks
     WHERE checked_at >= datetime('now', ?)`
  ).bind(offset).first<UptimeRow>()

  // Get per-monitor stats
  const monitorStats: GlobalUptime['monitors'] = []
  for (const m of monitors) {
    const row = await db.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status_code IS NOT NULL AND status_code < 500 THEN 1 ELSE 0 END) as successful,
         SUM(CASE WHEN status_code IS NULL OR status_code >= 500 THEN 1 ELSE 0 END) as failed
       FROM checks
       WHERE monitor_id = ? AND checked_at >= datetime('now', ?)`
    ).bind(m.id, offset).first<UptimeRow>()

    const total = row?.total ?? 0
    const failed = row?.failed ?? 0
    monitorStats.push({
      id: m.id,
      name: m.name,
      uptime_pct: total > 0 ? Math.round(((total - failed) / total) * 10000) / 100 : null,
      total_checks: total,
      failed,
    })
  }

  const globalTotal = globalRow?.total ?? 0
  const globalSuccessful = globalRow?.successful ?? 0
  const globalFailed = globalRow?.failed ?? 0

  return {
    window,
    overall_uptime: globalTotal > 0 ? Math.round((globalSuccessful / globalTotal) * 10000) / 100 : null,
    total_checks: globalTotal,
    total_successful: globalSuccessful,
    total_failed: globalFailed,
    monitors: monitorStats,
  }
}

// ─── Status ──────────────────────────────────────────────────────────────

export async function getStatusOverview(db: D1Database, userId?: string): Promise<StatusOverview> {
  const monitors = await listMonitors(db, userId)
  return {
    total: monitors.length,
    up: monitors.filter(m => m.status === 'up').length,
    down: monitors.filter(m => m.status === 'down').length,
    unknown: monitors.filter(m => m.status === 'unknown').length,
    monitors,
  }
}

// ─── Waitlist ────────────────────────────────────────────────────────────

/** Add an email to the waitlist (idempotent — skips duplicates) */
export async function addToWaitlist(db: D1Database, input: WaitlistSignupRequest): Promise<{ success: boolean; exists: boolean; id: string }> {
  const existing = await db.prepare(
    'SELECT id FROM waitlist WHERE email = ?'
  ).bind(input.email.toLowerCase().trim()).first<{ id: string }>()

  if (existing) {
    return { success: false, exists: true, id: existing.id }
  }

  const id = uid()
  const source = input.source || 'product-page'
  await db.prepare(
    'INSERT INTO waitlist (id, email, source) VALUES (?, ?, ?)'
  ).bind(id, input.email.toLowerCase().trim(), source).run()

  return { success: true, exists: false, id }
}

/** Get total waitlist count */
export async function getWaitlistCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as count FROM waitlist').first<{ count: number }>()
  return row?.count ?? 0
}

/** List all waitlist entries (newest first) */
export async function listWaitlist(db: D1Database, limit = 100): Promise<WaitlistEntry[]> {
  const { results } = await db.prepare(
    'SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?'
  ).bind(limit).all<WaitlistEntry>()
  return results
}
