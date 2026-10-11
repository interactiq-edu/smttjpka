CREATE TABLE quiz_music_tracks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_quiz_music_tracks_tenant_created
  ON quiz_music_tracks(tenant_id, created_at DESC);

ALTER TABLE learning_resources ADD COLUMN music_track_id TEXT
  REFERENCES quiz_music_tracks(id) ON DELETE SET NULL;

ALTER TABLE learning_resources ADD COLUMN replace_previous_attempts INTEGER NOT NULL DEFAULT 0
  CHECK (replace_previous_attempts IN (0, 1));
