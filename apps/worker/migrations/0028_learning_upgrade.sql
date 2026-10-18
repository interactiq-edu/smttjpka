-- Multi-Part: preserve all question, answer, review and AI columns.
-- Keep live-session references while rebuilding the question type constraint.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE multipart_live_backup AS SELECT resource_id, active_question_id FROM resource_live_states;
PRAGMA foreign_keys = OFF;

CREATE TABLE questions_multipart_replacement (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  question_type TEXT NOT NULL CHECK (question_type IN (
    'MULTIPLE_CHOICE', 'MULTI_SELECT', 'TRUE_FALSE', 'FILL_IN_THE_BLANKS',
    'TABLE_FILL_IN', 'OPEN_ENDED', 'PASSAGE', 'DRAG_AND_DROP', 'CATEGORIZE',
    'MATCH', 'MATCH_TABLE_GRID', 'DROPDOWN', 'REORDER', 'HOT_TEXT',
    'MATH_RESPONSE', 'LABELLING', 'HOTSPOT', 'MULTI_PART'
  )),
  prompt_json TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  points REAL NOT NULL DEFAULT 1 CHECK (points >= 0 AND points <= 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  time_limit_seconds INTEGER CHECK (time_limit_seconds IS NULL OR (time_limit_seconds >= 5 AND time_limit_seconds <= 5400))
);

CREATE TABLE quiz_questions_multipart_replacement (
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions_multipart_replacement(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (resource_id, question_id),
  UNIQUE (resource_id, position)
);

CREATE TABLE attempt_answers_multipart_replacement (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions_multipart_replacement(id) ON DELETE CASCADE,
  answer_json TEXT NOT NULL,
  is_correct INTEGER CHECK (is_correct IN (0, 1)),
  awarded_points REAL,
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ai_suggested_points REAL,
  ai_feedback TEXT,
  teacher_points REAL,
  teacher_feedback TEXT,
  reviewed_at TEXT,
  reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ai_marking_status TEXT,
  ai_provider TEXT,
  ai_error_code TEXT,
  PRIMARY KEY (attempt_id, question_id)
);

INSERT INTO questions_multipart_replacement SELECT * FROM questions;
INSERT INTO quiz_questions_multipart_replacement SELECT * FROM quiz_questions;
INSERT INTO attempt_answers_multipart_replacement SELECT * FROM attempt_answers;

DROP TABLE attempt_answers;
DROP TABLE quiz_questions;
DROP TABLE questions;
ALTER TABLE questions_multipart_replacement RENAME TO questions;
ALTER TABLE quiz_questions_multipart_replacement RENAME TO quiz_questions;
ALTER TABLE attempt_answers_multipart_replacement RENAME TO attempt_answers;

CREATE INDEX idx_questions_tenant_type ON questions(tenant_id, question_type);
CREATE INDEX idx_quiz_questions_resource_position ON quiz_questions(resource_id, position);
PRAGMA foreign_keys = ON;
CREATE INDEX idx_attempt_answers_ai_pending ON attempt_answers(ai_marking_status, attempt_id);
UPDATE resource_live_states SET active_question_id = (SELECT active_question_id FROM multipart_live_backup b WHERE b.resource_id = resource_live_states.resource_id);
DROP TABLE multipart_live_backup;
PRAGMA defer_foreign_keys = OFF;

CREATE TABLE class_rosters (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  entries_json TEXT NOT NULL DEFAULT '[]',
  excluded_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant_id,class_name)
);
CREATE TABLE study_library (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('notes','tips')),
  parent_id TEXT REFERENCES study_library(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('folder','file')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tips TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT 'books',
  published INTEGER NOT NULL DEFAULT 0,
  share_code TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_study_library_tenant_section ON study_library(tenant_id,section,parent_id);

