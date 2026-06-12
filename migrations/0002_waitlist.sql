-- Monito — Waitlist / Early Access Registration
-- Collects email signups for the SaaS launch waiting list
--
-- Design: separate from monitors/checks/alert_log so waitlist data
-- stays clean and can be dropped independently after user migration.

CREATE TABLE IF NOT EXISTS waitlist (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL DEFAULT 'product-page',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_waitlist_email ON waitlist(email);
CREATE INDEX idx_waitlist_created ON waitlist(created_at);