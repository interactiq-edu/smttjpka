import type { AuthenticatedUser, AuthSessionData, PlatformRole } from '@interactiq/contracts';
import { TenantRepository } from '../db/tenant-repository';
import type { D1Database } from '../db/types';
import { randomToken, sha256, toSqliteTimestamp, verifyPbkdf2Password } from './crypto';
import { verifyGoogleCredential } from './google';
import { AuthRepository } from './repository';

export interface AuthEnvironment {
  DB: D1Database;
  PBKDF2_ITERATIONS?: string;
  SESSION_TTL_SECONDS?: string;
  RATE_LIMIT_PEPPER?: string;
  GOOGLE_CLIENT_ID?: string;
  DEFAULT_TENANT_SLUG?: string;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: 'VALIDATION_ERROR' | 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'RATE_LIMITED' | 'CONFIGURATION_ERROR' | 'UNAUTHENTICATED',
    message: string,
  ) {
    super(message);
  }
}

interface LoginInput {
  tenantSlug: string;
  username?: string;
  password?: string;
  credential?: string;
}

export interface IssuedSession {
  data: AuthSessionData;
  sessionToken: string;
  csrfToken: string;
}

const roleNames = new Set<PlatformRole>(['SUPER_ADMIN', 'TENANT_ADMIN', 'TEACHER', 'EDITOR', 'STUDENT']);

const requireText = (value: unknown, field: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new AuthError(400, 'VALIDATION_ERROR', `A valid ${field} is required.`);
  }
  return value.trim();
};

const parseInput = (value: unknown, defaultTenantSlug?: string): LoginInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError(400, 'VALIDATION_ERROR', 'A JSON object is required.');
  const body = value as Record<string, unknown>;
  const tenantSlug = requireText(body.tenantSlug ?? defaultTenantSlug, 'tenant slug', 63).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenantSlug)) throw new AuthError(400, 'VALIDATION_ERROR', 'Tenant slug format is invalid.');
  return { tenantSlug, username: body.username as string | undefined, password: body.password as string | undefined, credential: body.credential as string | undefined };
};

const sessionTtlSeconds = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '28800', 10);
  if (!Number.isSafeInteger(parsed) || parsed < 900 || parsed > 86400) throw new AuthError(500, 'CONFIGURATION_ERROR', 'Session configuration is invalid.');
  return parsed;
};

const passwordIterations = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '100000', 10);
  // Cloudflare Workers currently rejects PBKDF2 requests above 100,000.
  if (!Number.isSafeInteger(parsed) || parsed < 100000 || parsed > 100000) throw new AuthError(500, 'CONFIGURATION_ERROR', 'Password configuration is invalid.');
  return parsed;
};

export class AuthService {
  private readonly tenants: TenantRepository;
  private readonly auth: AuthRepository;

  constructor(private readonly env: AuthEnvironment) {
    this.tenants = new TenantRepository(env.DB);
    this.auth = new AuthRepository(env.DB);
  }

  async loginAdmin(body: unknown, clientIp: string): Promise<IssuedSession> {
    const input = parseInput(body, this.env.DEFAULT_TENANT_SLUG ?? 'interactiq-intan');
    const username = requireText(input.username, 'username', 128);
    if (typeof input.password !== 'string' || input.password.length === 0 || input.password.length > 1024) throw new AuthError(400, 'VALIDATION_ERROR', 'A valid password is required.');
    const configuredIterations = passwordIterations(this.env.PBKDF2_ITERATIONS);

    const scopeHash = await this.rateScope(`admin:${input.tenantSlug}:${username}:${clientIp}`);
    const lockedUntil = await this.auth.consumeRateLimit(scopeHash);
    if (lockedUntil && Date.parse(`${lockedUntil.replace(' ', 'T')}Z`) > Date.now()) throw new AuthError(429, 'RATE_LIMITED', 'Too many login attempts. Try again later.');

    const tenant = await this.tenants.findActiveBySlug(input.tenantSlug);
    const credential = tenant ? await this.auth.findAdminCredential(tenant.id, username) : null;
    const passwordValid = credential?.passwordAlgorithm === 'PBKDF2-HMAC-SHA-256' && credential.passwordIterations >= configuredIterations
      ? await verifyPbkdf2Password(input.password, credential.passwordSalt, credential.passwordIterations, credential.passwordHash)
      : false;
    if (!tenant || !credential || !passwordValid) {
      await this.auth.writeAuditLog({ id: crypto.randomUUID(), tenantId: tenant?.id ?? null, actorUserId: null, action: 'auth.admin_login_failed', metadata: {} });
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
    }

    const session = await this.issueSession(tenant, credential.user, credential.userId);
    await this.auth.clearRateLimit(scopeHash);
    await this.auth.writeAuditLog({ id: crypto.randomUUID(), tenantId: tenant.id, actorUserId: credential.userId, action: 'auth.admin_login_succeeded', metadata: {} });
    return session;
  }

