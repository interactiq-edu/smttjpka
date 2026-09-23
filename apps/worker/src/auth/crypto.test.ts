import { describe, expect, it } from 'vitest';
import { fromBase64Url, hashPbkdf2Password, toArrayBuffer, toBase64Url, verifyPbkdf2Password } from './crypto';

describe('PBKDF2 password verification', () => {
  it('accepts only the matching password and salt-derived hash', async () => {
    const password = 'correct horse battery staple';
    const salt = toBase64Url(new Uint8Array(16).fill(7));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(fromBase64Url(salt)), iterations: 100000 },
      key,
      256,
    );
    const hash = toBase64Url(new Uint8Array(bits));

    await expect(verifyPbkdf2Password(password, salt, 100000, hash)).resolves.toBe(true);
    await expect(verifyPbkdf2Password('incorrect password', salt, 100000, hash)).resolves.toBe(false);
  });

  it('creates a fresh salt and a verifiable non-plaintext password hash', async () => {
    const password = 'a long unique administrator passphrase';
    const first = await hashPbkdf2Password(password, 100000);
    const second = await hashPbkdf2Password(password, 100000);
    expect(first.hash).not.toBe(password);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    await expect(verifyPbkdf2Password(password, first.salt, 100000, first.hash)).resolves.toBe(true);
  });
});
