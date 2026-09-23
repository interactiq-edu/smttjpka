ALTER TABLE learning_resources ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'AURORA'
  CHECK (theme_id IN ('AURORA','OCEAN','SUNSET','FOREST','GALAXY','CANDY','NEON','PAPER','SAFARI','MIDNIGHT'));

ALTER TABLE tenant_settings ADD COLUMN default_theme TEXT NOT NULL DEFAULT 'AURORA'
  CHECK (default_theme IN ('AURORA','OCEAN','SUNSET','FOREST','GALAXY','CANDY','NEON','PAPER','SAFARI','MIDNIGHT'));

ALTER TABLE attempts ADD COLUMN student_full_name TEXT;
ALTER TABLE attempts ADD COLUMN student_class_name TEXT;

ALTER TABLE attempt_answers ADD COLUMN ai_suggested_points REAL;
ALTER TABLE attempt_answers ADD COLUMN ai_feedback TEXT;
ALTER TABLE attempt_answers ADD COLUMN teacher_points REAL;
ALTER TABLE attempt_answers ADD COLUMN teacher_feedback TEXT;
ALTER TABLE attempt_answers ADD COLUMN reviewed_at TEXT;
ALTER TABLE attempt_answers ADD COLUMN reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_attempts_resource_status ON attempts(resource_id, status, submitted_at DESC);
