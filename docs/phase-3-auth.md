# Phase 3 — Authentication

## Added endpoints

- `POST /api/v1/auth/admin/login`
- `POST /api/v1/auth/google/login`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/logout`

Admin login receives `tenantSlug`, `username`, and `password`. Google login receives `tenantSlug` and the Google Identity Services `credential`. Both return a CSRF token in the response body and set an HttpOnly session cookie.

## Required secrets

```powershell
npx wrangler secret put RATE_LIMIT_PEPPER
npx wrangler secret put GOOGLE_CLIENT_ID
```

Students who enter through a valid, published tenant link are provisioned automatically after Google verifies their identity. The Worker assigns only the `STUDENT` role; it never grants teacher or administrator access.

## Apply the migration

```powershell
npx wrangler d1 migrations apply interactiq --local
```

Use `--remote` only when you approve creating `auth_rate_limits` in the production D1 database.
