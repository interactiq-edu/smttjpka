# Phase 4 — Multi-tenancy and RBAC

All future tenant-owned repositories must accept a server-derived `TenantContext`, call `requirePermission`, and scope each query with `tenant_id = context.tenantId`. Request bodies, URL parameters, query strings, and headers must never determine tenant authorization.

## Bootstrap is intentionally not automated

Creating the first tenant and administrator requires user-chosen values: tenant name/slug and a private admin username/password. These are not inferred by the application. Once supplied, the bootstrap will create the tenant, PBKDF2 credential, and role assignment in one D1 transaction.

## Apply the migration

```powershell
npx wrangler d1 migrations apply interactiq --remote
```
