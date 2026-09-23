# Phase 5 — Web deployment preparation

The browser application now supports a separate API origin. Local development keeps the relative `/api` URL, which Vite proxies to the local Worker.

For a hosted web application, set the build-time environment variable below in the chosen host:

```text
VITE_API_BASE_URL=https://interactiq-api.apiz1335.workers.dev
VITE_GOOGLE_CLIENT_ID=replace-with-your-google-oauth-client-id.apps.googleusercontent.com
VITE_BASE_PATH=/smttjpka/
```

`VITE_BASE_PATH` is the GitHub repository path. Keep the leading and trailing slash. Shared student URLs use hash routing (`#/join/CODE`), so opening a link directly works on GitHub Pages without a custom 404 page.

Before publishing the web site, update the Worker configuration so `ALLOWED_ORIGIN` is the exact final HTTPS site origin (for example `https://interactiq-edu.github.io`), change `APP_ENV` to `production`, and redeploy the Worker. Add that same final web origin and the local development origin to the Google OAuth client's authorised JavaScript origins.

Apply the latest D1 migration before deploying the upgraded Worker:

```powershell
cd apps\worker
npx wrangler d1 migrations apply interactiq --remote
npx wrangler deploy
```

Do not use a wildcard origin and do not place Worker secrets in the web build environment.
