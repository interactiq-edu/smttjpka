import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@interactiq/contracts';
import { isStudentOnlyContext, requirePermission, requireTenantScope } from './authorization';

const teacher: TenantContext = { tenantId: 'tenant_a', userId: 'teacher_1', roles: ['TEACHER'] };

describe('tenant authorization boundaries', () => {
  it('permits a teacher to create a resource in their tenant', () => {
    expect(() => requirePermission(teacher, 'resource.create')).not.toThrow();
    expect(() => requireTenantScope(teacher, 'tenant_a')).not.toThrow();
  });

  it('rejects tenant escape even for a valid authenticated user', () => {
    expect(() => requireTenantScope(teacher, 'tenant_b')).toThrow('Cross-tenant access is forbidden.');
  });

  it('rejects permissions outside a teacher role', () => {
    expect(() => requirePermission(teacher, 'tenant.manage')).toThrow('You do not have permission');
  });

  it('does not apply learner-only gates to an administrator who also has a student role', () => {
    expect(isStudentOnlyContext({ roles: ['STUDENT'] })).toBe(true);
    expect(isStudentOnlyContext({ roles: ['STUDENT', 'TENANT_ADMIN'] })).toBe(false);
    expect(isStudentOnlyContext({ roles: ['STUDENT', 'TEACHER'] })).toBe(false);
  });
});
