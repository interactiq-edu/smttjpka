# Phase 2 — D1 database foundation

## Objective

Introduce the source-of-truth schema for tenant identity, users, roles, sessions, and audit logs. Application resources, quiz data, attempts, and media are intentionally deferred to their respective phases.

## Migration

`apps/worker/migrations/0001_tenant_identity.sql` is non-destructive because the audited prototype has no database or existing stored data.

## Cloudflare setup

After authenticating Wrangler with the intended Cloudflare account, create the production database:

```powershell
cd apps/worker
npx wrangler d1 create interactiq
```

Add the returned database ID as a `[[d1_databases]]` binding named `DB` in `wrangler.toml`, then apply the migration:

```powershell
npx wrangler d1 migrations apply interactiq --remote
```

For local-only development, replace `--remote` with `--local`. Do not create a database binding from a user-controlled request, and do not accept a tenant ID from the frontend as an authorization decision.
