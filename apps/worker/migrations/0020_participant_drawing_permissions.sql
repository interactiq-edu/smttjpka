CREATE TABLE live_drawing_permissions (
  resource_id TEXT NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resource_id, attempt_id)
);

CREATE INDEX idx_live_drawing_permissions_tenant_resource
  ON live_drawing_permissions(tenant_id, resource_id);

-- Drawing access is now granted per participant instead of globally.
UPDATE resource_live_states SET allow_student_draw = 0;
