CREATE TABLE workspace_folders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  section TEXT NOT NULL CHECK(section IN ('STUDENTS','REPORTS')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX workspace_folders_name
  ON workspace_folders(tenant_id, section, name COLLATE NOCASE);

CREATE TABLE workspace_folder_items (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('STUDENTS','REPORTS')),
  folder_id TEXT NOT NULL REFERENCES workspace_folders(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  PRIMARY KEY(tenant_id, section, resource_id)
);

CREATE INDEX workspace_folder_items_folder ON workspace_folder_items(folder_id);

CREATE TABLE planner_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('DONE','WORKING','STUCK','NOT_STARTED')),
  label TEXT,
  label_color TEXT,
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX planner_tasks_tenant_due ON planner_tasks(tenant_id, due_date, status);
