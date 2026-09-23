import type { D1Database } from '../db/types';
import { hashPbkdf2Password, randomToken, sha256, toSqliteTimestamp } from './crypto';
import { AuthError } from './service';
import { AuthRepository, type AdminRecoveryAccount, type ClaimedPasswordReset } from './repository';

export const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an authorized account exists for this email address, a password reset link has been sent.';
export const PASSWORD_RESET_INVALID_MESSAGE =
  'This password reset link is invalid or has expired. Please request a new one.';
export const PASSWORD_RESET_SUCCESS_MESSAGE =
  'Your password has been reset. Sign in again with your new password.';

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 14;
const MAX_PASSWORD_LENGTH = 1024;
const MINIMUM_REQUEST_RESPONSE_MS = 300;

export interface PasswordResetEnvironment {
  APP_ENV: 'development' | 'staging' | 'production';
  DB: D1Database;
  PBKDF2_ITERATIONS?: string;
  RATE_LIMIT_PEPPER?: string;
  ADMIN_RECOVERY_EMAILS?: string;
  RESEND_API_KEY?: string;
  PASSWORD_RESET_FROM_EMAIL?: string;
  PASSWORD_RESET_APP_URL?: string;
}

export interface PasswordResetEmailSender {
  send(input: { to: string; resetUrl: string }): Promise<void>;
}

export interface PasswordResetRepository {
  cleanupPasswordResetTokens(): Promise<void>;
  consumeRateLimit(scopeHash: string): Promise<string | null>;
  findAdminRecoveryAccount(email: string): Promise<AdminRecoveryAccount | null>;
  hasRecentPasswordReset(userId: string): Promise<boolean>;
  replacePasswordResetToken(input: { id: string; userId: string; tenantId: string; tokenHash: string; expiresAt: string }): Promise<void>;
  invalidatePasswordResetToken(tokenHash: string): Promise<void>;
  passwordResetTokenState(tokenHash: string): Promise<'EXPIRED' | 'USED' | 'INVALID'>;
  completePasswordReset(input: { tokenHash: string; passwordHash: string; passwordSalt: string; passwordIterations: number }): Promise<ClaimedPasswordReset | null>;
  writeAuditLog(input: { id: string; tenantId: string | null; actorUserId: string | null; action: string; metadata: Record<string, unknown> }): Promise<void>;
}

export interface PasswordResetRequestResult {
  message: string;
  delivery?: Promise<void>;
}

const normalizeEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
};

const parseAllowlist = (value: string | undefined): Set<string> => {
  const emails = (value ?? '').split(',').map(normalizeEmail).filter((email): email is string => Boolean(email));
  if (emails.length === 0) throw new AuthError(500, 'CONFIGURATION_ERROR', 'Password recovery configuration is unavailable.');
  return new Set(emails);
};

const configuredIterations = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '100000', 10);
  if (!Number.isSafeInteger(parsed) || parsed !== 100000) {
    throw new AuthError(500, 'CONFIGURATION_ERROR', 'Password configuration is invalid.');
  }
  return parsed;
};

const lockoutIsActive = (value: string | null): boolean =>
  Boolean(value && Date.parse(`${value.replace(' ', 'T')}Z`) > Date.now());

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const trustedResetUrl = (configuredUrl: string | undefined, token: string, environment: PasswordResetEnvironment['APP_ENV']): string => {
  if (!configuredUrl) throw new AuthError(500, 'CONFIGURATION_ERROR', 'Password recovery URL is unavailable.');
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new AuthError(500, 'CONFIGURATION_ERROR', 'Password recovery URL is invalid.');
  }
  const localDevelopment = environment !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new AuthError(500, 'CONFIGURATION_ERROR', 'Password recovery URL must use HTTPS.');
  }
  if (url.username || url.password) throw new AuthError(500, 'CONFIGURATION_ERROR', 'Password recovery URL is invalid.');
  url.search = '';
  url.hash = `/reset-password?token=${encodeURIComponent(token)}`;
  return url.toString();
};

