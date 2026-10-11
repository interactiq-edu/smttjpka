-- Preserve unresolved AI marks as pending and keep a small tenant-scoped usage ledger.
ALTER TABLE attempt_answers ADD COLUMN ai_marking_status TEXT;
ALTER TABLE attempt_answers ADD COLUMN ai_provider TEXT;
ALTER TABLE attempt_answers ADD COLUMN ai_error_code TEXT;

UPDATE attempt_answers
SET ai_marking_status = CASE
  WHEN teacher_points IS NOT NULL THEN 'MANUAL'
  WHEN ai_suggested_points IS NOT NULL THEN 'GRADED'
  WHEN question_id IN (SELECT id FROM questions WHERE question_type IN ('OPEN_ENDED', 'MATH_RESPONSE')) THEN 'PENDING'
  ELSE 'NOT_REQUIRED'
END;

CREATE TABLE ai_usage_daily (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  successful_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, usage_date, provider)
);

CREATE INDEX idx_attempt_answers_ai_pending ON attempt_answers(ai_marking_status, attempt_id);
CREATE INDEX idx_ai_usage_daily_tenant_date ON ai_usage_daily(tenant_id, usage_date DESC);
