ALTER TABLE learning_resources ADD COLUMN asset_url TEXT;
ALTER TABLE learning_resources ADD COLUMN external_url TEXT;

CREATE TABLE flashcards (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  front_json TEXT NOT NULL,
  back_json TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_id, position)
);

CREATE INDEX idx_flashcards_resource_position ON flashcards(resource_id, position);

CREATE TABLE resource_live_states (
  resource_id TEXT PRIMARY KEY REFERENCES learning_resources(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_slide INTEGER NOT NULL DEFAULT 1 CHECK (current_slide >= 1),
  active_question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
  whiteboard_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
