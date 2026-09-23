INSERT INTO permissions (id, name, description) VALUES
  ('permission_tenant_manage', 'tenant.manage', 'Manage tenant configuration'),
  ('permission_user_manage', 'user.manage', 'Manage tenant users and roles'),
  ('permission_resource_create', 'resource.create', 'Create tenant resources'),
  ('permission_resource_read', 'resource.read', 'Read tenant resources'),
  ('permission_resource_update', 'resource.update', 'Update tenant resources'),
  ('permission_resource_delete', 'resource.delete', 'Delete tenant resources'),
  ('permission_assignment_manage', 'assignment.manage', 'Create and manage assignments'),
  ('permission_report_read', 'report.read', 'Read tenant reports'),
  ('permission_live_manage', 'live.manage', 'Manage live sessions');

INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, permission_id FROM (
  SELECT 'role_super_admin' AS role_id, id AS permission_id FROM permissions
  UNION ALL SELECT 'role_tenant_admin', id FROM permissions
  UNION ALL SELECT 'role_teacher', id FROM permissions WHERE name IN ('resource.create', 'resource.read', 'resource.update', 'assignment.manage', 'report.read', 'live.manage')
  UNION ALL SELECT 'role_editor', id FROM permissions WHERE name IN ('resource.create', 'resource.read', 'resource.update')
  UNION ALL SELECT 'role_student', id FROM permissions WHERE name IN ('resource.read')
);
