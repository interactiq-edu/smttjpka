CREATE TABLE learning_resources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('QUIZ', 'ASSESSMENT', 'FLASHCARD_SET', 'PRESENTATION', 'PASSAGE', 'INTERACTIVE_VIDEO')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'TENANT', 'PUBLIC')),
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_learning_resources_tenant_updated
  ON learning_resources(tenant_id, updated_at DESC);

CREATE INDEX idx_learning_resources_tenant_status
  ON learning_resources(tenant_id, status);
