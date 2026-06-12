#!/usr/bin/env node
// Monito CLI — Manage health checks from the terminal
// Usage: monito add|list|status|remove|login [args]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'

const CONFIG_DIR = resolve(homedir(), '.config', 'monito')
const CONFIG_FILE = resolve(CONFIG_DIR, 'config.json')
const API_BASE = 'https://monito.yycomyy.workers.dev'

interface Config {
  apiKey?: string
  apiBase?: string
}

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return {}
}

function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

function getHeaders(config: Config): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers['x-api-key'] = config.apiKey
  return headers
}

function getApiBase(config: Config): string {
  return config.apiBase || API_BASE
}

function exit(msg: string, code = 1): never {
  console.error(msg)
  process.exit(code)
}

// ─── Commands ────────────────────────────────────────────────────────────

async function cmdAdd(url: string, options: { name?: string; method?: string; email?: string; json?: boolean }) {
  if (!url) exit('Usage: monito add <url> [--name "My API"] [--method HEAD|GET] [--email alert@example.com]')

  // Validate URL
  try { new URL(url) } catch { exit(`Invalid URL: ${url}`) }

  const config = loadConfig()
  if (!config.apiKey) exit('Not logged in. Run: monito login <api-key>')

  const body: Record<string, unknown> = { url }
  if (options.name) body.name = options.name
  if (options.method && ['HEAD', 'GET'].includes(options.method.toUpperCase())) body.method = options.method.toUpperCase()
  if (options.email) body.alert_email = options.email

  const res = await fetch(`${getApiBase(config)}/api/monitors`, {
    method: 'POST',
    headers: getHeaders(config),
    body: JSON.stringify(body),
  })

  if (!res.ok) exit(`Error: ${res.status} ${res.statusText}`)

  const data = await res.json()
  if (options.json) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(`✅ Monitor created: ${data.name || data.url} (${data.id})`)
  }
}

async function cmdList(options: { json?: boolean }) {
  const config = loadConfig()
  const res = await fetch(`${getApiBase(config)}/api/monitors`, { headers: getHeaders(config) })
  if (!res.ok) exit(`Error: ${res.status} ${res.statusText}`)

  const data = await res.json()
  if (options.json) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    if (data.length === 0) {
      console.log('No monitors configured.')
      return
    }
    console.log('Monitors:')
    for (const m of data) {
      const statusIcon = m.status === 'up' ? '🟢' : m.status === 'down' ? '🔴' : '⚪'
      const name = m.name || '-'
      const lastCheck = m.last_check_at ? new Date(m.last_check_at + 'Z').toLocaleString() : 'never'
      console.log(`  ${statusIcon} ${m.id.slice(0, 8)}  ${m.url.padEnd(45)}  ${statusIcon} ${m.status.padEnd(10)}  ${m.last_response_time_ms ?? '-'}ms  ${lastCheck}`)
    }
  }
}

async function cmdStatus(options: { json?: boolean }) {
  const config = loadConfig()
  const res = await fetch(`${getApiBase(config)}/api/status`, { headers: getHeaders(config) })
  if (!res.ok) exit(`Error: ${res.status} ${res.statusText}`)

  const data = await res.json()
  if (options.json) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(`Status overview:`)
    console.log(`  Total: ${data.total}`)
    console.log(`  🟢 Up:    ${data.up}`)
    console.log(`  🔴 Down:  ${data.down}`)
    console.log(`  ⚪ Unknown: ${data.unknown}`)
  }
}

async function cmdRemove(id: string, options: { json?: boolean }) {
  if (!id) exit('Usage: monito remove <id>')

  const config = loadConfig()
  if (!config.apiKey) exit('Not logged in. Run: monito login <api-key>')

  const res = await fetch(`${getApiBase(config)}/api/monitors/${id}`, {
    method: 'DELETE',
    headers: getHeaders(config),
  })

  if (res.status === 404) exit('Monitor not found')
  if (!res.ok) exit(`Error: ${res.status} ${res.statusText}`)

  if (options.json) {
    console.log(JSON.stringify({ success: true }, null, 2))
  } else {
    console.log(`✅ Monitor ${id} removed`)
  }
}

function cmdLogin(apiKey?: string) {
  if (!apiKey) exit('Usage: monito login <api-key>')
  const config = loadConfig()
  config.apiKey = apiKey
  saveConfig(config)
  console.log('✅ API key saved to ~/.config/monito/config.json')
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]

  // Parse global --json flag (any position)
  const jsonIdx = args.indexOf('--json')
  const json = jsonIdx >= 0
  if (json) args.splice(jsonIdx, 1)

  // Parse named options
  const name = parseOption(args, '--name')
  const method = parseOption(args, '--method')
  const email = parseOption(args, '--email')

  switch (cmd) {
    case 'add':
      return cmdAdd(args[1], { name, method, email, json })
    case 'list':
      return cmdList({ json })
    case 'status':
      return cmdStatus({ json })
    case 'remove':
    case 'rm':
      return cmdRemove(args[1], { json })
    case 'login':
      return cmdLogin(args[1])
    case '--help':
    case '-h':
    case undefined:
      showHelp()
      return
    case '--version':
    case '-v':
      console.log('monito v0.1.0')
      return
    default:
      exit(`Unknown command: ${cmd}\nRun: monito --help`)
  }
}

function parseOption(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx >= 0 && idx + 1 < args.length) {
    const val = args[idx + 1]
    args.splice(idx, 2)
    return val
  }
  return undefined
}

function showHelp() {
  console.log(`
Monito — API Health Check Monitor

Usage:
  monito add <url>       Add an endpoint to monitor
    --name <name>        Friendly name for the monitor
    --method HEAD|GET    HTTP method (default: HEAD)
    --email <email>      Alert email address
  monito list            List all monitors
  monito status          Show status overview
  monito remove <id>     Remove a monitor (soft delete)
  monito login <key>     Save API key for authentication

Global options:
  --json                 Output JSON (pipe to jq for advanced querying)
  --help                 Show this help
  --version              Show version number
`)
}

main().catch(err => exit(String(err)))
