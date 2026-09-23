import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement } from '../db/types';
import { hashPbkdf2Password, sha256, verifyPbkdf2Password } from './crypto';
import {
  PASSWORD_RESET_INVALID_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  PasswordResetService,
  type PasswordResetEmailSender,
  type PasswordResetEnvironment,
  type PasswordResetRepository,
} from './password-reset';
import type { AdminRecoveryAccount, ClaimedPasswordReset } from './repository';

const statement: D1PreparedStatement = {
  bind: () => statement,
  first: async () => null,
  all: async () => ({ results: [], success: true, meta: {} }),
  run: async () => ({ results: [], success: true, meta: {} }),
};
const database: D1Database = { prepare: () => statement, batch: async () => [] };

const environment = (): PasswordResetEnvironment => ({
  APP_ENV: 'development',
  DB: database,
  PBKDF2_ITERATIONS: '100000',
  RATE_LIMIT_PEPPER: 'test-rate-limit-pepper-that-is-at-least-32-characters',
  ADMIN_RECOVERY_EMAILS: 'intansafinahjhasan@gmail.com,apiz1335@gmail.com',
  PASSWORD_RESET_APP_URL: 'http://localhost:5173/',
});

interface TokenRecord {
  userId: string;
  tenantId: string;
  expiresAt: string;
  used: boolean;
}

class FakeRepository implements PasswordResetRepository {
  accounts = new Map<string, AdminRecoveryAccount>([
    ['intansafinahjhasan@gmail.com', { userId: 'admin-a', tenantId: 'tenant-a', email: 'intansafinahjhasan@gmail.com' }],
    ['apiz1335@gmail.com', { userId: 'admin-b', tenantId: 'tenant-b', email: 'apiz1335@gmail.com' }],
  ]);
  tokens = new Map<string, TokenRecord>();
  credentials = new Map<string, { hash: string; salt: string; iterations: number }>();
  sessions = new Map([['admin-a', 2], ['admin-b', 3]]);
  roles = new Map([['admin-a', 'TENANT_ADMIN'], ['admin-b', 'SUPER_ADMIN']]);
  audits: string[] = [];
  recentUsers = new Set<string>();
  locked = false;
  lastInsertedHash = '';

  async cleanupPasswordResetTokens() {}
  async consumeRateLimit() { return this.locked ? '2099-01-01 00:00:00' : null; }
  async findAdminRecoveryAccount(email: string) { return this.accounts.get(email) ?? null; }
  async hasRecentPasswordReset(userId: string) { return this.recentUsers.has(userId); }
  async replacePasswordResetToken(input: { userId: string; tenantId: string; tokenHash: string; expiresAt: string }) {
    for (const record of this.tokens.values()) if (record.userId === input.userId) record.used = true;
    this.tokens.set(input.tokenHash, { userId: input.userId, tenantId: input.tenantId, expiresAt: input.expiresAt, used: false });
    this.lastInsertedHash = input.tokenHash;
  }
  async invalidatePasswordResetToken(tokenHash: string) { const record = this.tokens.get(tokenHash); if (record) record.used = true; }
  async passwordResetTokenState(tokenHash: string) {
    const record = this.tokens.get(tokenHash);
    if (!record) return 'INVALID' as const;
    if (record.used) return 'USED' as const;
    return Date.parse(`${record.expiresAt.replace(' ', 'T')}Z`) <= Date.now() ? 'EXPIRED' as const : 'INVALID' as const;
  }
  async completePasswordReset(input: { tokenHash: string; passwordHash: string; passwordSalt: string; passwordIterations: number }): Promise<ClaimedPasswordReset | null> {
    const record = this.tokens.get(input.tokenHash);
    if (!record || record.used || Date.parse(`${record.expiresAt.replace(' ', 'T')}Z`) <= Date.now()) return null;
    record.used = true;
    this.credentials.set(record.userId, { hash: input.passwordHash, salt: input.passwordSalt, iterations: input.passwordIterations });
    this.sessions.set(record.userId, 0);
    for (const candidate of this.tokens.values()) if (candidate.userId === record.userId) candidate.used = true;
    return { userId: record.userId, tenantId: record.tenantId };
  }
  async writeAuditLog(input: { action: string }) { this.audits.push(input.action); }
}

