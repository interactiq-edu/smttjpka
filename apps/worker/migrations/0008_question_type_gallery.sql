-- Expand the question catalogue while preserving existing quizzes, attempts,
-- and answers. Foreign keys are temporarily disabled because SQLite tables
-- must be rebuilt to change a CHECK constraint.
PRAGMA foreign_keys = OFF;

CREATE TABLE questions_replacement (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  question_type TEXT NOT NULL CHECK (question_type IN (
    'MULTIPLE_CHOICE', 'MULTI_SELECT', 'TRUE_FALSE', 'FILL_IN_THE_BLANKS',
    'TABLE_FILL_IN', 'OPEN_ENDED', 'PASSAGE', 'DRAG_AND_DROP', 'CATEGORIZE',
    'MATCH', 'MATCH_TABLE_GRID', 'DROPDOWN', 'REORDER', 'HOT_TEXT'
  )),
  prompt_json TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  points REAL NOT NULL DEFAULT 1 CHECK (points >= 0 AND points <= 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE quiz_questions_replacement (
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions_replacement(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (resource_id, question_id),
  UNIQUE (resource_id, position)
);

CREATE TABLE attempt_answers_replacement (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions_replacement(id) ON DELETE CASCADE,
  answer_json TEXT NOT NULL,
  is_correct INTEGER CHECK (is_correct IN (0, 1)),
  awarded_points REAL,
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attempt_id, question_id)
);

INSERT INTO questions_replacement SELECT * FROM questions;
INSERT INTO quiz_questions_replacement SELECT * FROM quiz_questions;
INSERT INTO attempt_answers_replacement SELECT * FROM attempt_answers;

DROP TABLE attempt_answers;
DROP TABLE quiz_questions;
DROP TABLE questions;
ALTER TABLE questions_replacement RENAME TO questions;
ALTER TABLE quiz_questions_replacement RENAME TO quiz_questions;
ALTER TABLE attempt_answers_replacement RENAME TO attempt_answers;

CREATE INDEX idx_questions_tenant_type ON questions(tenant_id, question_type);
CREATE INDEX idx_quiz_questions_resource_position ON quiz_questions(resource_id, position);
PRAGMA foreign_keys = ON;
