CREATE TABLE auth_rate_limits (
  scope_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lockout_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_rate_limits_lockout ON auth_rate_limits(lockout_until);
