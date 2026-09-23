# InteractIQ Admin Password Recovery

## Scope and architecture found

InteractIQ uses a React/Vite frontend, a Cloudflare Worker API, Cloudflare D1 for identity and session data, and R2 for uploaded learning files. Admin credentials are stored in `admin_users`; identity, status, roles, and tenant membership are stored in `users`, `user_roles`, `roles`, and `tenants`. Admin passwords use PBKDF2-HMAC-SHA-256 with a random 16-byte salt and the Cloudflare Web Crypto maximum of 100,000 iterations. Session and CSRF tokens are cryptographically random and only their SHA-256 hashes are stored in D1. There is no refresh-token, remember-me-token, MFA, or pre-existing email-provider implementation.

Password recovery is integrated into that existing model. It does not use R2 and does not create a second authentication system.

## Admin account source of truth

The Worker requires both conditions before issuing a reset token:

1. The normalized address is in the server-only `ADMIN_RECOVERY_EMAILS` Cloudflare secret.
2. D1 contains a matching active user, an active tenant, an `admin_users` credential, and a `SUPER_ADMIN` or `TENANT_ADMIN` role for that user and tenant.

The email destination is read from the matching D1 user record. Browser fields such as `destinationEmail`, `sendTo`, `userId`, `redirect`, or `returnUrl` are not used. The allowlist is never sent to the frontend.

Local D1 inspection on 21 September 2026 found one active recovery-eligible account, `intansafinahjhasan@gmail.com` (`TENANT_ADMIN`). The second approved identity, `apiz1335@gmail.com`, was not present in the local D1 snapshot. It must exist as its own active D1 Admin/Super Admin account before its production recovery acceptance test can pass. Remote D1 was not inspected because a Cloudflare API token was not available in this terminal.

## User flow

1. Select **Forgot Password?** on the existing Admin login card.
2. Enter the Admin account email.
3. The browser sends JSON to `POST /api/v1/auth/password-reset/request`.
4. The Worker normalizes the email, applies IP and email-scoped rate limits, checks the server allowlist and active D1 Admin record, invalidates earlier unused tokens, and creates a new 256-bit token.
5. Only the SHA-256 token hash is stored in D1. The raw token appears only in the email URL.
6. Resend sends the link to the email from the trusted D1 record. The public API response is identical for allowlisted and unknown addresses.
7. The link opens `#/reset-password?token=...`. Using a URL fragment prevents the token from being sent to GitHub Pages in the HTTP request or Referer. The frontend does not put the token in local or session storage.
8. `POST /api/v1/auth/password-reset/confirm` validates the password and submits one conditional D1 batch for the unused, unexpired, account-bound token.
9. In that transaction the Worker replaces only that account's credential, revokes only that account's sessions, writes the completion audits, and marks the token plus that account's remaining reset tokens used as the final statement. Any batch failure rolls back the whole reset.
10. The browser clears its local auth state and returns to Admin login.

## D1 migration

Migration: `apps/worker/migrations/0024_admin_password_recovery.sql`

It adds `password_reset_tokens` with:

- `id` primary key;
- `user_id` and `tenant_id` foreign keys;
- a unique `token_hash` (the raw token is never stored);
- `created_at`, `expires_at`, and nullable `used_at`;
- indexes for active user tokens and expired/used-token cleanup.

Expired or used rows older than one day are deleted opportunistically on reset requests. Expiration and unused state are enforced by the conditional password-update transaction, so cleanup timing never extends validity.

## API endpoints

### `POST /api/v1/auth/password-reset/request`

JSON body:

```json
{ "email": "admin@example.com" }
```

Returns HTTP 202 and the same generic message whether the account is valid, unknown, in cooldown, or request-rate-limited. It requires an exact configured browser `Origin` and `Content-Type: application/json`.

### `POST /api/v1/auth/password-reset/confirm`

JSON body:

```json
{
  "token": "raw-token-from-link",
  "password": "a new long passphrase",
  "confirmPassword": "a new long passphrase"
}
```

The backend requires matching values and 14–1024 characters. It accepts only the 43-character Base64URL representation of a 32-byte token, rate-limits by Cloudflare source IP and a peppered token scope, and returns a generic invalid/expired response for malformed, missing, expired, unknown, or used tokens.

## Email provider and Cloudflare configuration

The smallest backend-only integration uses Resend's HTTPS API. No email credential is present in frontend JavaScript or source control. Configure and verify the sender/domain in Resend before production testing.

Required Worker secret names:

- `ADMIN_RECOVERY_EMAILS`
- `RESEND_API_KEY`
- `PASSWORD_RESET_FROM_EMAIL`
- `PASSWORD_RESET_APP_URL`
- `RATE_LIMIT_PEPPER` (already required by login and recovery)

Existing secrets such as `GOOGLE_CLIENT_ID` remain unchanged. `PASSWORD_RESET_APP_URL` must be the trusted InteractIQ frontend base URL, for example the deployed GitHub Pages project root. Production requires HTTPS. `ADMIN_RECOVERY_EMAILS` must contain only the two approved addresses, comma-separated.

Real password-reset email is deliberately disabled when `APP_ENV` is not `production`. Automated tests inject a mock sender.

## Security controls

