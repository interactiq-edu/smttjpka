ALTER TABLE learning_resources ADD COLUMN assignment_max_score REAL NOT NULL DEFAULT 100;

ALTER TABLE attempts ADD COLUMN assignment_review_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (assignment_review_status IN ('PENDING', 'NOT_REVIEWED', 'REVIEWED'));
ALTER TABLE attempts ADD COLUMN assignment_mark REAL;
ALTER TABLE attempts ADD COLUMN assignment_feedback TEXT;

CREATE INDEX idx_attempts_assignment_review_status
  ON attempts(tenant_id, assignment_review_status, submitted_at);
