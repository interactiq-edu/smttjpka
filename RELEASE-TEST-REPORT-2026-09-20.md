# InteractIQ release verification — 21 September 2026

## Deployment status

- Cloudflare D1 migrations `0015` through `0021`: applied successfully.
- Cloudflare Worker: deployed successfully.
- Worker version: `766c2136-e3b0-4239-a6af-0aea67b3d535`.
- Frontend production bundle: built successfully for `/smttjpka/`.
- GitHub Pages frontend: not published yet; it will become live after the planned GitHub push.

## Automated checks

- Unit tests: 49 passed, 0 failed.
- TypeScript type checking: passed for web, Worker, and contracts.
- Production web build: passed.
- Remote migration status: no pending migrations.

## Production smoke and security checks

- Worker health endpoint: healthy.
- Three published resource-info endpoints (presentation, flashcards, and quiz): returned HTTP 200 from the production Worker.
- Local student routes for published Interactive Video and Quiz resources: displayed the Google sign-in screen with service status `available`.
- GitHub Pages URL currently returns 404 because the frontend has not yet been pushed/published.
- Unauthenticated report and storage-inventory requests: rejected with HTTP 401.
- Approved GitHub Pages origin: received the configured CORS permission.
- Unapproved external origin: received no CORS permission.
- D1 integrity checks: no duplicate share codes and no orphan attempts, answers, quiz links, or live states.
- Report-query schema check: passed against the production D1 schema.
- Resource deletion now reads the valid `configuration_json` question field, including embedded-media cleanup.
- Per-participant drawing permission is stored in D1; non-selected students are rejected server-side.
- Admin login rate limiting locks after five attempts in 15 minutes and returns HTTP 429 with `Retry-After: 900`.
- Explicit logout no longer restores the HttpOnly session into the dashboard in the same browser tab.

## Lightweight concurrency check

- 150 simultaneous public activity-info requests.
- Result: 150 passed, 0 failed.
- HTTP status: 150 × 200.
- Observed latency: p50 790 ms, p95 1,191 ms, p99 1,227 ms.
- Total wall time for the burst: 1,537 ms.

This is a targeted readiness check, not a full sustained-load or soak test. It provides evidence that the public join endpoint handles a classroom-sized burst without errors.
