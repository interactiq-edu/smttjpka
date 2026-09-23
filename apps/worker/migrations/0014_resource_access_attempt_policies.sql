ALTER TABLE learning_resources ADD COLUMN attempt_policy TEXT NOT NULL DEFAULT 'MULTIPLE'
  CHECK (attempt_policy IN ('ONCE_PER_EMAIL', 'MULTIPLE'));

ALTER TABLE learning_resources ADD COLUMN access_starts_at TEXT;

CREATE INDEX idx_learning_resources_access_starts_at
  ON learning_resources(tenant_id, access_starts_at);
