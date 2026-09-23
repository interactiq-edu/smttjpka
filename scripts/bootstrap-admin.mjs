import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
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

const tenantName = required('tenant-name');
const tenantSlug = required('tenant-slug').toLowerCase();
const username = required('username');
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenantSlug)) throw new Error('Tenant slug must use lowercase letters, digits, and hyphens only.');
if (username.length > 128) throw new Error('Username is too long.');

const ask = async (label) => {
  process.stdout.write(label);
  process.stdin.resume();
  return await new Promise((resolveAnswer) => process.stdin.once('data', (value) => resolveAnswer(String(value).trim())));
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
      } else if (character === '\u0003') {
        process.exit(130);
      } else if (character === '\u007f' || character === '\b') {
        answer = answer.slice(0, -1);
      } else {
        answer += character;
      }
    };
    process.stdin.on('data', onData);
  });
};

const sql = (value) => `'${value.replaceAll("'", "''")}'`;
const adminEmail = await ask('Admin email: ');
if (!/^\S+@\S+\.\S+$/.test(adminEmail)) throw new Error('Enter a valid admin email.');
const password = await askHidden('Admin password: ');
const confirmPassword = await askHidden('Confirm password: ');
if (password.length < 14) throw new Error('Use a password with at least 14 characters.');
if (password !== confirmPassword) throw new Error('Passwords do not match.');

const saltBytes = randomBytes(16);
const salt = saltBytes.toString('base64url');
// Store a transport-safe Base64URL representation, but derive with the raw
// bytes. The Worker decodes the stored value back to these same bytes.
const hash = pbkdf2Sync(password, saltBytes, 100000, 32, 'sha256').toString('base64url');
const tenantId = randomUUID();
const userId = randomUUID();
const outputPath = resolve('bootstrap-admin.sql');
const statement = `INSERT INTO tenants (id, slug, name) VALUES (${sql(tenantId)}, ${sql(tenantSlug)}, ${sql(tenantName)});
INSERT INTO tenant_settings (tenant_id) VALUES (${sql(tenantId)});
INSERT INTO users (id, email, display_name) VALUES (${sql(userId)}, ${sql(adminEmail.toLowerCase())}, ${sql(username)});
INSERT INTO admin_users (user_id, tenant_id, username, password_algorithm, password_hash, password_salt, password_iterations)
VALUES (${sql(userId)}, ${sql(tenantId)}, ${sql(username)}, 'PBKDF2-HMAC-SHA-256', ${sql(hash)}, ${sql(salt)}, 100000);
INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES (${sql(userId)}, 'role_tenant_admin', ${sql(tenantId)});
`;

await writeFile(outputPath, statement, { encoding: 'utf8', mode: 0o600 });
process.stdin.pause();
console.log(`Created ${outputPath}. Apply it with: npx wrangler d1 execute interactiq --remote --file bootstrap-admin.sql`);
