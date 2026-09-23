# InteractIQ — Phase 1 Foundation

This workspace is the production foundation extracted from the supplied single-file prototype. The original `interactiq_app.html` is deliberately not changed in this phase.

## Layout

- `apps/web`: React, TypeScript, and Vite application shell.
- `apps/worker`: Cloudflare Worker API boundary.
- `packages/contracts`: shared, typed API contracts.
- `tests`: contract-level checks added in later phases alongside feature work.

## Local development

```powershell
npm install
npm run dev:worker
npm run dev:web
```

The web app proxies `/api/*` to the local Worker at `http://127.0.0.1:8787`.

## Student quiz and marking flow

- Publish a quiz from Library or its editor to generate a share code and GitHub-Pages-safe link.
- Students sign in with Google, answer one question per page, confirm unanswered items, then enter their full name and class before submitting.
- Open-ended responses receive a preliminary Workers AI score. Teachers can inspect every submission under **Marking & reports** and override the mark and feedback.
- Administrators can select one of ten student themes in **Settings**; each quiz can also override its theme in the editor.

Apply every pending migration in `apps/worker/migrations` before deploying the updated Worker. The latest migration, `0024_admin_password_recovery.sql`, adds hashed, account-bound, single-use Admin password-reset tokens. See [`docs/ADMIN-PASSWORD-RECOVERY.md`](docs/ADMIN-PASSWORD-RECOVERY.md) for security controls and deployment gates.

## Production configuration

Set non-secret values in `apps/worker/wrangler.toml` and store credentials only with `wrangler secret put`. Never commit `.dev.vars`.
