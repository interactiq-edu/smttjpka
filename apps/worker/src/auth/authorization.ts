import type { Permission, PlatformRole, TenantContext } from '@interactiq/contracts';
import { AuthError } from './service';

const permissionRoles: Record<Permission, PlatformRole[]> = {
  'tenant.manage': ['SUPER_ADMIN', 'TENANT_ADMIN'],
  'user.manage': ['SUPER_ADMIN', 'TENANT_ADMIN'],
  'resource.create': ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEACHER', 'EDITOR'],
  'resource.read': ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEACHER', 'EDITOR', 'STUDENT'],
  'resource.update': ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEACHER', 'EDITOR'],
  'resource.delete': ['SUPER_ADMIN', 'TENANT_ADMIN'],
  'assignment.manage': ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEACHER'],
  'report.read': ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEACHER'],
  'live.manage': ['SUPER_ADMIN', 'TENANT_ADMIN', 'TEACHER'],
};

export const toTenantContext = (session: { tenant: { id: string }; user: { id: string }; roles: PlatformRole[] }): TenantContext => ({
  tenantId: session.tenant.id,
  userId: session.user.id,
  roles: session.roles,
});

export const requirePermission = (context: TenantContext, permission: Permission): void => {
  if (!context.roles.some((role) => permissionRoles[permission].includes(role))) {
    throw new AuthError(403, 'FORBIDDEN', 'You do not have permission for this action.');
  }
};

export const requireTenantScope = (context: TenantContext, resourceTenantId: string): void => {
  if (context.tenantId !== resourceTenantId) {
    throw new AuthError(403, 'FORBIDDEN', 'Cross-tenant access is forbidden.');
  }
};
