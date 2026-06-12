-- Monito Initial Migration
-- Creates the core tables for API health check monitoring

-- monitors: 监控目标
CREATE TABLE IF NOT EXISTS monitors (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  name            TEXT,
  method          TEXT NOT NULL DEFAULT 'HEAD'
                  CHECK(method IN ('HEAD', 'GET')),
  timeout_ms      INTEGER NOT NULL DEFAULT 10000,
  check_interval  INTEGER NOT NULL DEFAULT 60,
  status          TEXT NOT NULL DEFAULT 'unknown'
                  CHECK(status IN ('unknown', 'up', 'down')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_check_at   TEXT,
  last_status_code INTEGER,
  last_response_time_ms INTEGER,
  alert_email     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_monitors_status ON monitors(status);
CREATE INDEX idx_monitors_url ON monitors(url);

-- checks: 检查结果
CREATE TABLE IF NOT EXISTS checks (
  id              TEXT PRIMARY KEY,
  monitor_id      TEXT NOT NULL,
  status_code     INTEGER,
  response_time_ms INTEGER,
  error_msg       TEXT,
  checked_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);
CREATE INDEX idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);
CREATE INDEX idx_checks_time ON checks(checked_at);

-- alert_log: 告警日志
CREATE TABLE IF NOT EXISTS alert_log (
  id              TEXT PRIMARY KEY,
  monitor_id      TEXT NOT NULL,
  alert_type      TEXT NOT NULL DEFAULT 'email',
  status_from     TEXT,
  status_to       TEXT,
  sent_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
);
CREATE INDEX idx_alert_log_monitor ON alert_log(monitor_id);
