// Monito — Email Alerting via Resend

import type { Monitor } from './types'

const RESEND_API = 'https://api.resend.com/emails'

interface ResendPayload {
  from: string
  to: string
  subject: string
  html: string
}

/**
 * Build an alert email payload for a monitor going down.
 */
function buildDownAlert(monitor: Monitor, from: string, to: string): ResendPayload {
  return {
    from,
    to,
    subject: `🔴 DOWN: ${monitor.name || monitor.url}`,
    html: `
      <h2>🔴 Monitor Down</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px;">
        <tr><td style="padding:8px;font-weight:bold;">Name</td><td>${monitor.name || '-'}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;">URL</td><td><code>${monitor.url}</code></td></tr>
        <tr><td style="padding:8px;font-weight:bold;">Method</td><td>${monitor.method}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;">Consecutive Failures</td><td>${monitor.consecutive_failures}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;">Last Status</td><td>${monitor.last_status_code || 'N/A'}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;">Last Response</td><td>${monitor.last_response_time_ms ?? 'N/A'}ms</td></tr>
      </table>
      <p style="color:#666;font-size:12px;">Sent by Monito (auto-company)</p>
    `,
  }
}

/**
 * Build a recovery email payload for a monitor coming back up.
 */
function buildRecoveryAlert(monitor: Monitor, from: string, to: string): ResendPayload {
  return {
    from,
    to,
    subject: `✅ UP: ${monitor.name || monitor.url}`,
    html: `
      <h2>✅ Monitor Recovered</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px;">
        <tr><td style="padding:8px;font-weight:bold;">Name</td><td>${monitor.name || '-'}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;">URL</td><td><code>${monitor.url}</code></td></tr>
        <tr><td style="padding:8px;font-weight:bold;">Status Code</td><td>${monitor.last_status_code}</td></tr>
        <tr><td style="padding:8px;font-weight:bold;">Response Time</td><td>${monitor.last_response_time_ms}ms</td></tr>
      </table>
      <p style="color:#666;font-size:12px;">Sent by Monito (auto-company)</p>
    `,
  }
}

/**
 * Send an alert email via Resend API.
 * Can be called from ctx.waitUntil() — non-blocking.
 */
export async function sendAlert(
  resendApiKey: string,
  monitor: Monitor,
  type: 'down' | 'recovery',
  fromEmail?: string,
  defaultAlertEmail?: string
): Promise<boolean> {
  const from = fromEmail || 'Monito <noreply@monito-status.com>'
  const to = monitor.alert_email || defaultAlertEmail || 'yycomyy@gmail.com'
  const payload = type === 'down' ? buildDownAlert(monitor, from, to) : buildRecoveryAlert(monitor, from, to)

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`[alerter] Resend error (${res.status}): ${body}`)
      return false
    }

    console.log(`[alerter] Alert sent: ${payload.subject}`)
    return true
  } catch (err) {
    console.error(`[alerter] Failed to send alert:`, err)
    return false
  }
}

/**
 * Determine alert type based on previous and current status.
 */
export function determineAlertType(
  previousStatus: string,
  newStatus: string
): 'down' | 'recovery' | null {
  if (newStatus === 'down' && ['up', 'unknown'].includes(previousStatus)) return 'down'
  if (newStatus === 'up' && previousStatus === 'down') return 'recovery'
  return null
}