export class ResendPasswordResetEmailSender implements PasswordResetEmailSender {
  constructor(private readonly env: PasswordResetEnvironment) {}

  async send(input: { to: string; resetUrl: string }): Promise<void> {
    if (this.env.APP_ENV !== 'production') throw new Error('Real password-reset email is disabled outside production.');
    const apiKey = this.env.RESEND_API_KEY;
    const from = this.env.PASSWORD_RESET_FROM_EMAIL;
    if (!apiKey || !from || /[\r\n]/.test(from)) throw new Error('Password-reset email provider is not configured.');
    const safeUrl = escapeHtml(input.resetUrl);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: 'Reset your InteractIQ Admin password',
        text: `A password reset was requested for your InteractIQ Admin account.\n\nReset your password: ${input.resetUrl}\n\nThis single-use link expires in 15 minutes. If you did not request it, ignore this email. Your password has not yet been changed.`,
        html: `<p>A password reset was requested for your InteractIQ Admin account.</p><p><a href="${safeUrl}">Reset your password</a></p><p>This single-use link expires in 15 minutes. If you did not request it, ignore this email. Your password has not yet been changed.</p>`,
      }),
    });
    if (!response.ok) throw new Error(`Password-reset email provider returned ${response.status}.`);
  }
}

export class PasswordResetService {
  private readonly repository: PasswordResetRepository;
  private readonly sender: PasswordResetEmailSender;

  constructor(
    private readonly env: PasswordResetEnvironment,
    dependencies: { repository?: PasswordResetRepository; sender?: PasswordResetEmailSender } = {},
  ) {
    this.repository = dependencies.repository ?? new AuthRepository(env.DB);
    this.sender = dependencies.sender ?? new ResendPasswordResetEmailSender(env);
  }

  async requestReset(body: unknown, clientIp: string): Promise<PasswordResetRequestResult> {
    const startedAt = Date.now();
    const genericResult = async (delivery?: Promise<void>): Promise<PasswordResetRequestResult> => {
      const remaining = MINIMUM_REQUEST_RESPONSE_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      return { message: PASSWORD_RESET_REQUEST_MESSAGE, delivery };
    };
    const allowlist = parseAllowlist(this.env.ADMIN_RECOVERY_EMAILS);
    // Validate the server-owned destination before looking up any account so a
    // configuration error cannot become an account-enumeration signal.
    trustedResetUrl(this.env.PASSWORD_RESET_APP_URL, 'A'.repeat(43), this.env.APP_ENV);
    const email = body && typeof body === 'object' && !Array.isArray(body)
      ? normalizeEmail((body as Record<string, unknown>).email)
      : null;
    const emailScope = email ?? 'invalid';
    const [ipLockout, emailLockout] = await Promise.all([
      this.repository.consumeRateLimit(await this.rateScope(`password-reset-request:ip:${clientIp}`)),
      this.repository.consumeRateLimit(await this.rateScope(`password-reset-request:email:${emailScope}`)),
    ]);
    if (lockoutIsActive(ipLockout) || lockoutIsActive(emailLockout)) {
      await this.safeAudit(null, null, 'auth.password_reset_rate_limited', { endpoint: 'request' });
      return genericResult();
    }

    await this.repository.cleanupPasswordResetTokens();
    if (!email || !allowlist.has(email)) return genericResult();

    const account = await this.repository.findAdminRecoveryAccount(email);
    if (!account || normalizeEmail(account.email) !== email || await this.repository.hasRecentPasswordReset(account.userId)) {
      return genericResult();
    }

    const rawToken = randomToken(RESET_TOKEN_BYTES);
    const tokenHash = await sha256(rawToken);
    const expiresAt = toSqliteTimestamp(new Date(Date.now() + RESET_TOKEN_TTL_MS));
    const resetUrl = trustedResetUrl(this.env.PASSWORD_RESET_APP_URL, rawToken, this.env.APP_ENV);
    await this.repository.replacePasswordResetToken({
      id: crypto.randomUUID(),
      userId: account.userId,
      tenantId: account.tenantId,
      tokenHash,
      expiresAt,
    });
    await this.safeAudit(account.tenantId, account.userId, 'auth.password_reset_requested', {});

    const delivery = this.deliver(account, tokenHash, resetUrl);
    return genericResult(delivery);
  }

