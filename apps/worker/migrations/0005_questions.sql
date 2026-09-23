CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  question_type TEXT NOT NULL CHECK (question_type IN ('MULTIPLE_CHOICE', 'MULTI_SELECT', 'TRUE_FALSE', 'FILL_IN_THE_BLANKS', 'OPEN_ENDED')),
  prompt_json TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  points REAL NOT NULL DEFAULT 1 CHECK (points >= 0 AND points <= 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quiz_questions (
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (resource_id, question_id),
  UNIQUE (resource_id, position)
);

CREATE INDEX idx_questions_tenant_type ON questions(tenant_id, question_type);
CREATE INDEX idx_quiz_questions_resource_position ON quiz_questions(resource_id, position);
