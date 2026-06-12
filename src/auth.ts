// Monito — API Key Authentication
//
// mk_xxx format: "mk_" + 32 random hex chars
// Stored as SHA-256 hash (not plaintext) in the api_keys table.
// Uses Web Crypto API (available in Workers and Node via nodejs_compat).

import type { User } from './types'

/**
 * Generate a new API key in mk_xxx format.
 * Returns both the raw key (shown once to the user) and the SHA-256 hash (stored).
 */
export async function generateApiKey(): Promise<{ raw: string; hash: string; prefix: string }> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const raw = 'mk_' + hex
  const hash = await sha256Hex(raw)
  const prefix = raw.slice(0, 12) // "mk_a1b2c3d4" — 用于 UI 展示

  return { raw, hash, prefix }
}

/**
 * Compute SHA-256 hex digest of a string.
 * Uses Web Crypto API — guaranteed available in Cloudflare Workers.
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Verify an API key against the database.
 * 1. SHA-256 hash the raw key
 * 2. Look up in api_keys table
 * 3. If found and not revoked, return the associated user
 * 4. Update last_used_at
 *
 * Returns null if key is invalid, revoked, or user not found.
 */
export async function verifyApiKey(db: D1Database, rawKey: string): Promise<User | null> {
  const hash = await sha256Hex(rawKey)

  const apiKey = await db.prepare(
    `SELECT ak.user_id, u.id, u.email, u.name, u.plan, u.max_monitors,
            u.created_at, u.updated_at
     FROM api_keys ak
     JOIN users u ON u.id = ak.user_id
     WHERE ak.key_hash = ? AND ak.revoked_at IS NULL`
  ).bind(hash).first<User & { user_id: string }>()

  if (!apiKey) return null

  // Update last_used_at (fire-and-forget — don't block the response)
  db.prepare(
    `UPDATE api_keys SET last_used_at = datetime('now') WHERE key_hash = ?`
  ).bind(hash).run().catch(() => { /* non-critical */ })

  const { user_id, ...user } = apiKey
  return user
}

/**
 * Hash and store a new API key for a user.
 * Returns only the prefix and id — the raw key must be communicated to the user
 * before this function returns (it cannot be recovered from the database).
 */
export async function storeApiKey(
  db: D1Database,
  userId: string,
  rawKey: string,
  name: string | null = null
): Promise<{ id: string; prefix: string }> {
  const hash = await sha256Hex(rawKey)
  const prefix = rawKey.slice(0, 12)
  const id = uid()

  await db.prepare(
    `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(id, userId, hash, prefix, name).run()

  return { id, prefix }
}

/**
 * Revoke an API key by its id (soft delete — sets revoked_at).
 */
export async function revokeApiKey(db: D1Database, keyId: string): Promise<boolean> {
  const info = await db.prepare(
    `UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`
  ).bind(keyId).run()
  return (info.meta.changes ?? 0) > 0
}

/**
 * List all non-revoked API keys for a user (showing prefix, not the full hash).
 */
export async function listApiKeys(db: D1Database, userId: string): Promise<Array<{
  id: string; key_prefix: string; name: string | null;
  last_used_at: string | null; created_at: string; revoked_at: string | null
}>> {
  const { results } = await db.prepare(
    `SELECT id, key_prefix, name, last_used_at, created_at, revoked_at
     FROM api_keys
     WHERE user_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC`
  ).bind(userId).all()
  return results as any
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a short unique ID (copied from db.ts to keep auth.ts self-contained) */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
