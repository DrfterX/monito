-- Monito — Multi-Tenant Schema
-- Phase 0: Add users + api_keys tables, alter monitors for multi-tenant.
-- Phase 1 & 2 are code-side only (auth middleware, API isolation).
--
-- Safe to run on production: ALTER TABLE is additive, existing queries
-- continue working because user_id/is_public have defaults.

-- ── Users ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'pro', 'team')),
  max_monitors  INTEGER NOT NULL DEFAULT 5,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_email ON users(email);

-- ── API Keys ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  key_prefix    TEXT NOT NULL,
  name          TEXT,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at    TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- ── Monitors — multi-tenant columns ─────────────────────────────────────
ALTER TABLE monitors ADD COLUMN user_id TEXT;
ALTER TABLE monitors ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

-- Index for per-user monitor queries (needed once user_id is populated)
CREATE INDEX idx_monitors_user ON monitors(user_id);