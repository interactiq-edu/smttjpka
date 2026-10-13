import { describe, expect, it } from 'vitest';
import { openRedirectToken, sealRedirectToken } from './redirect-token';

const secret = 'a-test-secret-that-is-longer-than-thirty-two-characters';

describe('Google redirect tokens', () => {
  it('round-trips an encrypted payload without exposing its contents', async () => {
    const payload = { kind: 'google-state', joinCode: 'AB12CD34', expiresAt: Date.now() + 60_000 };
    const token = await sealRedirectToken(payload, secret);

    expect(token).not.toContain(payload.joinCode);
    await expect(openRedirectToken(token, secret)).resolves.toEqual(payload);
  });

  it('rejects tampered tokens and the wrong secret', async () => {
    const token = await sealRedirectToken({ ok: true }, secret);
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    await expect(openRedirectToken(tampered, secret)).rejects.toThrow();
    await expect(openRedirectToken(token, `${secret}-different`)).rejects.toThrow();
  });
});
