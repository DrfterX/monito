// Monito — Type Definitions

/** HTTP method for health checks */
export type HttpMethod = 'HEAD' | 'GET'

/** Monitor status */
export type MonitorStatus = 'unknown' | 'up' | 'down' | 'deleted'

/** User plan */
export type UserPlan = 'free' | 'pro' | 'team'

/** A monitored endpoint */
export interface Monitor {
  id: string
  url: string
  name: string | null
  method: HttpMethod
  timeout_ms: number
  check_interval: number
  status: MonitorStatus
  consecutive_failures: number
  last_check_at: string | null
  last_status_code: number | null
  last_response_time_ms: number | null
  alert_email: string | null
  api_key_id: string | null
  user_id: string | null
  is_public: number
  created_at: string
  updated_at: string
}

/** A single health check result */
export interface Check {
  id: string
  monitor_id: string
  status_code: number | null
  response_time_ms: number | null
  error_msg: string | null
  checked_at: string
}

/** Alert log entry */
export interface AlertLog {
  id: string
  monitor_id: string
  alert_type: string
  status_from: string | null
  status_to: string | null
  sent_at: string
}

/** Result of a single health check execution */
export interface CheckResult {
  success: boolean
  statusCode: number | null
  responseTime: number
  error: string | null
}

/** Request body for creating a monitor */
export interface CreateMonitorRequest {
  url: string
  name?: string
  method?: HttpMethod
  timeout_ms?: number
  check_interval?: number
  alert_email?: string
}

/** Brief monitor summary for listing */
export interface MonitorSummary {
  id: string
  url: string
  name: string | null
  status: MonitorStatus
  last_status_code: number | null
  last_response_time_ms: number | null
  last_check_at: string | null
  consecutive_failures: number
}

/** System health status */
export interface HealthStatus {
  status: 'ok' | 'warning' | 'error'
  last_cron_run: string
  seconds_since_last_run: number
  up_monitors: number
  down_monitors: number
  total_monitors: number
  version: string
}

/** Status overview */
export interface StatusOverview {
  total: number
  up: number
  down: number
  unknown: number
  monitors: MonitorSummary[]
}

/** Error response */
export interface ApiError {
  error: string
  code: string
}

/** Uptime aggregation window presets */
export type UptimeWindow = '1h' | '24h' | '7d' | '30d'

/** Window → D1 datetime offset mapping */
export const WINDOW_OFFSETS: Record<UptimeWindow, string> = {
  '1h': '-1 hour',
  '24h': '-1 day',
  '7d': '-7 days',
  '30d': '-30 days',
}

/** Uptime statistics for a single monitor */
export interface UptimeStats {
  monitor_id: string
  window: UptimeWindow
  total_checks: number
  successful: number
  failed: number
  uptime_pct: number | null
}

/** Global uptime statistics across all monitors */
export interface GlobalUptime {
  window: UptimeWindow
  overall_uptime: number | null
  total_checks: number
  total_successful: number
  total_failed: number
  monitors: Array<{
    id: string
    name: string | null
    uptime_pct: number | null
    total_checks: number
    failed: number
  }>
}

/** KV lock entry for alert cooldown */
export interface AlertCooldown {
  monitor_id: string
  last_alert_at: string
  next_alert_at: string
}

/** Waitlist / Early Access registration */
export interface WaitlistEntry {
  id: string
  email: string
  source: string
  created_at: string
}

/** Request body for waitlist signup */
export interface WaitlistSignupRequest {
  email: string
  source?: string
}

// Hono context variables (set by auth middleware)
export interface Variables {
  userId?: string
  user?: User
}

// Worker Env bindings
export interface Env {
  DB: D1Database
  MONITO_STATE: KVNamespace
  ENVIRONMENT?: string
  CHECK_TIMEOUT?: string
  CHECK_CONCURRENCY?: string
  MIN_FAILURES_FOR_ALERT?: string
  ALERT_COOLDOWN_MINUTES?: string
  RESEND_API_KEY?: string
  DEFAULT_ALERT_FROM?: string
  ALERT_EMAIL?: string
  MONITO_API_KEY?: string  // Admin fallback, will be removed in Phase 4
}

// ═══════════════════════════════════════════════════════════════════
// Multi-Tenant Types (Step 1)
// ═══════════════════════════════════════════════════════════════════

/** A registered user */
export interface User {
  id: string
  email: string
  name: string | null
  plan: UserPlan
  max_monitors: number
  created_at: string
  updated_at: string
}

/** An API key belonging to a user */
export interface ApiKey {
  id: string
  user_id: string
  key_hash: string
  key_prefix: string
  name: string | null
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

/** Request body for user signup */
export interface SignupRequest {
  email: string
  name?: string
  plan?: UserPlan
}

/** API key with its user (joined result) */
export interface ApiKeyWithUser extends ApiKey {
  user_plan: UserPlan
  user_email: string
  max_monitors: number
}