- 32 random bytes (256 bits) from Web Crypto for every token.
- SHA-256-only token storage and unique token-hash index.
- Token bound in D1 to an internal user and tenant; final reset ignores browser-supplied account identifiers.
- 15-minute backend-enforced expiry.
- A conditional D1 transaction performs credential rotation, session revocation, audits, and final token consumption together. `UPDATE ... RETURNING` reports whether the reset won, preventing replay and concurrent double use without consuming the token before a successful batch.
- A newer token invalidates previous outstanding tokens for that account.
- Five-minute per-account email cooldown plus existing 15-minute D1 rate-limit windows for IP/email/token scopes.
- Generic status/body, a minimum response window, and background email delivery reduce direct account-enumeration timing differences.
- D1 prepared statements for all email, token, account, session, and password-reset operations.
- Existing PBKDF2 credential format retained; password is never trimmed, truncated, logged, emailed, or stored in plaintext.
- Only the affected account's D1 sessions are revoked. Roles, permissions, account status, tenant ownership, and the other Admin credential are not updated.
- JSON-only POST operations plus exact first-party Origin checks provide CSRF protection for these unauthenticated credential endpoints.
- No open-redirect/return URL input. The reset destination is built only from server configuration.
- React text rendering is used for messages and input; no unsafe HTML insertion was added.
- The reset token remains in the hash route and in memory only. Worker responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- Audit events cover requested, sent, delivery failed, invalid/expired/used attempts, rate limiting, completion, and session revocation. Passwords, raw tokens, hashes, and provider credentials are excluded.
- Delivery failure invalidates the new token and does not change any password.
- Existing CORS, CSP, cookie flags, RBAC, D1/R2 bindings, and application routes remain intact.

There is currently no MFA/2FA implementation to preserve. Adding MFA can be considered separately after this release.

## Tests

The password-recovery tests cover both approved identities, case/whitespace normalization, generic unknown-address behavior, destination manipulation, SQL/XSS input, trusted reset URL, raw-token hashing, 256-bit token length, 15-minute expiry, newer-token invalidation, email failure, cooldown, request/confirm rate limiting, account isolation, session isolation, role preservation, old/new password verification, malformed/missing/invalid/expired/used tokens, replay, concurrent token use, weak passwords, confirmation mismatch, Origin enforcement, and indistinguishable endpoint responses.

Final local verification on 21 September 2026: 9 test files and 64 tests passed, all workspace TypeScript checks passed, the frontend production build passed, the four password-reset transaction statements were parsed successfully against the migrated local D1 schema, and `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities.

Run:

```powershell
npm run typecheck
npm test
npm run build
```

No automated test sends a real email. A controlled production smoke test is still required for each of the two Admin inboxes after D1 provisioning and Resend secrets are complete.

## Deployment order

Do not deploy out of order. The Worker code requires migration 0024.

1. Confirm both approved addresses exist as separate active D1 Admin/Super Admin accounts. Do not share a user ID or credential.
2. Apply the D1 migration:

   ```powershell
   npx wrangler d1 migrations apply interactiq --remote --config apps/worker/wrangler.toml
   ```

3. Set each secret interactively (never paste values into a committed file):

   ```powershell
   cd apps/worker
   npx wrangler secret put ADMIN_RECOVERY_EMAILS
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put PASSWORD_RESET_FROM_EMAIL
   npx wrangler secret put PASSWORD_RESET_APP_URL
   npx wrangler secret put RATE_LIMIT_PEPPER
   ```

4. Deploy the Worker:

   ```powershell
   npx wrangler deploy --config apps/worker/wrangler.toml
   ```

5. Build and publish the frontend using the existing GitHub Pages process:

   ```powershell
   npm run build --workspace=@interactiq/web
   ```

6. Test an unknown email first and confirm no email is sent. Then perform one controlled reset for each approved Admin, verify old-password rejection, new-password login, affected-session revocation, other-Admin session continuity, and unchanged roles.

## Rollback

1. Stop further recovery requests by rolling the Worker back to the previous version.
2. Roll the frontend back to the matching previous build.
3. Do not roll back password changes already completed; they are real credential rotations. Use the approved password-reset/bootstrap tooling if account recovery is required.
4. Migration 0024 is additive and can safely remain while the old Worker runs. Prefer leaving it in place. Drop the table only during a separately reviewed maintenance change after confirming no deployed Worker references it.
5. Do not remove or rotate unrelated D1/R2/authentication configuration during this rollback.

## Remaining risks and production gates

- Production delivery has not been tested because Resend secrets and a verified sender were not available locally.
- The remote D1 account state was not verified from this terminal.
- The local D1 snapshot lacks the second approved Admin account, so both-account production acceptance is not yet demonstrated.
- PBKDF2 uses 100,000 iterations because that is the current Cloudflare Workers Web Crypto limit and the existing credential format. A future versioned migration to a memory-hard KDF should be evaluated only if Cloudflare runtime support and a non-breaking account migration plan are available.
- Rate limiting is D1-backed and application-level. A Cloudflare WAF/rate-limiting rule in front of these two endpoints is recommended as additional defense in depth.
- MFA is not currently implemented.

These controls reduce the reviewed risks; they are not a claim of absolute security.