class FakeSender implements PasswordResetEmailSender {
  deliveries: Array<{ to: string; resetUrl: string }> = [];
  async send(input: { to: string; resetUrl: string }) { this.deliveries.push(input); }
}

const create = (repository = new FakeRepository(), sender = new FakeSender()) => ({
  repository,
  sender,
  service: new PasswordResetService(environment(), { repository, sender }),
});

const requestToken = async (service: PasswordResetService, sender: FakeSender, email: string, extra: Record<string, unknown> = {}) => {
  const result = await service.requestReset({ email, ...extra }, '192.0.2.1');
  await result.delivery;
  const resetUrl = new URL(sender.deliveries.at(-1)!.resetUrl);
  return { result, token: new URLSearchParams(resetUrl.hash.split('?')[1]).get('token')! };
};

describe('Admin password recovery', () => {
  it('sends each authorized Admin reset only to the exact matching trusted account', async () => {
    const { service, sender, repository } = create();
    const first = await requestToken(service, sender, '  INTANSAFINAHJHASAN@GMAIL.COM  ', { destinationEmail: 'attacker@example.com', redirect: 'https://evil.example' });
    const second = await requestToken(service, sender, 'apiz1335@gmail.com', { sendTo: 'attacker@example.com' });

    expect(first.result.message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    expect(sender.deliveries.map((item) => item.to)).toEqual(['intansafinahjhasan@gmail.com', 'apiz1335@gmail.com']);
    expect(sender.deliveries.every((item) => item.resetUrl.startsWith('http://localhost:5173/#/reset-password?token='))).toBe(true);
    expect(repository.lastInsertedHash).not.toBe(second.token);
    expect(repository.lastInsertedHash).toBe(await sha256(second.token));
    expect(first.token).toHaveLength(43);
  });

  it('does not send for unknown, injected, SQL, or XSS email input and keeps the public response identical', async () => {
    const { service, sender } = create();
    const inputs: unknown[] = ['attacker@example.com', "' OR 1=1 --", '<img src=x onerror=alert(1)>', null];
    const messages: string[] = [];
    for (const email of inputs) messages.push((await service.requestReset({ email }, '192.0.2.2')).message);
    expect(new Set(messages)).toEqual(new Set([PASSWORD_RESET_REQUEST_MESSAGE]));
    expect(sender.deliveries).toHaveLength(0);
  });

  it('enforces inbox cooldown and request rate limits without changing the generic public response', async () => {
    const repository = new FakeRepository(); const sender = new FakeSender(); const service = create(repository, sender).service;
    repository.recentUsers.add('admin-a');
    expect((await service.requestReset({ email: 'intansafinahjhasan@gmail.com' }, '192.0.2.3')).message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    repository.recentUsers.clear(); repository.locked = true;
    expect((await service.requestReset({ email: 'intansafinahjhasan@gmail.com' }, '192.0.2.3')).message).toBe(PASSWORD_RESET_REQUEST_MESSAGE);
    expect(sender.deliveries).toHaveLength(0);
  });

  it('invalidates the token if backend email delivery fails', async () => {
    const repository = new FakeRepository();
    const sender: PasswordResetEmailSender = { send: async () => { throw new Error('mock provider failure'); } };
    const service = new PasswordResetService(environment(), { repository, sender });
    const result = await service.requestReset({ email: 'intansafinahjhasan@gmail.com' }, '192.0.2.31');
    await result.delivery;
    expect(repository.tokens.get(repository.lastInsertedHash)?.used).toBe(true);
    expect(repository.audits).toContain('auth.password_reset_email_failed');
  });

  it('binds the token to Admin A and changes only Admin A credential and sessions', async () => {
    const { service, sender, repository } = create();
    const oldA = await hashPbkdf2Password('Admin A old password', 100000);
    const oldB = await hashPbkdf2Password('Admin B old password', 100000);
    repository.credentials.set('admin-a', { ...oldA, iterations: 100000 });
    repository.credentials.set('admin-b', { ...oldB, iterations: 100000 });
    const beforeB = repository.credentials.get('admin-b');
    const { token } = await requestToken(service, sender, 'intansafinahjhasan@gmail.com');
    await service.confirmReset({ token, password: 'Admin A new secure passphrase', confirmPassword: 'Admin A new secure passphrase', email: 'apiz1335@gmail.com', userId: 'admin-b' }, '192.0.2.4');

    const afterA = repository.credentials.get('admin-a')!;
    expect(await verifyPbkdf2Password('Admin A old password', afterA.salt, afterA.iterations, afterA.hash)).toBe(false);
    expect(await verifyPbkdf2Password('Admin A new secure passphrase', afterA.salt, afterA.iterations, afterA.hash)).toBe(true);
    expect(repository.credentials.get('admin-b')).toEqual(beforeB);
    expect(repository.sessions.get('admin-a')).toBe(0);
    expect(repository.sessions.get('admin-b')).toBe(3);
    expect(repository.roles.get('admin-a')).toBe('TENANT_ADMIN');
    expect(repository.roles.get('admin-b')).toBe('SUPER_ADMIN');
  });

  it('rejects replay and allows only one of two concurrent uses', async () => {
    const { service, sender } = create();
    const { token } = await requestToken(service, sender, 'apiz1335@gmail.com');
    const input = { token, password: 'A strong concurrent password', confirmPassword: 'A strong concurrent password' };
    const results = await Promise.allSettled([service.confirmReset(input, '192.0.2.5'), service.confirmReset(input, '192.0.2.6')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await expect(service.confirmReset(input, '192.0.2.7')).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
  });

  it('rejects expired, invalid, malformed, and missing tokens', async () => {
    const { service, sender, repository } = create();
    const { token } = await requestToken(service, sender, 'intansafinahjhasan@gmail.com');
    repository.tokens.get(await sha256(token))!.expiresAt = '2000-01-01 00:00:00';
    const password = 'A strong password for tests';
    await expect(service.confirmReset({ token, password, confirmPassword: password }, '192.0.2.8')).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
    await expect(service.confirmReset({ token: 'A'.repeat(43), password, confirmPassword: password }, '192.0.2.9')).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
    await expect(service.confirmReset({ token: '<script>', password, confirmPassword: password }, '192.0.2.10')).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
    await expect(service.confirmReset({ password, confirmPassword: password }, '192.0.2.11')).rejects.toThrow(PASSWORD_RESET_INVALID_MESSAGE);
  });

  it('sets a maximum 15-minute expiry and invalidates the previous outstanding token', async () => {
    const { service, sender, repository } = create();
    const first = await requestToken(service, sender, 'intansafinahjhasan@gmail.com');
    const firstRecord = repository.tokens.get(await sha256(first.token))!;
    const expiry = Date.parse(`${firstRecord.expiresAt.replace(' ', 'T')}Z`);
    expect(expiry - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(expiry - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
    const second = await requestToken(service, sender, 'intansafinahjhasan@gmail.com');
    expect(repository.tokens.get(await sha256(first.token))!.used).toBe(true);
    expect(repository.tokens.get(await sha256(second.token))!.used).toBe(false);
  });

  it('enforces password length and confirmation on the backend', async () => {
    const { service, sender } = create(); const { token } = await requestToken(service, sender, 'apiz1335@gmail.com');
    await expect(service.confirmReset({ token, password: 'too-short', confirmPassword: 'too-short' }, '192.0.2.12')).rejects.toThrow('between 14 and 1024');
    await expect(service.confirmReset({ token, password: 'A valid long password', confirmPassword: 'A different password' }, '192.0.2.13')).rejects.toThrow('does not match');
  });

  it('rate-limits reset-token attempts before token validation', async () => {
    const repository = new FakeRepository(); repository.locked = true;
    const { service } = create(repository, new FakeSender());
    await expect(service.confirmReset({ token: 'A'.repeat(43), password: 'A valid long password', confirmPassword: 'A valid long password' }, '192.0.2.14')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });
});