  async loginGoogle(body: unknown, clientIp: string): Promise<IssuedSession> {
    const input = parseInput(body);
    const credential = requireText(input.credential, 'Google credential', 16384);
    if (!this.env.GOOGLE_CLIENT_ID) throw new AuthError(500, 'CONFIGURATION_ERROR', 'Google authentication is not configured.');
    const scopeHash = await this.rateScope(`google:${input.tenantSlug}:${clientIp}`);
    const lockedUntil = await this.auth.consumeRateLimit(scopeHash);
    if (lockedUntil && Date.parse(`${lockedUntil.replace(' ', 'T')}Z`) > Date.now()) throw new AuthError(429, 'RATE_LIMITED', 'Too many login attempts. Try again later.');

    let identity: { subject: string; email: string | null; displayName: string | null };
    try {
      identity = await verifyGoogleCredential(credential, this.env.GOOGLE_CLIENT_ID);
    } catch {
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid Google credential.');
    }
    const tenant = await this.tenants.findActiveBySlug(input.tenantSlug);
    if (!tenant) {
      await this.auth.writeAuditLog({ id: crypto.randomUUID(), tenantId: null, actorUserId: null, action: 'auth.google_login_failed', metadata: {} });
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'Unable to sign in.');
    }
    const user = await this.auth.ensureGoogleStudent(tenant.id, identity);

    const session = await this.issueSession(tenant, user, user.id);
    await this.auth.clearRateLimit(scopeHash);
    await this.auth.writeAuditLog({ id: crypto.randomUUID(), tenantId: tenant.id, actorUserId: user.id, action: 'auth.google_login_succeeded', metadata: {} });
    return session;
  }

  async getSession(sessionToken: string): Promise<AuthSessionData> {
    const session = await this.auth.findActiveSession(await sha256(sessionToken));
    if (!session) throw new AuthError(401, 'UNAUTHENTICATED', 'Authentication is required.');
    const roles = await this.auth.findRoles(session.user.id, session.tenant.id);
    return { user: session.user, tenant: session.tenant, roles, expiresAt: session.expiresAt.replace(' ', 'T') + 'Z' };
  }

  async renewSession(sessionToken: string): Promise<IssuedSession> {
    const current = await this.auth.findActiveSession(await sha256(sessionToken));
    if (!current) throw new AuthError(401, 'UNAUTHENTICATED', 'Authentication is required.');
    const session = await this.issueSession(current.tenant, current.user, current.user.id);
    await this.auth.writeAuditLog({
      id: crypto.randomUUID(),
      tenantId: current.tenant.id,
      actorUserId: current.user.id,
      action: 'auth.session_renewed',
      metadata: {},
    });
    return session;
  }

  async logout(sessionToken: string, csrfToken: string): Promise<void> {
    await this.requireCsrf(sessionToken, csrfToken);
    await this.auth.revokeSession(await sha256(sessionToken));
  }

  async requireCsrf(sessionToken: string, csrfToken: string): Promise<void> {
    const tokenHash = await sha256(sessionToken);
    const csrfValid = await this.auth.verifyCsrf(tokenHash, await sha256(csrfToken));
    if (!csrfValid) throw new AuthError(403, 'FORBIDDEN', 'CSRF validation failed.');
  }

  private async issueSession(tenant: { id: string; slug: string; name: string }, user: AuthenticatedUser, userId: string): Promise<IssuedSession> {
    const roles = (await this.auth.findRoles(userId, tenant.id)).filter((role) => roleNames.has(role));
    if (roles.length === 0) throw new AuthError(403, 'FORBIDDEN', 'No role is assigned for this tenant.');
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + sessionTtlSeconds(this.env.SESSION_TTL_SECONDS) * 1000);
    const expiresAtSqlite = toSqliteTimestamp(expiresAt);
    await this.auth.createSession({
      id: crypto.randomUUID(),
      userId,
      tenantId: tenant.id,
      tokenHash: await sha256(sessionToken),
      csrfTokenHash: await sha256(csrfToken),
      expiresAt: expiresAtSqlite,
    });
    return { data: { user, tenant, roles, expiresAt: expiresAt.toISOString() }, sessionToken, csrfToken };
  }

  private async rateScope(value: string): Promise<string> {
    if (!this.env.RATE_LIMIT_PEPPER || this.env.RATE_LIMIT_PEPPER.length < 32) {
      throw new AuthError(500, 'CONFIGURATION_ERROR', 'Rate limit configuration is unavailable.');
    }
    return sha256(`${this.env.RATE_LIMIT_PEPPER}:${value}`);
  }
}
