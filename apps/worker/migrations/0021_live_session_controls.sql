ALTER TABLE attempts ADD COLUMN kicked_at TEXT;

CREATE INDEX idx_attempts_live_participants
  ON attempts(tenant_id, resource_id, status, kicked_at, updated_at DESC);
