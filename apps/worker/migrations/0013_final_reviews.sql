ALTER TABLE attempts ADD COLUMN final_reviewed_at TEXT;
ALTER TABLE attempts ADD COLUMN final_reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_attempts_final_review ON attempts(tenant_id, final_reviewed_at, submitted_at DESC);
