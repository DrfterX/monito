// Monito — HTTP Health Check Core Logic

import type { Monitor, CheckResult } from './types'

/**
 * Perform a health check against a single monitor target.
 * Uses AbortController for timeout control.
 * Does NOT retry on failure — next cron tick will retry naturally.
 */
export async function checkMonitor(monitor: Monitor): Promise<CheckResult> {
  const startTime = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), monitor.timeout_ms)

  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Monito/0.1.0',
        'Accept': '*/*',
      },
      redirect: 'follow',
    })

    clearTimeout(timeout)
    const elapsed = performance.now() - startTime

    const success = response.status >= 200 && response.status < 500

    // Detect rate limiting (429) — treat as "reachable but throttled"
    // This is not counted as a failure, but logged for diagnostics.
    const isRateLimited = response.status === 429

    return {
      success,
      statusCode: response.status,
      responseTime: Math.round(elapsed),
      error: isRateLimited
        ? `HTTP 429 Rate Limited (treated as success)`
        : success
          ? null
          : `HTTP ${response.status}`,
    }
  } catch (err: unknown) {
    clearTimeout(timeout)
    const elapsed = performance.now() - startTime

    let errorMsg: string
    if (err instanceof DOMException && err.name === 'AbortError') {
      errorMsg = `Timeout after ${monitor.timeout_ms}ms`
    } else if (err instanceof TypeError) {
      errorMsg = `Network error: ${err.message}`
    } else {
      errorMsg = String(err)
    }

    return {
      success: false,
      statusCode: null,
      responseTime: Math.round(elapsed),
      error: errorMsg,
    }
  }
}

/**
 * Run health checks for multiple monitors concurrently.
 * Respects the concurrency limit from env config.
 */
export async function checkAllMonitors(
  monitors: Monitor[],
  concurrency = 5
): Promise<Array<{ monitorId: string; result: CheckResult }>> {
  const results: Array<{ monitorId: string; result: CheckResult }> = []

  // Run in batches of `concurrency`
  for (let i = 0; i < monitors.length; i += concurrency) {
    const batch = monitors.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (m) => ({
        monitorId: m.id,
        result: await checkMonitor(m),
      }))
    )
    results.push(...batchResults)
  }

  return results
}
