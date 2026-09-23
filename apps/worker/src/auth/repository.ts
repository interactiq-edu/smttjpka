import type { AuthenticatedUser, PlatformRole, Tenant } from '@interactiq/contracts';
import type { D1Database } from '../db/types';

export interface AdminCredential {
  userId: string;
  passwordAlgorithm: 'PBKDF2-HMAC-SHA-256';
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  user: AuthenticatedUser;
}

interface AdminCredentialRow {
  userId: string;
  passwordAlgorithm: 'PBKDF2-HMAC-SHA-256';
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface ActiveSession {
  id: string;
  tenant: Pick<Tenant, 'id' | 'slug' | 'name'>;
  user: AuthenticatedUser;
  expiresAt: string;
}

export interface AdminRecoveryAccount {
  userId: string;
  tenantId: string;
  email: string;
}

export interface ClaimedPasswordReset {
  userId: string;
  tenantId: string;
}

export class AuthRepository {
  constructor(private readonly db: D1Database) {}

  async findAdminCredential(tenantId: string, username: string): Promise<AdminCredential | null> {
    const row = await this.db
      .prepare(
        `SELECT au.user_id AS userId, au.password_algorithm AS passwordAlgorithm, au.password_hash AS passwordHash,
                au.password_salt AS passwordSalt, au.password_iterations AS passwordIterations,
                u.id AS id, u.email AS email, u.display_name AS displayName
         FROM admin_users au JOIN users u ON u.id = au.user_id
         WHERE au.tenant_id = ? AND au.username = ? AND u.status = 'active' AND (au.locked_until IS NULL OR au.locked_until <= CURRENT_TIMESTAMP)
         LIMIT 1`,
      )
      .bind(tenantId, username)
      .first<AdminCredentialRow>();
    return row
      ? {
          userId: row.userId,
          passwordAlgorithm: row.passwordAlgorithm,
          passwordHash: row.passwordHash,
          passwordSalt: row.passwordSalt,
          passwordIterations: row.passwordIterations,
          user: { id: row.id, email: row.email, displayName: row.displayName },
        }
      : null;
  }

  async findAdminRecoveryAccount(email: string): Promise<AdminRecoveryAccount | null> {
    return this.db.prepare(
      `SELECT DISTINCT u.id AS userId, au.tenant_id AS tenantId, u.email AS email
       FROM users u
       JOIN admin_users au ON au.user_id = u.id
       JOIN tenants t ON t.id = au.tenant_id
       JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = au.tenant_id
       JOIN roles r ON r.id = ur.role_id
       WHERE lower(u.email) = ? AND u.status = 'active' AND t.status = 'active'
         AND r.name IN ('SUPER_ADMIN', 'TENANT_ADMIN')
       LIMIT 1`,
    ).bind(email).first<AdminRecoveryAccount>();
  }

  async cleanupPasswordResetTokens(): Promise<void> {
    await this.db.prepare(
      `DELETE FROM password_reset_tokens
       WHERE expires_at <= datetime('now', '-1 day')
          OR (used_at IS NOT NULL AND used_at <= datetime('now', '-1 day'))`,
    ).run();
  }

