# Security hardening record — 20 September 2026

This record follows the project rule of making the smallest necessary security change while preserving the existing learning workflow and visual design.

| File/config | Verified issue | Minimum change | Function impact | UI impact | Result |
| --- | --- | --- | --- | --- | --- |
| `apps/worker/src/index.ts` | Assignment object URLs could be read without an authenticated tenant session if the unguessable URL leaked. | Require the file owner or a teacher/admin in the same tenant before serving objects under the assignment prefix. | None for authorised users | None | PASS |
| `apps/worker/src/index.ts` | Browser hardening headers were incomplete. | Add `nosniff`, restrictive API CSP/frame policy, referrer policy and permissions policy. | None | None | PASS |
| `apps/worker/src/index.ts` | Upload checks relied primarily on filename/MIME metadata. | Verify signatures for images, PDFs, Office containers, legacy Office, RTF and DWG before storage. | Invalid or disguised files are rejected | None | PASS |
| `apps/web/src/App.tsx` | Spreadsheet software could interpret a score such as `10/19` as a date and execute formula-prefixed cells. | Export earned and maximum marks as separate columns and neutralise formula/date-like CSV cells. | Report values preserved | None | PASS |
| `apps/web/src/App.tsx` | An arbitrary URL could be placed in an interactive-video iframe. | Allow only HTTPS YouTube/YouTube No-Cookie embeds. | Unsafe/non-YouTube iframe URLs are rejected | Existing valid YouTube display unchanged | PASS |
| `apps/web/src/App.tsx` | A stale tenant-scoped student session could leave a new share link on “Opening activity”. | Bind loaded join metadata to the current code, reset stale state, require matching tenant and add a 20-second failure timeout. | Valid share links reopen normally | None | PASS |
| `apps/web/index.html` | The static application had no browser content-source restriction. | Add a CSP meta policy for the app, Google Sign-In, approved media viewers and API connections; disable object embedding and cross-origin form posts. | Approved integrations remain available | None | PASS |
| `apps/worker/src/index.ts` | Storage deletion must not accept another tenant's R2 key or traversal text. | Require admin delete permission, CSRF validation, the authenticated tenant prefix, and reject `..` before deleting. | Authorised tenant files can still be deleted | Confirmation remains required | PASS |
| `apps/worker/package.json` | The test-only Vitest dependency pulled a moderate-severity vulnerable mocker package. | Upgrade Vitest and its mocker dependency to `5.0.1`, then rerun the full test suite. | Production runtime unchanged | None | PASS |

Regression verification completed:

- 48 automated tests passed.
- TypeScript checks passed for web, Worker and contracts.
- Production web build passed.
- Online production and development dependency audit reported 0 known vulnerabilities.
- Browser checks loaded two different share codes successfully with the local API.
- Anonymous assignment-file access returned HTTP 401.
