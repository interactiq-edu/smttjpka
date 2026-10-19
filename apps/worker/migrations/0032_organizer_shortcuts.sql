CREATE TABLE workspace_folder_items_next (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('STUDENTS','REPORTS')),
  folder_id TEXT NOT NULL REFERENCES workspace_folders(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  PRIMARY KEY(tenant_id, section, folder_id, resource_id)
);

INSERT OR IGNORE INTO workspace_folder_items_next(tenant_id,section,folder_id,resource_id)
SELECT tenant_id,section,folder_id,resource_id FROM workspace_folder_items;

DROP TABLE workspace_folder_items;
ALTER TABLE workspace_folder_items_next RENAME TO workspace_folder_items;
CREATE INDEX workspace_folder_items_folder ON workspace_folder_items(folder_id);
CREATE INDEX workspace_folder_items_resource ON workspace_folder_items(tenant_id,section,resource_id);
