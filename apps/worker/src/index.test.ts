import { describe, expect, it } from 'vitest';
import { app, type Env } from './index';
import type { D1Database, D1PreparedStatement } from './db/types';

const unusedStatement: D1PreparedStatement = {
  bind: () => unusedStatement,
  first: async () => null,
  all: async () => ({ results: [], success: true, meta: {} }),
  run: async () => ({ results: [], success: true, meta: {} }),
};

const unusedDatabase: D1Database = {
  prepare: () => unusedStatement,
  batch: async () => [],
};

const env: Env = { APP_ENV: 'development', DB: unusedDatabase };

describe('InteractIQ API foundation', () => {
  it('returns a typed health response without caching', async () => {
    const response = await app.fetch(new Request('https://api.example.test/api/v1/health'), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { service: 'interactiq-api', environment: 'development' },
    });
  });

  it('uses the standard error contract for unknown routes', async () => {
    const response = await app.fetch(new Request('https://api.example.test/api/v1/missing'), env);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('allows each configured browser origin and rejects unknown origins', async () => {
    const corsEnv: Env = {
      ...env,
      ALLOWED_ORIGIN: 'https://interactiq-edu.github.io, http://localhost:5173',
    };
    const localResponse = await app.fetch(new Request('https://api.example.test/api/v1/health', {
      headers: { origin: 'http://localhost:5173' },
    }), corsEnv);
    expect(localResponse.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(localResponse.headers.get('access-control-allow-headers')).toContain('authorization');

    const rejectedResponse = await app.fetch(new Request('https://api.example.test/api/v1/health', {
      method: 'OPTIONS',
      headers: { origin: 'https://untrusted.example' },
    }), corsEnv);
    expect(rejectedResponse.status).toBe(403);
    expect(rejectedResponse.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('fails closed when a login request is missing rate-limit secret configuration', async () => {
    const response = await app.fetch(
      new Request('https://api.example.test/api/v1/auth/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantSlug: 'north-school', username: 'teacher', password: 'correct-password' }),
      }),
      env,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: 'CONFIGURATION_ERROR' } });
  });

  it('returns an explicit retry window when login rate limiting is active', async () => {
    const lockedStatement: D1PreparedStatement = {
      bind: () => lockedStatement,
      first: async <T,>() => ({ lockoutUntil: '2099-01-01 00:00:00' }) as T,
      all: async () => ({ results: [], success: true, meta: {} }),
      run: async () => ({ results: [], success: true, meta: {} }),
    };
    const limitedEnv: Env = {
      ...env,
      RATE_LIMIT_PEPPER: 'test-rate-limit-pepper-that-is-at-least-32-characters',
      DB: { prepare: () => lockedStatement, batch: async () => [] },
    };
    const response = await app.fetch(
      new Request('https://api.example.test/api/v1/auth/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantSlug: 'north-school', username: 'teacher', password: 'incorrect-password' }),
      }),
      limitedEnv,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('900');
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
  });

  it('does not expose assignment objects without an authenticated session', async () => {
    const mediaEnv: Env = {
      ...env,
      MEDIA: {
        get: async () => ({ body: new ReadableStream<Uint8Array>() }),
        put: async () => ({}),
        delete: async () => undefined,
        list: async () => ({ objects: [], truncated: false }),
      },
    };
    const response = await app.fetch(new Request('https://api.example.test/api/v1/media/tenants/11111111-1111-4111-8111-111111111111/assignments/22222222-2222-4222-8222-222222222222/file.pdf'), mediaEnv);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ success:false, error:{ code:'UNAUTHENTICATED' } });
  });

  it('serves public presentation metadata for Office preview HEAD requests', async () => {
    const mediaEnv: Env = {
      ...env,
      MEDIA: {
        get: async () => ({
          body: new ReadableStream<Uint8Array>(),
          size: 745555,
          httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
        }),
        put: async () => ({}),
        delete: async () => undefined,
        list: async () => ({ objects: [], truncated: false }),
      },
    };
    const response = await app.fetch(new Request('https://api.example.test/api/v1/media/tenants/11111111-1111-4111-8111-111111111111/presentations/deck.pptx', { method: 'HEAD' }), mediaEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('745555');
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await response.text()).toBe('');
  });

  it('renews a cookie-backed session for a new browser tab from an allowed origin', async () => {
    const executed: string[] = [];
    const sessionDatabase: D1Database = {
      prepare: (query) => {
        let values: unknown[] = [];
        const statement: D1PreparedStatement = {
          bind: (...input) => { values = input; return statement; },
          first: async <T,>() => query.includes('FROM sessions s JOIN users') ? ({
            id: 'session-old', expiresAt: '2099-01-01 00:00:00',
            tenantId: 'tenant-1', tenantSlug: 'school', tenantName: 'School',
            userId: 'student-1', userEmail: 'student@example.test', userDisplayName: 'Student',
          } as T) : null,
          all: async <T,>() => ({ results: (query.includes('SELECT r.name') ? [{ name: 'STUDENT' }] : []) as T[], success: true, meta: {} }),
          run: async () => { executed.push(`${query}:${values.length}`); return { results: [], success: true, meta: {} }; },
        };
        return statement;
      },
      batch: async () => [],
    };
    const sessionEnv: Env = { APP_ENV: 'development', DB: sessionDatabase, ALLOWED_ORIGIN: 'http://localhost:5173' };
    const response = await app.fetch(new Request('https://api.example.test/api/v1/auth/session/renew', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', cookie: 'interactiq_session=valid-cookie-token' },
    }), sessionEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('interactiq_session=');
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { user: { id: 'student-1' }, tenant: { slug: 'school' }, roles: ['STUDENT'] },
    });
    expect(executed.some((query) => query.startsWith('INSERT INTO sessions'))).toBe(true);
  });

  it('rejects cookie session renewal from an unconfigured origin', async () => {
    const response = await app.fetch(new Request('https://api.example.test/api/v1/auth/session/renew', {
      method: 'POST',
      headers: { origin: 'https://untrusted.example', cookie: 'interactiq_session=token' },
    }), { ...env, ALLOWED_ORIGIN: 'http://localhost:5173' });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('requires a trusted browser origin for password recovery', async () => {
    const response = await app.fetch(new Request('https://api.example.test/api/v1/auth/password-reset/request', {
      method: 'POST',
      headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@example.test' }),
    }), { ...env, ALLOWED_ORIGIN: 'http://localhost:5173' });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('returns indistinguishable public responses for allowlisted and unknown recovery emails', async () => {
    const recoveryEnv: Env = {
      ...env,
      ALLOWED_ORIGIN: 'http://localhost:5173',
      RATE_LIMIT_PEPPER: 'test-rate-limit-pepper-that-is-at-least-32-characters',
      ADMIN_RECOVERY_EMAILS: 'admin@example.test',
      PASSWORD_RESET_APP_URL: 'http://localhost:5173/',
    };
    const makeRequest = (email: string) => app.fetch(new Request('https://api.example.test/api/v1/auth/password-reset/request', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }), recoveryEnv);
    const [allowlisted, unknown] = await Promise.all([makeRequest('admin@example.test'), makeRequest('unknown@example.test')]);

    expect(allowlisted.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await allowlisted.json()).toEqual(await unknown.json());
  });
});