  async hasRecentPasswordReset(userId: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT id FROM password_reset_tokens
       WHERE user_id = ? AND created_at > datetime('now', '-5 minutes')
       LIMIT 1`,
    ).bind(userId).first<{ id: string }>();
    return row !== null;
  }

  async replacePasswordResetToken(input: { id: string; userId: string; tenantId: string; tokenHash: string; expiresAt: string }): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND used_at IS NULL`,
      ).bind(input.userId),
      this.db.prepare(
        `INSERT INTO password_reset_tokens (id, user_id, tenant_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(input.id, input.userId, input.tenantId, input.tokenHash, input.expiresAt),
    ]);
  }

  async invalidatePasswordResetToken(tokenHash: string): Promise<void> {
    await this.db.prepare(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND used_at IS NULL',
    ).bind(tokenHash).run();
  }

  async passwordResetTokenState(tokenHash: string): Promise<'EXPIRED' | 'USED' | 'INVALID'> {
    const row = await this.db.prepare(
      `SELECT used_at AS usedAt, expires_at AS expiresAt
       FROM password_reset_tokens WHERE token_hash = ? LIMIT 1`,
    ).bind(tokenHash).first<{ usedAt: string | null; expiresAt: string }>();
    if (!row) return 'INVALID';
    if (row.usedAt) return 'USED';
    return Date.parse(`${row.expiresAt.replace(' ', 'T')}Z`) <= Date.now() ? 'EXPIRED' : 'INVALID';
  }

  async completePasswordReset(input: { tokenHash: string; passwordHash: string; passwordSalt: string; passwordIterations: number }): Promise<ClaimedPasswordReset | null> {
    const tokenIsUsable = `prt.token_hash = ? AND prt.used_at IS NULL AND prt.expires_at > CURRENT_TIMESTAMP`;
    const results = await this.db.batch<ClaimedPasswordReset>([
      this.db.prepare(
        `UPDATE admin_users
         SET password_hash = ?, password_salt = ?, password_iterations = ?, password_changed_at = CURRENT_TIMESTAMP,
             failed_login_count = 0, locked_until = NULL
         WHERE EXISTS (
           SELECT 1 FROM password_reset_tokens prt
           JOIN users u ON u.id = prt.user_id
           JOIN tenants t ON t.id = prt.tenant_id
           JOIN user_roles ur ON ur.user_id = prt.user_id AND ur.tenant_id = prt.tenant_id
           JOIN roles r ON r.id = ur.role_id
           WHERE ${tokenIsUsable} AND prt.user_id = admin_users.user_id AND prt.tenant_id = admin_users.tenant_id
             AND u.status = 'active' AND t.status = 'active' AND r.name IN ('SUPER_ADMIN', 'TENANT_ADMIN')
         )
         RETURNING user_id AS userId, tenant_id AS tenantId`,
      ).bind(input.passwordHash, input.passwordSalt, input.passwordIterations, input.tokenHash),
      this.db.prepare(
        `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP
         WHERE revoked_at IS NULL AND EXISTS (
           SELECT 1 FROM password_reset_tokens prt
           WHERE ${tokenIsUsable} AND prt.user_id = sessions.user_id AND prt.tenant_id = sessions.tenant_id
         )`,
      ).bind(input.tokenHash),
      this.db.prepare(
        `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, metadata_json)
         SELECT ?, prt.tenant_id, prt.user_id, 'auth.password_reset_completed', 'auth', '{}'
         FROM password_reset_tokens prt WHERE ${tokenIsUsable}`,
      ).bind(crypto.randomUUID(), input.tokenHash),
      this.db.prepare(
        `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, metadata_json)
         SELECT ?, prt.tenant_id, prt.user_id, 'auth.sessions_revoked_after_password_reset', 'auth', '{}'
         FROM password_reset_tokens prt WHERE ${tokenIsUsable}`,
      ).bind(crypto.randomUUID(), input.tokenHash),
      this.db.prepare(
        `UPDATE password_reset_tokens SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP)
         WHERE user_id = (
           SELECT prt.user_id FROM password_reset_tokens prt WHERE ${tokenIsUsable}
         ) AND tenant_id = (
           SELECT prt.tenant_id FROM password_reset_tokens prt WHERE ${tokenIsUsable}
         )`,
      ).bind(input.tokenHash, input.tokenHash),
    ]);
    return results[0]?.results[0] ?? null;
  }

  async findUserByGoogleSub(googleSub: string): Promise<AuthenticatedUser | null> {
    return this.db
      .prepare("SELECT id, email, display_name AS displayName FROM users WHERE google_sub = ? AND status = 'active' LIMIT 1")
      .bind(googleSub)
      .first<AuthenticatedUser>();
  }

  async ensureGoogleStudent(tenantId: string, identity: { subject: string; email: string | null; displayName: string | null }): Promise<AuthenticatedUser> {
    let user = await this.findUserByGoogleSub(identity.subject);
    if (!user && identity.email) {
      user = await this.db.prepare("SELECT id, email, display_name AS displayName FROM users WHERE email = ? AND status = 'active' LIMIT 1")
        .bind(identity.email).first<AuthenticatedUser>();
      if (user) await this.db.prepare('UPDATE users SET google_sub = ?, display_name = COALESCE(display_name, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(identity.subject, identity.displayName, user.id).run();
    }
    if (!user) {
      const id = crypto.randomUUID();
      await this.db.prepare('INSERT INTO users (id, google_sub, email, display_name) VALUES (?, ?, ?, ?)')
        .bind(id, identity.subject, identity.email, identity.displayName).run();
      user = { id, email: identity.email, displayName: identity.displayName };
    }
    await this.db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role_id, tenant_id) VALUES (?, 'role_student', ?)`)
      .bind(user.id, tenantId).run();
    return user;
  }

  async findRoles(userId: string, tenantId: string): Promise<PlatformRole[]> {
    const result = await this.db
      .prepare('SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND ur.tenant_id = ?')
      .bind(userId, tenantId)
      .all<{ name: PlatformRole }>();

    return result.results.map((row) => row.name);
  }

  async createSession(input: {
    id: string;
    userId: string;
    tenantId: string;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: string;
  }): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, tenant_id, token_hash, csrf_token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(input.id, input.userId, input.tenantId, input.tokenHash, input.csrfTokenHash, input.expiresAt)
      .run();
  }

  async findActiveSession(tokenHash: string): Promise<ActiveSession | null> {
    return this.db
      .prepare(
        `SELECT s.id, s.expires_at AS expiresAt, t.id AS tenantId, t.slug AS tenantSlug, t.name AS tenantName,
                u.id AS userId, u.email AS userEmail, u.display_name AS userDisplayName
         FROM sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = s.tenant_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
           AND u.status = 'active' AND t.status = 'active' LIMIT 1`,
      )
      .bind(tokenHash)
      .first<{
        id: string;
        expiresAt: string;
        tenantId: string;
        tenantSlug: string;
        tenantName: string;
        userId: string;
        userEmail: string | null;
        userDisplayName: string | null;
      }>()
      .then((row) =>
        row
          ? {
              id: row.id,
              expiresAt: row.expiresAt,
              tenant: { id: row.tenantId, slug: row.tenantSlug, name: row.tenantName },
              user: { id: row.userId, email: row.userEmail, displayName: row.userDisplayName },
            }
          : null,
      );
  }

  async verifyCsrf(tokenHash: string, csrfHash: string): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT id FROM sessions WHERE token_hash = ? AND csrf_token_hash = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP LIMIT 1')
      .bind(tokenHash, csrfHash)
      .first<{ id: string }>();
    return row !== null;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL').bind(tokenHash).run();
  }

  async consumeRateLimit(scopeHash: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        `INSERT INTO auth_rate_limits (scope_hash, window_started_at, attempt_count, lockout_until, updated_at)
         VALUES (?, CURRENT_TIMESTAMP, 1, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT(scope_hash) DO UPDATE SET
           attempt_count = CASE WHEN window_started_at <= datetime('now', '-15 minutes') THEN 1 ELSE attempt_count + 1 END,
           window_started_at = CASE WHEN window_started_at <= datetime('now', '-15 minutes') THEN CURRENT_TIMESTAMP ELSE window_started_at END,
           lockout_until = CASE
             WHEN lockout_until IS NOT NULL AND lockout_until > CURRENT_TIMESTAMP THEN lockout_until
             WHEN window_started_at <= datetime('now', '-15 minutes') THEN NULL
             WHEN attempt_count + 1 >= 5 THEN datetime('now', '+15 minutes')
             ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
         RETURNING lockout_until AS lockoutUntil`,
      )
      .bind(scopeHash)
      .first<{ lockoutUntil: string | null }>();
    return row?.lockoutUntil ?? null;
  }

  async clearRateLimit(scopeHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM auth_rate_limits WHERE scope_hash = ?').bind(scopeHash).run();
  }

  async writeAuditLog(input: { id: string; tenantId: string | null; actorUserId: string | null; action: string; metadata: Record<string, unknown> }): Promise<void> {
    await this.db
      .prepare('INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, metadata_json) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(input.id, input.tenantId, input.actorUserId, input.action, 'auth', JSON.stringify(input.metadata))
      .run();
  }
}
