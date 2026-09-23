# Bootstrap the first InteractIQ tenant

Run this from `outputs/interactiq-phase-1` in Command Prompt:

```cmd
node scripts\bootstrap-admin.mjs --tenant-name="InteractIQ" --tenant-slug="interactiq-intan" --username="Intansafina87"
```

Enter the admin email and password only in the terminal. The script creates `bootstrap-admin.sql` with a random salt and PBKDF2-HMAC-SHA-256 hash; it never writes plaintext passwords.

Review the generated SQL file, then run:

```cmd
cd apps\worker
npx wrangler d1 execute interactiq --remote --file ..\..\bootstrap-admin.sql
```

Delete `bootstrap-admin.sql` from the terminal after successful execution because it contains a password hash and user identifiers.