  async confirmReset(body: unknown, clientIp: string): Promise<{ message: string }> {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const token = typeof input.token === 'string' ? input.token : '';
    const tokenForScope = token && token.length <= 256 ? token : 'invalid';
    const [ipLockout, tokenLockout] = await Promise.all([
      this.repository.consumeRateLimit(await this.rateScope(`password-reset-confirm:ip:${clientIp}`)),
      this.repository.consumeRateLimit(await this.rateScope(`password-reset-confirm:token:${await sha256(tokenForScope)}`)),
    ]);
    if (lockoutIsActive(ipLockout) || lockoutIsActive(tokenLockout)) {
      await this.safeAudit(null, null, 'auth.password_reset_rate_limited', { endpoint: 'confirm' });
      throw new AuthError(429, 'RATE_LIMITED', 'Too many reset attempts. Try again later.');
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      await this.safeAudit(null, null, 'auth.password_reset_invalid_token', { state: 'MALFORMED' });
      throw new AuthError(400, 'VALIDATION_ERROR', PASSWORD_RESET_INVALID_MESSAGE);
    }
    if (typeof input.password !== 'string' || input.password.length < MIN_PASSWORD_LENGTH || input.password.length > MAX_PASSWORD_LENGTH) {
      throw new AuthError(400, 'VALIDATION_ERROR', `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`);
    }
    if (typeof input.confirmPassword !== 'string' || input.password !== input.confirmPassword) {
      throw new AuthError(400, 'VALIDATION_ERROR', 'Password confirmation does not match.');
    }

    const iterations = configuredIterations(this.env.PBKDF2_ITERATIONS);
    const credential = await hashPbkdf2Password(input.password, iterations);
    const tokenHash = await sha256(token);
    const claimed = await this.repository.completePasswordReset({
      tokenHash,
      passwordHash: credential.hash,
      passwordSalt: credential.salt,
      passwordIterations: iterations,
    });
    if (!claimed) {
      const state = await this.repository.passwordResetTokenState(tokenHash);
      await this.safeAudit(null, null, `auth.password_reset_${state.toLowerCase()}_token`, {});
      throw new AuthError(400, 'VALIDATION_ERROR', PASSWORD_RESET_INVALID_MESSAGE);
    }
    return { message: PASSWORD_RESET_SUCCESS_MESSAGE };
  }

  private async deliver(account: AdminRecoveryAccount, tokenHash: string, resetUrl: string): Promise<void> {
    try {
      await this.sender.send({ to: account.email, resetUrl });
      await this.safeAudit(account.tenantId, account.userId, 'auth.password_reset_email_sent', {});
    } catch (error) {
      await this.repository.invalidatePasswordResetToken(tokenHash).catch(() => undefined);
      await this.safeAudit(account.tenantId, account.userId, 'auth.password_reset_email_failed', {});
      console.error('Password-reset email delivery failed', {
        name: error instanceof Error ? error.name : 'UnknownError',
        provider: 'resend',
      });
    }
  }

  private async safeAudit(tenantId: string | null, actorUserId: string | null, action: string, metadata: Record<string, unknown>): Promise<void> {
    try {
      await this.repository.writeAuditLog({ id: crypto.randomUUID(), tenantId, actorUserId, action, metadata });
    } catch {
      // Audit failure must not reveal account existence through the public response.
    }
  }

  private async rateScope(value: string): Promise<string> {
    if (!this.env.RATE_LIMIT_PEPPER || this.env.RATE_LIMIT_PEPPER.length < 32) {
      throw new AuthError(500, 'CONFIGURATION_ERROR', 'Rate limit configuration is unavailable.');
    }
    return sha256(`${this.env.RATE_LIMIT_PEPPER}:${value}`);
  }
}
