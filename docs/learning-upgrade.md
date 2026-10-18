# Learning upgrade

## Admin workflow

- **Multi-Part**: choose the type in Quiz builder, enter the shared prompt, then choose each part's type and marks. Start with two parts; Add Part supports up to 20. Nested Multi-Part questions are intentionally excluded. Math Response keeps its existing rubric tools. The total is calculated from the parts on the server.
- **Students → resource → class → Student List**: edit Name and Email, paste tab-separated rows from Excel/Sheets, or create a class before anyone submits. Save list persists the roster for reuse across resources. Identity matching prefers email; ambiguous same-name students are not silently merged. Previously unknown submitters have a NEW badge until the roster is saved.
- **Ribbon / context menu**: cut, copy, paste, clear cells, delete selected rows, add rows, undo/redo, and font size. Shift-click selects editable cell ranges. This is a focused roster spreadsheet, not a complete Microsoft Excel implementation (no formulas, merged cells or workbook macros).
- **Results**: each attempt has marks and percentage columns. Missing submissions are red with blank scores. AI-pending results remain pending rather than appearing as a final zero. Student result percentages follow the existing release policy.
- **Exports**: PNG and PDF offer Full Result or The Latest Attempt. Wide/long results are split into pages, repeating student identity; PNG downloads one image per page. Browser multiple-download permission may be needed for several PNG pages.
- **Assigned class**: select a class suggestion or type a new class. New assignments appear in Students without needing to create a roster first.
- **Notes Library / Exam tips**: add folders, nested folders, materials, descriptions and covers. Exam tips also supports a tips text box. Choose from ten animated education covers or upload an image. Publish a folder to publish its current descendants; new additions remain draft until published. Share opens a public, login-free student library. Unpublishing closes the library links; it does not revoke direct URLs for already downloaded/public storage files.
- **Files and links**: PDF, common Office documents and images use existing storage. Approved HTTPS providers include YouTube, Canva, Google, Microsoft, Wikipedia, Khan Academy, GeoGebra and Desmos. This is an allowlist, not a claim that Cloudflare has scanned each external link. Students see PDFs/images inline where supported; Office files and external links open in their original viewer.

## Validation and deployment

Migration `0028_learning_upgrade.sql` adds Multi-Part, rosters and study libraries. It preserves existing question/answer/review data and restores live question references during the table rebuild. Back up D1 before applying it; deploy the Worker before the frontend.

Run `npm run typecheck`, `npm test`, and `npm run build` from the repository root.

The disposable local QA API is in `apps/worker/test/preview-upgrade.ts`. It uses an in-memory SQLite database and synthetic users, never production data. Node 24 is used for local SQLite integration tests. From `apps/worker`:

```powershell
npx esbuild test/preview-upgrade.ts --bundle --platform=node --format=esm --outfile=.wrangler/upgrade-preview.mjs
node .wrangler/upgrade-preview.mjs
```

The QA API listens only on `127.0.0.1:8788`; configure the Vite proxy to this address and use port 5176. Never deploy the QA entry point. Uploaded files and paid AI calls are intentionally not enabled there.

To verify a D1 export against the migration without changing the export or live database, run from `apps/worker`:

```powershell
node test/validate-learning-migration.mjs .wrangler/your-private-backup.sql
```

Keep backups under ignored `.wrangler/`; never commit them.
