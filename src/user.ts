// Monito — User & Account Management
//
// User CRUD operations for multi-tenant SaaS.
// All DB-facing queries for user lifecycle.

import type { User, UserPlan } from './types'
import { storeApiKey, generateApiKey } from './auth'

/** Generate a short unique ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * Create a new user and generate their first API key.
 * Returns the user object and the raw API key (must be shown to the user once).
 */
export async function createUser(
  db: D1Database,
  input: {
    email: string
    name?: string
    plan?: UserPlan
    max_monitors?: number
  }
): Promise<{ user: User; apiKey: { raw: string; prefix: string } }> {
  const id = 'u_' + uid()
  const email = input.email.toLowerCase().trim()
  const name = input.name || null
  const plan = input.plan || 'free'
  const maxMonitors = input.max_monitors ?? (plan === 'free' ? 5 : 20)

  await db.prepare(
    `INSERT INTO users (id, email, name, plan, max_monitors)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, email, name, plan, maxMonitors).run()

  // Generate first API key
  const key = await generateApiKey()
  await storeApiKey(db, id, key.raw, name || 'Default Key')

  const user = await getUser(db, id)
  return { user: user!, apiKey: { raw: key.raw, prefix: key.prefix } }
}

/** Get a user by ID */
export async function getUser(db: D1Database, userId: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User | null>()
}

/** Get a user by email */
export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?')
    .bind(email.toLowerCase().trim()).first<User | null>()
}

/** Update user's plan */
export async function updateUserPlan(
  db: D1Database,
  userId: string,
  plan: UserPlan,
  maxMonitors?: number
): Promise<User | null> {
  if (maxMonitors !== undefined) {
    await db.prepare(
      `UPDATE users SET plan = ?, max_monitors = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(plan, maxMonitors, userId).run()
  } else {
    // Calculate default max_monitors for plan
    const defaults: Record<UserPlan, number> = { free: 5, pro: 20, team: 50 }
    const max = defaults[plan] || 5
    await db.prepare(
      `UPDATE users SET plan = ?, max_monitors = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(plan, max, userId).run()
  }

  return getUser(db, userId)
}

/** Count monitors for a user */
export async function countUserMonitors(
  db: D1Database,
  userId: string
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) as count FROM monitors WHERE user_id = ? AND status != 'deleted'`
  ).bind(userId).first<{ count: number }>()
  return row?.count ?? 0
}

/** Check if user can create more monitors */
export async function canCreateMonitor(
  db: D1Database,
  userId: string,
  userPlan: UserPlan
): Promise<{ allowed: boolean; current: number; max: number }> {
  const max: Record<UserPlan, number> = { free: 5, pro: 20, team: 50 }
  const limit = max[userPlan] || 5
  const current = await countUserMonitors(db, userId)

  return {
    allowed: current < limit,
    current,
    max: limit,
  }
}
