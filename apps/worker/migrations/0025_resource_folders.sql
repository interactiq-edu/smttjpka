CREATE TABLE resource_folders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_resource_folders_tenant_name
  ON resource_folders(tenant_id, name COLLATE NOCASE);

ALTER TABLE learning_resources ADD COLUMN folder_id TEXT REFERENCES resource_folders(id) ON DELETE SET NULL;

CREATE INDEX idx_learning_resources_folder
  ON learning_resources(tenant_id, folder_id, updated_at DESC);
