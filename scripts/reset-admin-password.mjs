import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));

const required = (name) => {
  const value = args[name]?.trim();
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
};

const askHidden = async (label) => {
  if (!process.stdin.isTTY) throw new Error('Run this script in an interactive terminal.');
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolveAnswer) => {
    let answer = '';
    const onData = (buffer) => {
      const character = buffer.toString('utf8');
      if (character === '\r' || character === '\n') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        resolveAnswer(answer);
      } else if (character === '\u0003') process.exit(130);
      else if (character === '\u007f' || character === '\b') answer = answer.slice(0, -1);
      else answer += character;
    };
    process.stdin.on('data', onData);
  });
};

const sql = (value) => `'${value.replaceAll("'", "''")}'`;
const tenantSlug = required('tenant-slug').toLowerCase();
const username = required('username');
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenantSlug)) throw new Error('Tenant slug format is invalid.');
const password = await askHidden('New admin password: ');
const confirmation = await askHidden('Confirm new password: ');
if (password.length < 14) throw new Error('Use a password with at least 14 characters.');
if (password !== confirmation) throw new Error('Passwords do not match.');

const saltBytes = randomBytes(16);
const salt = saltBytes.toString('base64url');
// Store a transport-safe Base64URL representation, but derive with the raw
// bytes. The Worker decodes the stored value back to these same bytes.
const hash = pbkdf2Sync(password, saltBytes, 100000, 32, 'sha256').toString('base64url');
const outputPath = resolve('reset-admin-password.sql');
const statement = `UPDATE admin_users
SET password_hash = ${sql(hash)}, password_salt = ${sql(salt)}, password_iterations = 100000,
    password_changed_at = CURRENT_TIMESTAMP, failed_login_count = 0, locked_until = NULL
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = ${sql(tenantSlug)}) AND username = ${sql(username)};
SELECT changes() AS reset_rows;
`;

await writeFile(outputPath, statement, { encoding: 'utf8', mode: 0o600 });
process.stdin.pause();
console.log(`Created ${outputPath}. Apply it with: npx wrangler d1 execute interactiq --remote --file reset-admin-password.sql --config apps/worker/wrangler.toml`);
