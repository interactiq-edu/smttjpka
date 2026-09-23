ALTER TABLE learning_resources ADD COLUMN submission_due_at TEXT;

ALTER TABLE attempts ADD COLUMN submission_file_url TEXT;
ALTER TABLE attempts ADD COLUMN submission_file_name TEXT;
ALTER TABLE attempts ADD COLUMN submission_mime_type TEXT;
ALTER TABLE attempts ADD COLUMN submission_file_size INTEGER;
ALTER TABLE attempts ADD COLUMN submission_notes TEXT;

CREATE INDEX idx_learning_resources_submission_due_at
  ON learning_resources(tenant_id, submission_due_at);
