CREATE TABLE resource_classes (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  PRIMARY KEY(resource_id,class_name)
);
CREATE INDEX resource_classes_tenant ON resource_classes(tenant_id);
ALTER TABLE class_rosters ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
