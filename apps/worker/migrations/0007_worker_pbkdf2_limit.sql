-- Cloudflare Workers Web Crypto accepts no more than 100,000 PBKDF2
-- iterations. Rebuild this table to align the database constraint with the
-- Worker runtime while preserving every existing administrator record.
CREATE TABLE admin_users_replacement (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username TEXT NOT NULL COLLATE NOCASE,
  password_algorithm TEXT NOT NULL CHECK (password_algorithm = 'PBKDF2-HMAC-SHA-256'),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations = 100000),
  password_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until TEXT,
  UNIQUE (tenant_id, username)
);

INSERT INTO admin_users_replacement (
  user_id, tenant_id, username, password_algorithm, password_hash,
  password_salt, password_iterations, password_changed_at,
  failed_login_count, locked_until
)
SELECT
  user_id, tenant_id, username, password_algorithm, password_hash,
  password_salt, 100000, password_changed_at,
  failed_login_count, locked_until
FROM admin_users;

DROP TABLE admin_users;
ALTER TABLE admin_users_replacement RENAME TO admin_users;
CREATE INDEX idx_admin_users_tenant_username ON admin_users(tenant_id, username);
